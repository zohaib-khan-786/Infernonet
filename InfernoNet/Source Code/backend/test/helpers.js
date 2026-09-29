/**
 * Test stack builder.
 *
 * Every test gets a fresh in-memory database, a fixed clock it can move by
 * hand, and a logger that is silent by default. The ingest key is a literal
 * test constant hashed at import time - it is not a secret and never leaves
 * this repository.
 */
import { createHash } from 'node:crypto';
import supertest from 'supertest';
import { loadConfig } from '../src/config/index.js';
import { openDatabase } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';

export const TEST_KEY = 'freshguard-test-device-key';
export const TEST_KEY_SHA256 = createHash('sha256').update(TEST_KEY, 'utf8').digest('hex');
export const WRONG_KEY = 'not-the-key';
export const TEST_ORIGIN = 'http://localhost:5173';

export function makeClock(startIso = '2025-01-01T00:00:00.000Z') {
  const clock = {
    value: new Date(startIso),
    now: () => new Date(clock.value),
    set(iso) {
      clock.value = new Date(iso);
    },
    advanceSeconds(seconds) {
      clock.value = new Date(clock.value.getTime() + seconds * 1000);
    },
  };
  return clock;
}

export function makeTestStack({ clock = makeClock(), config: overrides = {}, logger, hub } = {}) {
  const config = loadConfig({
    FG_ENV: 'test',
    FG_DB_PATH: ':memory:',
    FG_LOG_LEVEL: 'silent',
    FG_INGEST_KEY_SHA256: TEST_KEY_SHA256,
    FG_CORS_ORIGINS: TEST_ORIGIN,
    ...overrides,
  });

  const db = openDatabase({ path: ':memory:' });
  const log = logger ?? createLogger({ level: 'silent' });
  // `hub` is injectable so a test can observe what the ingest path pushes without
  // opening a listening socket. See `recordingHub` in the freshness tests.
  const app = createApp({ config, db, logger: log, now: clock.now, hub });

  const post = (dev, body, { key = TEST_KEY, contentType = 'application/json', raw } = {}) =>
    supertest(app)
      .post(`/api/v1/ingest/devices/${dev}/snapshots`)
      .set('X-FreshGuard-Key', key)
      .set('Content-Type', contentType)
      .send(raw ?? body);

  const get = (path) => supertest(app).get(path);

  /** A generic request, for routes other than ingest. */
  const send = (method) => (path) => supertest(app)[method](path);

  return { app, db, config, clock, post, get, send, logger: log, hub: app.locals.hub };
}

/**
 * Insert reading rows directly, for series and retention tests that would
 * otherwise need hundreds of HTTP round trips. The device must already have
 * reported at least one snapshot.
 */
export function insertReadings(stack, { dev = 'fg-01', count = 600, startIso = '2025-01-01T00:00:00.000Z', stepSeconds = 60, temperatureC = 4 } = {}) {
  const device = stack.db.prepare('SELECT id FROM device WHERE dev = ?').get(dev);
  if (!device) throw new Error(`insertReadings: seed a snapshot for '${dev}' first`);

  const insert = stack.db.prepare(`
    INSERT INTO reading (device_id, recorded_at, reported_at, time_valid, seq, temperature_c)
    VALUES (?, ?, ?, 1, ?, ?)
  `);
  const start = Date.parse(startIso);
  const run = stack.db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const at = new Date(start + index * stepSeconds * 1000).toISOString();
      insert.run(device.id, at, at, index + 1, temperatureC + (index % 10) / 10);
    }
  });
  run();
  return count;
}
