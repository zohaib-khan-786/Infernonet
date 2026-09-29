/**
 * SSE behaviour, exercised against a real listening socket.
 *
 * A real server is used deliberately: the things that break an event stream -
 * headers, framing, the absence of compression, a heartbeat that keeps flowing
 * - are transport facts, and supertest's request/response model hides them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createSseHub } from '../src/realtime/hub.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config/index.js';
import { TEST_KEY, TEST_KEY_SHA256 } from './helpers.js';
import { snapshotFixture } from '../src/ingest/fixtures.js';

const HEARTBEAT_MS = 60;

let server;
let baseUrl;
let stack;

/**
 * Read frames off a stream until `predicate` is satisfied or time runs out.
 * Takes the reader, not the response: a stream is consumed once, so tests that
 * need several frames take one reader and read it repeatedly.
 */
async function readUntil(reader, predicate, { timeoutMs = 3000 } = {}) {
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = '';

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) return { matched: false, buffer };
    buffer += decoder.decode(value, { stream: true });
    const result = predicate(buffer);
    if (result) return { matched: true, buffer, ...result };
  }
  return { matched: false, buffer };
}

const hasEvent = (name) => (buffer) => {
  if (!buffer.includes(`event: ${name}`)) return null;
  const chunk = buffer.slice(buffer.indexOf(`event: ${name}`));
  const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) return null;
  return { data: JSON.parse(dataLine.slice(6)) };
};

/** The payload of the most recent frame with this event name. */
const lastEventData = (name, buffer) => {
  const marker = `event: ${name}\ndata: `;
  let index = buffer.lastIndexOf(marker);
  let payload = null;
  while (index !== -1) {
    const rest = buffer.slice(index + marker.length);
    const end = rest.indexOf('\n');
    if (end !== -1) payload = JSON.parse(rest.slice(0, end));
    index = buffer.lastIndexOf(marker, index - 1);
  }
  return payload;
};

const frameIds = (buffer) =>
  [...buffer.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));

beforeAll(async () => {
  const clock = { value: new Date('2025-01-01T00:00:00.000Z'), now: () => new Date(clock.value) };
  const config = loadConfig({
    FG_ENV: 'test',
    FG_DB_PATH: ':memory:',
    FG_LOG_LEVEL: 'silent',
    FG_INGEST_KEY_SHA256: TEST_KEY_SHA256,
  });
  const db = openDatabase({ path: ':memory:' });
  // The production floor on the heartbeat is one second; the test injects a
  // faster hub rather than weakening that guard.
  const hub = createSseHub({ heartbeatMs: HEARTBEAT_MS, replayBuffer: 20 });
  const app = createApp({ config, db, logger: createLogger({ level: 'silent' }), now: clock.now, hub });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  stack = { app, db, config, clock, url: baseUrl, hub };
});

afterAll(async () => {
  stack?.hub.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

const ingest = (body) =>
  fetch(`${baseUrl}/api/v1/ingest/devices/fg-01/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FreshGuard-Key': TEST_KEY },
    body: JSON.stringify(body),
  });

describe('SSE stream', () => {
  it('sends event-stream headers and excludes compression', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/stream?dev=fg-01`, {
      headers: { 'Accept-Encoding': 'gzip' },
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(response.headers.get('cache-control')).toContain('no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    // A gzipped event stream would sit in the compressor's buffer.
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('transfer-encoding')).toBe('chunked');

    controller.abort();
    await response.body.cancel().catch(() => {});
  });

  it('opens with a retry hint and a full snapshot frame', async () => {
    await ingest(snapshotFixture({ seq: 1, uptime: 10 }));
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/stream?dev=fg-01`, { signal: controller.signal });
    const reader = response.body.getReader();

    const { buffer, data } = await readUntil(reader, hasEvent('snapshot'));
    expect(buffer).toContain('retry: 3000');
    expect(data.device.dev).toBe('fg-01');
    expect(data.readings.temperature_c).toBe(4.2);
    expect(data.inventory).toHaveLength(1);
    expect(frameIds(buffer)).toHaveLength(1); // the opening frame is not a replay frame

    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it('sends a device list when no dev filter is given', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/stream`, { signal: controller.signal });
    const reader = response.body.getReader();
    const { data } = await readUntil(reader, hasEvent('devices'));
    expect(data.devices.map((device) => device.dev)).toContain('fg-01');
    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it('emits a heartbeat comment between frames', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/stream?dev=fg-01`, { signal: controller.signal });
    const reader = response.body.getReader();
    await readUntil(reader, hasEvent('snapshot'), { timeoutMs: 2000 });

    const heartbeat = await readUntil(
      reader,
      (buffer) => (buffer.includes(': heartbeat') ? { matched: true } : null),
      { timeoutMs: 2000 },
    );
    expect(heartbeat.matched).toBe(true);

    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it('pushes a new snapshot when a snapshot is accepted', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/stream?dev=fg-01`, { signal: controller.signal });
    const reader = response.body.getReader();
    await readUntil(reader, hasEvent('snapshot'), { timeoutMs: 2000 });

    await ingest(
      snapshotFixture({
        seq: 2,
        uptime: 20,
        state: { zone_status: 2, overall_status: 2 },
        readings: { temperature_c: 11.5 },
      }),
    );

    const pushed = await readUntil(
      reader,
      (buffer) => {
        const data = lastEventData('snapshot', buffer);
        return data && data.device.seq === 2 ? { data } : null;
      },
      { timeoutMs: 3000 },
    );

    expect(pushed.matched).toBe(true);
    expect(pushed.data.readings.temperature_c).toBe(11.5);
    expect(pushed.data.alerts.map((alert) => alert.condition_key)).toContain('zone_check_food');

    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it('does not push anything for a replayed snapshot', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/stream?dev=fg-01`, { signal: controller.signal });
    const reader = response.body.getReader();
    await readUntil(reader, hasEvent('snapshot'), { timeoutMs: 2000 });

    const replayed = await ingest(snapshotFixture({ seq: 2, uptime: 20 }));
    expect((await replayed.json()).outcome).toBe('stale');

    const quiet = await readUntil(
      reader,
      (buffer) => (buffer.includes('event: snapshot') ? { matched: true } : null),
      { timeoutMs: 400 },
    );
    expect(quiet.matched).toBe(false); // only heartbeats, no new state frame

    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it('replays frames after Last-Event-ID', async () => {
    const first = new AbortController();
    const opening = await fetch(`${baseUrl}/api/v1/stream?dev=fg-01`, { signal: first.signal });
    const openingReader = opening.body.getReader();
    const { buffer } = await readUntil(openingReader, hasEvent('snapshot'), { timeoutMs: 2000 });
    const lastId = Math.max(...frameIds(buffer));
    first.abort();
    await openingReader.cancel().catch(() => {});

    // Produce a frame the reconnecting client has not seen.
    await ingest(snapshotFixture({ seq: 3, uptime: 30, readings: { temperature_c: 3.9 } }));

    const second = new AbortController();
    const resumed = await fetch(`${baseUrl}/api/v1/stream?dev=fg-01`, {
      headers: { 'Last-Event-ID': String(lastId) },
      signal: second.signal,
    });
    const resumedReader = resumed.body.getReader();
    const replayed = await readUntil(
      resumedReader,
      (text) => {
        const payload = lastEventData('snapshot', text);
        return payload && payload.device.seq === 3 ? { data: payload } : null;
      },
      { timeoutMs: 2000 },
    );

    expect(replayed.matched).toBe(true);
    expect(replayed.data.readings.temperature_c).toBe(3.9);

    second.abort();
    await resumedReader.cancel().catch(() => {});
  });

  it('falls back to a resync frame when the requested id is out of the buffer', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/stream?dev=fg-01`, {
      headers: { 'Last-Event-ID': '1' },
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    // The ring holds 20 frames, so id 1 is long gone.
    const { matched, buffer } = await readUntil(reader, (text) =>
      text.includes('event: resync') || text.includes('event: snapshot') ? { matched: true } : null,
    );
    expect(matched).toBe(true);
    expect(buffer).toContain('event: resync');
    expect(JSON.parse(buffer.split('event: resync')[1].split('data: ')[1].split('\n')[0])).toMatchObject({
      reason: 'replay_buffer_exceeded',
    });

    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it('reports an unknown device as a stream error rather than an empty snapshot', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/stream?dev=ghost`, { signal: controller.signal });
    const reader = response.body.getReader();
    const { data } = await readUntil(reader, hasEvent('error'));
    expect(data.code).toBe('unknown_device');
    controller.abort();
    await reader.cancel().catch(() => {});
  });
});
