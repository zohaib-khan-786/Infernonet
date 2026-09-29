/**
 * Smoke test: exercises the real HTTP surface of a running server, the way an
 * operator or a CI job would, rather than importing the app module.
 *
 *   node scripts/smoke.js                       # uses a temporary DB and key
 *   node scripts/smoke.js --url http://...      # checks an already-running one
 *
 * Exits 0 on success, 1 on the first failed check.
 */
import process from 'node:process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from '../src/config/index.js';
import { openDatabase } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { snapshotFixture } from '../src/ingest/fixtures.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((token) => {
    const [flag, value] = token.replace(/^--/, '').split('=');
    return [flag, value ?? true];
  }),
);

const KEY = 'smoke-test-device-key';
let failures = 0;

const check = (name, ok, detail = '') => {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? ` -> ${detail}` : ''}\n`);
  if (!ok) failures += 1;
};

const get = (base, path, init) => fetch(`${base}${path}`, init);
const post = (base, path, body, key = KEY) =>
  get(base, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FreshGuard-Key': key },
    body: JSON.stringify(body),
  });

async function runAgainst(base) {
  process.stdout.write(`\n--- smoke against ${base} ---\n`);

  const health = await get(base, '/healthz');
  check('GET /healthz is 200', health.status === 200, String(health.status));

  const ready = await get(base, '/readyz');
  check('GET /readyz is 200', ready.status === 200, String(ready.status));

  const unauthorized = await post(base, '/api/v1/ingest/devices/smoke-01/snapshots', snapshotFixture(), 'wrong');
  check('ingest with a wrong key is 401', unauthorized.status === 401, String(unauthorized.status));

  const stored = await post(base, '/api/v1/ingest/devices/smoke-01/snapshots', snapshotFixture({ seq: 1, uptime: 10 }));
  const storedBody = await stored.json();
  check('ingest stores the first snapshot', stored.status === 200 && storedBody.outcome === 'stored', JSON.stringify(storedBody));

  const replay = await post(base, '/api/v1/ingest/devices/smoke-01/snapshots', snapshotFixture({ seq: 1, uptime: 10 }));
  const replayBody = await replay.json();
  check('a replay is 200 outcome=stale', replay.status === 200 && replayBody.outcome === 'stale', JSON.stringify(replayBody));

  const reboot = await post(base, '/api/v1/ingest/devices/smoke-01/snapshots', snapshotFixture({ seq: 1, uptime: 3 }));
  const rebootBody = await reboot.json();
  check('a reboot is accepted', reboot.status === 200 && rebootBody.reason === 'uptime_reset', JSON.stringify(rebootBody));

  const devices = await get(base, '/api/v1/devices');
  const devicesBody = await devices.json();
  check('GET /api/v1/devices lists the device', devices.status === 200 && devicesBody.devices.length === 1);

  const current = await get(base, '/api/v1/devices/smoke-01/current');
  const currentBody = await current.json();
  check(
    'GET current returns the first-paint aggregate',
    current.status === 200 && currentBody.device.dev === 'smoke-01' && Array.isArray(currentBody.inventory),
    JSON.stringify(currentBody).slice(0, 200),
  );

  const readings = await get(base, '/api/v1/devices/smoke-01/readings?bucket=raw');
  const readingsBody = await readings.json();
  check('GET readings returns a series', readings.status === 200 && readingsBody.points >= 1, JSON.stringify(readingsBody).slice(0, 200));

  const inventory = await get(base, '/api/v1/devices/smoke-01/inventory');
  check('GET inventory returns items', inventory.status === 200 && (await inventory.json()).items.length === 1);

  const csv = await get(base, '/api/v1/devices/smoke-01/inventory/export.csv');
  check('CSV export is text/csv', csv.status === 200 && csv.headers.get('content-type').includes('text/csv'));

  const events = await get(base, '/api/v1/devices/smoke-01/events');
  check('GET events is 200', events.status === 200);

  const alerts = await get(base, '/api/v1/devices/smoke-01/alerts');
  check('GET alerts is 200', alerts.status === 200);

  const stream = await fetch(`${base}/api/v1/stream?dev=smoke-01`);
  const contentType = stream.headers.get('content-type') ?? '';
  const reader = stream.body.getReader();
  const { value } = await reader.read();
  const opening = new TextDecoder().decode(value);
  check(
    'SSE opens with a snapshot frame and no compression',
    stream.status === 200 && contentType.includes('text/event-stream') && !stream.headers.get('content-encoding') && opening.includes('event: snapshot'),
    opening.slice(0, 120),
  );
  await reader.cancel().catch(() => {});
}

if (args.url) {
  await runAgainst(String(args.url));
} else {
  const workdir = mkdtempSync(join(tmpdir(), 'freshguard-smoke-'));
  const config = loadConfig({
    FG_ENV: 'test',
    FG_DB_PATH: join(workdir, 'smoke.db'),
    FG_INGEST_KEY_SHA256: createHash('sha256').update(KEY, 'utf8').digest('hex'),
    FG_LOG_LEVEL: 'error',
    FG_SSE_HEARTBEAT_MS: '1000',
  });
  const db = openDatabase({ path: config.dbPath });
  const app = createApp({ config, db, logger: createLogger({ level: 'error' }) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await runAgainst(`http://127.0.0.1:${server.address().port}`);
  } finally {
    app.locals.hub.close();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(workdir, { recursive: true, force: true });
  }
}

process.stdout.write(`\n${failures === 0 ? 'smoke test passed' : `smoke test FAILED (${failures})`}\n`);
process.exit(failures === 0 ? 0 : 1);
