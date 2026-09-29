/**
 * MQTT transport.
 *
 * The device publishes a snapshot to a broker instead of POSTing it. This module
 * is a SUBSCRIBER ONLY: it connects to a broker that already exists (Mosquitto
 * on this host) and feeds every payload to the SAME ingest service the HTTP
 * route uses. The snapshot contract is therefore not forked - one validator, one
 * apply path, one projection, one SSE fan-out. MQTT replaces the wire, not the
 * architecture, and the backend stays the single system of record rather than
 * becoming a pass-through.
 *
 * The backend does NOT embed a broker. A broker is infrastructure: it must
 * survive independently of the application, keep its own persistence and
 * access control, and be shared by anything else that needs the same topics.
 * Bundling one inside the API process would make the broker's lifetime the
 * application's lifetime and would silently stop publishing whenever the API was
 * restarted - the exact failure this transport is meant to remove.
 *
 * HTTP ingest remains fully supported and is still the fallback the device uses
 * when the broker is unreachable, so a broker outage degrades latency rather
 * than losing data.
 *
 * Broker credentials are optional. An open local broker commonly permits
 * anonymous clients; a locked-down one does not. Supply FG_MQTT_*_PASSWORD and
 * the same credentials are presented, so the transport works against either
 * without a code change.
 */
import { randomUUID } from 'node:crypto';
import { connect as mqttConnect } from 'mqtt';
import { snapshotSchema, devPathParam } from '../ingest/contract.js';
import { TransportUnavailable, CommandUnconfirmed } from '../read/item-registration.js';

const TOPIC_DEVICE = 'freshguard/+/snapshot';
const TOPIC_STATUS = 'freshguard/+/status';

/** Where commands go. Wildcard-shaped on purpose: one topic per device. */
export const TOPIC_COMMAND_SUFFIX = '/cmd';

/**
 * How long to wait for the client to confirm a publish before giving up on it.
 *
 * This is a request-path budget, not a broker setting: the operator is waiting
 * on an HTTP response, so a bounded wait is the difference between a prompt 503
 * and a request that hangs until something else times out. Five seconds is
 * generous for a PUBLISH/PUBACK round trip on a LAN broker, and a command is
 * safe to retry.
 */
const COMMAND_CONFIRM_TIMEOUT_MS = 5000;

export function createMqttTransport({ config, ingest, currentView, hub, logger }) {
  let client = null;
  let started = false;

  // Only the configured device may write into the projection. Every payload is
  // additionally checked against the full contract, so a valid broker
  // connection grants nothing on its own.
  const allowedDevice = config.mqttDeviceId ?? null;

  function handleMessage(topic, payloadBuffer) {
    const segments = String(topic).split('/');
    const deviceId = segments[1];
    let published;
    try {
      published = JSON.parse(payloadBuffer.toString('utf8'));
    } catch {
      logger?.warn?.('mqtt snapshot was not valid JSON', { topic });
      return;
    }
    if (deviceId !== allowedDevice) {
      logger?.warn?.('mqtt snapshot from an unexpected device', { topic, device: deviceId });
      return;
    }
    let parsedDevice;
    try {
      parsedDevice = devPathParam.parse(deviceId);
    } catch {
      logger?.warn?.('mqtt topic carried an invalid device id', { topic });
      return;
    }
    const parsed = snapshotSchema.safeParse(published);
    if (!parsed.success) {
      logger?.warn?.('mqtt snapshot failed contract validation', {
        topic,
        issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }

    let outcome;
    try {
      outcome = ingest.applySnapshot(parsedDevice, parsed.data);
    } catch (error) {
      logger?.error?.('mqtt snapshot could not be applied', { topic, error: error.message });
      return;
    }
    logger?.info?.('mqtt snapshot stored', {
      request_id: randomUUID(),
      device: parsedDevice,
      seq: outcome.seq,
      uptime_s: outcome.uptime_s,
      outcome: outcome.outcome,
      events: outcome.events,
    });

    if (outcome.outcome === 'stored') {
      let view = null;
      try {
        view = currentView(parsedDevice);
      } catch {
        view = null;
      }
      if (view) hub.publish(parsedDevice, view);
    }
  }

  return {
    get running() { return started; },
    get subscriber() { return client; },
    /** Whether a command could be dispatched right now. Read, never assumed. */
    get connected() { return Boolean(client && client.connected); },

    /**
     * Publishes a command to `freshguard/{dev}/cmd` and resolves ONLY once the
     * connection has confirmed it.
     *
     * Three deliberate choices:
     *
     *  1. `qos: 1`, so the broker acknowledges the PUBLISH. The returned promise
     *     settles in the mqtt.js publish callback, which for QoS 1 fires on
     *     PUBACK. That makes "the broker has it" observable instead of assumed.
     *  2. `retain: false`. A command is not state: retaining it would replay a
     *     stale `item.register` to any device that reconnects later, re-creating
     *     an item an operator may have removed in the meantime. Retained
     *     distribution belongs to threshold profiles, which ARE state.
     *  3. A disconnected client throws `TransportUnavailable` instead of
     *     publishing into the void. mqtt.js queues an offline publish and
     *     flushes it on reconnect, which for a command means the operator gets a
     *     success response for something that has not happened yet.
     *
     * What the confirmation does NOT prove: that the device received it, applied
     * it, or accepted it. There is no acknowledgement path from the ESP8266, so
     * this is the strongest signal the transport can honestly give, and the
     * caller reports it as "dispatched" for that reason.
     */
    publishCommand(dev, command) {
      if (!client || !client.connected) {
        throw new TransportUnavailable();
      }
      const topic = `freshguard/${dev}${TOPIC_COMMAND_SUFFIX}`;
      const payload = JSON.stringify(command);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new CommandUnconfirmed(`broker did not confirm ${topic} within ${COMMAND_CONFIRM_TIMEOUT_MS}ms`));
        }, COMMAND_CONFIRM_TIMEOUT_MS);
        // unref so a pending publish can never hold the event loop open.
        timer.unref?.();

        try {
          client.publish(topic, payload, { qos: 1, retain: false }, (error) => {
            clearTimeout(timer);
            if (error) {
              logger?.warn?.('device command was not accepted by the broker', {
                topic,
                op: command?.op ?? null,
                error: error.message,
              });
              reject(new CommandUnconfirmed(error.message));
              return;
            }
            logger?.info?.('device command published', { topic, op: command?.op ?? null, qos: 1, retained: false });
            resolve();
          });
        } catch (error) {
          // A publish on a socket that died between the connected check above
          // and this call throws rather than calling back. Without this the
          // promise would never settle and the request would hang until the
          // client gave up.
          clearTimeout(timer);
          reject(new CommandUnconfirmed(error instanceof Error ? error.message : String(error)));
        }
      });
    },

    /**
     * Publishes a threshold profile to the device, retained.
     *
     * Retained is the important part. A device that is offline, rebooting or
     * simply not yet connected when the administrator saves a change receives the
     * current profile the moment it connects, with no catch-up poll and no
     * "did the device get it?" ambiguity. The device's snapshot reports the
     * revision it is applying, so the backend can still confirm it.
     */
    publishConfig(dev, scope, payload) {
      if (!client || !client.connected) {
        throw new Error('mqtt broker connection is not available');
      }
      const topic = `freshguard/${dev}/config`;
      client.publish(topic, JSON.stringify({ ...payload, scope }), { qos: 1, retain: true });
      logger?.info?.('threshold profile published to device', {
        device: dev,
        scope,
        revision: payload?.rev ?? null,
        retained: true,
      });
    },

    async start() {
      if (started) return;
      // Credentials are optional so this works against an open local broker and
      // a locked-down one without a code change.
      const opts = {
        clientId: `freshguard-ingest-${randomUUID().slice(0, 8)}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      };
      if (config.mqttIngestUser && config.mqttIngestPassword) {
        opts.username = config.mqttIngestUser;
        opts.password = config.mqttIngestPassword;
      }
      client = mqttConnect(`mqtt://${config.mqttHost}:${config.mqttPort}`, opts);

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('mqtt subscriber connect timeout')), 12000);
        client.once('connect', () => { clearTimeout(timer); resolve(); });
        client.once('error', (err) => { clearTimeout(timer); reject(err); });
      });

      await new Promise((resolve, reject) => {
        client.subscribe(TOPIC_DEVICE, (err) => (err ? reject(err) : resolve()));
        client.subscribe(TOPIC_STATUS, { qos: 0 }, (err) => (err ? reject(err) : resolve()));
      });

      client.on('message', (topic, payload) => {
        if (!String(topic).endsWith('/snapshot')) return;
        // Wrapped because this runs on a library-owned emitter. An uncaught
        // throw here is promoted to an 'error' event on the socket and kills the
        // whole process - which is exactly what happened when the hub call was
        // wrong: one bad snapshot took the HTTP API, the dashboard and the
        // whole ingest path offline. A malformed device payload must be logged
        // and dropped, never fatal.
        try {
          handleMessage(topic, payload);
        } catch (error) {
          logger?.error?.('mqtt snapshot handler threw; message dropped', {
            topic,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      // A dropped subscription is the failure that matters: the process stays
      // up, health checks stay green, and snapshots silently stop arriving.
      // Re-subscribing on reconnect is what stops that being invisible.
      client.on('reconnect', () => {
        logger?.warn?.('mqtt subscriber reconnecting', {});
      });
      client.on('error', (err) => {
        logger?.warn?.('mqtt subscriber error', { error: err.message });
      });

      started = true;
      logger?.info?.('mqtt transport started', {
        host: config.mqttHost,
        port: config.mqttPort,
        device: config.mqttDeviceId,
        topic: TOPIC_DEVICE,
        authenticated: Boolean(opts.username),
      });
    },

    async stop() {
      started = false;
      if (!client) return;
      try { client.end(true); } catch { /* already gone */ }
      client = null;
      logger?.info?.('mqtt transport stopped', {});
    },
  };
}