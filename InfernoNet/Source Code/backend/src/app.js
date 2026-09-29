/**
 * App factory. Returns a configured Express application and nothing else -
 * no socket is opened, no interval is started, nothing is mutated. `server.js`
 * owns listening and shutdown; tests own the app.
 *
 * Dependency order is explicit (config, database, logger are passed in; the
 * rest are built here) so a test can drive a full stack against an in-memory
 * database with a fixed clock.
 */
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { createLogger } from './logger.js';
import { createIngestService } from './ingest/service.js';
import { createIngestRouter } from './ingest/routes.js';
import { createReadService } from './read/service.js';
import { createReadRouter, createHealthRouter } from './read/routes.js';
import { createSseHub } from './realtime/hub.js';
import { createThresholdService } from './read/thresholds.js';
import { createItemRegistrationService, TransportUnavailable } from './read/item-registration.js';
import { createCommandStore } from './read/command-store.js';
import { createMqttTransport } from './transport/mqtt.js';
import { accessLog, requestId } from './middleware/request-log.js';
import { errorHandler, notFound } from './middleware/error-handler.js';

const SSE_PATH = '/api/v1/stream';

export function createApp({ config, db, logger = createLogger({ level: config.logLevel }), now = () => new Date(), hub: injectedHub } = {}) {  const hub = injectedHub ?? createSseHub({
    heartbeatMs: config.sseHeartbeatMs,
    replayBuffer: config.sseReplayBuffer,
    logger,
  });

  // The durable record of every dispatched admin command and its per-device
  // sequence. Shared by the dispatch path (writes), the ingest path (confirms)
  // and the read surface (status / expiry), so one store instance guarantees
  // they all see the same rows, the same counters and the same transitions.
  const commands = createCommandStore(db);
  const ingest = createIngestService({
    db,
    now,
    // A uid in an accepted snapshot is the device's own word that it holds the
    // item, so the ingest path confirms the matching still-dispatched command
    // in the same transaction that upserts the row (see ingest/service.js).
    confirmCommands: (dev, uids, at) => commands.confirmByUids(dev, uids, at),
  });
  // The threshold service publishes saved profiles to the device over the broker.
  // publishConfig is a late-bound indirection because the MQTT transport is
  // constructed after the app (it needs the hub and ingest that live here), and
  // the two reference each other: the transport subscribes and applies, the
  // service pushes. A thunk breaks the cycle without either knowing the other.
  //
  // The holder is mutable and read at CALL time, not captured. The transport is
  // built after the app (it needs the app's routes), so an earlier version that
  // closed over a local `let` always saw null here and every save failed with
  // "mqtt transport is not available yet" while the profile was stored anyway -
  // which looks like success and silently never reaches the device.
  const mqttPublisher = { publish: null, publishCommand: null };
  const thresholds = createThresholdService({
    db,
    now,
    logger,
    publishConfig: (dev, scope, payload) => {
      if (!mqttPublisher.publish) {
        throw new Error('mqtt transport is not available yet');
      }
      mqttPublisher.publish(dev, scope, payload);
    },
  });

  // Item registration is the opposite case, and the difference is the whole
  // design. A threshold profile is stored first and pushed second, so a broker
  // that is not up is a warning: the value is durable and the device will still
  // fetch it. An item registration is a DISPATCH plus its command record - the
  // `admin_command` row is durable, the item is not, because the device owns
  // the item. So an unfilled (or unconnected) transport is still a 503 the
  // operator has to see, never a quiet success, and the record is marked failed
  // so the status read can show why.
  //
  // The store passed in can write `admin_command` and nothing else; the module
  // still cannot see the datastore, so it cannot write an item row. The
  // single-authority rule is enforced by the wiring rather than by remembering
  // not to query.
  const itemRegistration = createItemRegistrationService({
    logger,
    now,
    commandStore: commands,
    // Used only to warn on a registration aimed at a device this broker link is
    // not configured for. It never changes the response: the vocabulary is
    // shared with the firmware and the dashboard, and a configuration mistake is
    // not a reason to invent a new rejection code.
    expectedDevice: config.mqttDeviceId ?? null,
    publishCommand: (dev, command) => {
      if (!mqttPublisher.publishCommand) {
        throw new TransportUnavailable();
      }
      return mqttPublisher.publishCommand(dev, command);
    },
  });
  const read = createReadService({
    db,
    now,
    commandStore: commands,
    staleAfterSeconds: config.transportStaleAfterSeconds,
    maxPoints: config.readingsMaxPoints,
    // The freshness engine's window and clock tolerance come from config here so
    // the operational surface for "how much should we trust this" is one place.
    freshnessWindowMinutes: config.freshnessWindowMinutes,
    freshnessClockMaxSkewSeconds: config.freshnessClockMaxSkewSeconds,
  });

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(requestId());
  app.use(accessLog({ logger }));
  app.use(
    helmet({
      // A read API serving JSON and one CSV file has no use for a CSP; the
      // default policy is left off rather than set to something permissive.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    compression({
      // Event streams must reach the client frame by frame.
      filter: (req, res) => req.path !== SSE_PATH && compression.filter(req, res),
    }),
  );

  app.use('/', createHealthRouter({ read }));
  app.use('/api/v1/ingest', createIngestRouter({
    config,
    ingest,
    currentView: (dev) => read.current(dev),
    hub,
    logger,
  }));
  app.use('/api/v1', createReadRouter({ config, read, hub, logger, thresholds, itemRegistration }));

  // Unmatched routes and the terminal error handler, always last.
  app.use(notFound());
  app.use(errorHandler({ logger }));

  app.locals.hub = hub;
  app.locals.read = read;
  app.locals.ingest = ingest;
  app.locals.thresholds = thresholds;
  app.locals.itemRegistration = itemRegistration;
  // server.js fills mqttPublisher.publish and mqttPublisher.publishCommand once
  // the transport exists. Exposed on locals because that is the only handle the
  // server has on the app - and because a test can hold a fake transport here
  // instead of standing up a broker.
  app.locals.mqttPublisher = mqttPublisher;
  return app;
}

/**
 * The MQTT transport reuses the ingest service, the projection and the SSE hub
 * the HTTP routes already use, so it is built here rather than in server.js:
 * that keeps the dependency order identical for both transports and guarantees a
 * snapshot arriving over MQTT is validated and fanned out exactly as one
 * arriving over HTTP would be.
 *
 * hub, ingest and currentView are REQUIRED and must be the instances the HTTP
 * router is using. Building a second read service here would give the MQTT path
 * its own projection, and a device would appear to have two different states
 * depending on which transport delivered the snapshot.
 */
export function createMqttBridge({ config, db, logger = createLogger({ level: config.logLevel }), now = () => new Date(), hub, ingest, currentView }) {
  if (!hub || !ingest || typeof currentView !== 'function') {
    throw new TypeError('createMqttBridge requires the app hub, ingest and currentView');
  }
  return createMqttTransport({ config, ingest, currentView, hub, logger });
}
