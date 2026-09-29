/**
 * Process entry point: config -> database -> app -> socket -> retention job.
 *
 * Everything that owns a resource lives here, so shutdown is one function and
 * tests never touch it.
 */
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadConfigOrExit } from './config/index.js';
import { openDatabase } from './db/index.js';
import { createApp, createMqttBridge } from './app.js';
import { createLogger } from './logger.js';
import { adminTokenConfigured } from './middleware/admin-auth.js';
import { startRetentionJob } from './retention/prune.js';

const config = loadConfigOrExit(process.env, {
  dotenvPath: fileURLToPath(new URL('../.env', import.meta.url)),
});

const logger = createLogger({ level: config.logLevel, name: 'freshguard' });

// Warned here, at startup, rather than only on the first refused request: an
// operator reading this at boot learns the dashboard cannot save thresholds
// before anyone tries, instead of after a 401 looks like a frontend bug.
//
// The absence disables the admin mutation (every write attempt is a 401). It
// does NOT open it, and it does not stop the service: reads, SSE and the device
// ingest path are all independent of it. Warned, not fatal, so a deployment
// without an admin token still serves devices and dashboards.
if (!adminTokenConfigured(config)) {
  logger.warn(
    'FG_ADMIN_TOKEN is not set: threshold writes and item registration are DISABLED and every attempt will be refused with 401. ' +
      'Set FG_ADMIN_TOKEN to a random value and send it as "Authorization: Bearer <token>" to administer limits or register items. ' +
      'Reads, SSE and device ingest are unaffected.',
  );
}

const db = openDatabase({ path: config.dbPath, logger });
const app = createApp({ config, db, logger });
const retention = startRetentionJob({ db, config, logger });

const server = app.listen(config.port, config.host, () => {
  const address = server.address();
  logger.info('freshguard backend listening', {
    host: config.host,
    port: typeof address === 'object' && address ? address.port : config.port,
    env: config.env,
    db: config.dbPath,
    cors_origins: config.corsOrigins,
    sse_heartbeat_ms: config.sseHeartbeatMs,
    reading_retention_days: config.readingRetentionDays,
    // Never the token itself - only whether one is present, so an operator can
    // confirm the admin surface is live without the value entering a log file.
    admin_writes: adminTokenConfigured(config) ? 'token required' : 'disabled (no FG_ADMIN_TOKEN)',
  });
});

server.headersTimeout = 65_000;
server.requestTimeout = 0; // SSE connections are long-lived by design.
server.keepAliveTimeout = 61_000;

// The MQTT bridge is optional and off by default. A broker failure must never
// take the HTTP API down with it, so startup logs the error and carries on:
// the device then falls back to HTTP ingest and the dashboard keeps working.
let mqtt = null;
if (config.mqttEnabled) {
  // Wrapped in its own try as well as the async .catch below. A synchronous
  // throw from construction escapes a .catch attached to a later promise, which
  // is how a broker-construction failure once killed the entire process and took
  // the HTTP API with it.
  try {
    mqtt = createMqttBridge({
      config,
      db,
      logger,
      hub: app.locals.hub,
      ingest: app.locals.ingest,
      currentView: (dev) => app.locals.read.current(dev),
    });
    // Now that the transport exists, let the threshold service push to it.
    // This fills the holder the service reads at call time, so a profile saved
    // from here on is retained on the broker immediately instead of waiting for
    // the device's next HTTP poll.
    app.locals.mqttPublisher.publish = (dev, scope, payload) => mqtt.publishConfig(dev, scope, payload);
    // Same holder, second slot. Item registration has no stored fallback - the
    // device owns the item - so until this is filled the register endpoint
    // answers 503 rather than claiming a dispatch that never happened.
    app.locals.mqttPublisher.publishCommand = (dev, command) => mqtt.publishCommand(dev, command);
    mqtt.start().then(() => {
      // A retained message only survives as long as the broker does. Re-assert
      // every stored profile so a broker restart does not leave devices
      // silently enforcing their built-in defaults.
      const republished = app.locals.thresholds.republishAll();
      if (republished > 0) {
        logger.info('re-published stored threshold profiles to the broker', { count: republished });
      }
    }).catch((error) => {
      logger.error('mqtt transport failed to start; HTTP ingest remains available', {
        error: error.message,
      });
      mqtt = null;
    });
  } catch (error) {
    logger.error('mqtt transport could not be constructed; HTTP ingest remains available', {
      error: error.message,
    });
    mqtt = null;
  }
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  retention.stop();
  app.locals.hub.close();
  const closingServer = server.close(() => {
    try {
      db.close();
    } catch {
      /* the database is already closed */
    }
    process.exit(0);
  });
  // Broker sockets are not HTTP sockets, so server.close() will not wait for
  // them. Close them explicitly or the process hangs on a live broker handle.
  if (mqtt) {
    mqtt.stop().finally(() => closingServer.close());
  }
  // Do not wait forever for idle keep-alive sockets.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', { error: reason instanceof Error ? reason.message : String(reason) });
});
