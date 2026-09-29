/**
 * CORS, security headers, and request logging behaviour.
 *
 * The two CORS rules that matter: the read API only answers an allowlisted
 * origin, and the ingest route carries no CORS headers at all.
 */
import { describe, expect, it } from 'vitest';
import { TEST_ORIGIN, makeTestStack } from './helpers.js';
import { snapshotFixture } from '../src/ingest/fixtures.js';

describe('CORS', () => {
  it('allows an allowlisted origin on the read API', async () => {
    const { get } = makeTestStack();
    const response = await get('/api/v1/devices').set('Origin', TEST_ORIGIN).expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(response.headers.vary).toContain('Origin');
  });

  it('withholds the allow-origin header from an unlisted origin', async () => {
    const { get } = makeTestStack();
    const response = await get('/api/v1/devices').set('Origin', 'https://evil.example').expect(200);
    // The request is still served: CORS is a browser-side control, and the
    // response simply carries no header that lets a browser read it.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight for an allowlisted origin', async () => {
    const { send } = makeTestStack();
    const response = await send('options')('/api/v1/devices')
      .set('Origin', TEST_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toContain('GET');
    expect(response.headers['access-control-max-age']).toBe('600');
  });

  it('never emits CORS headers on the ingest route', async () => {
    const { post } = makeTestStack();
    const response = await post('fg-01', snapshotFixture()).set('Origin', TEST_ORIGIN).expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('refuses to start with a wildcard allowlist', () => {
    expect(() => makeTestStack({ config: { FG_CORS_ORIGINS: '*' } })).toThrow(/wildcard/);
  });
});

describe('security headers', () => {
  it('sets helmet headers and hides the framework', async () => {
    const { get } = makeTestStack();
    const response = await get('/api/v1/devices').expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('echoes a safe inbound request id and ignores an unsafe one', async () => {
    const { get } = makeTestStack();
    const echoed = await get('/api/v1/devices').set('X-Request-Id', 'trace-42').expect(200);
    expect(echoed.headers['x-request-id']).toBe('trace-42');

    const injected = await get('/api/v1/devices').set('X-Request-Id', 'a'.repeat(500)).expect(200);
    expect(injected.headers['x-request-id']).not.toBe('a'.repeat(500));
  });
});

describe('access logging', () => {
  it('records the route pattern and status but never the body, key or query string', async () => {
    const lines = [];
    const logger = {
      error: (msg, fields) => lines.push({ msg, fields }),
      warn: (msg, fields) => lines.push({ msg, fields }),
      info: (msg, fields) => lines.push({ msg, fields }),
      debug: () => {},
    };

    const { post, get } = makeTestStack({ logger });
    await post('fg-01', snapshotFixture({ readings: { temperature_c: 12.34 } })).expect(200);
    await get('/api/v1/devices?secret=do-not-log').expect(200);

    const serialised = JSON.stringify(lines);
    expect(serialised).not.toContain('do-not-log');
    expect(serialised).not.toContain('X-FreshGuard-Key');
    expect(serialised).not.toContain('12.34');

    const ingestLine = lines.find((line) => line.fields.route?.includes('/snapshots'));
    expect(ingestLine.fields.route).toBe('/api/v1/ingest/devices/:dev/snapshots');
    expect(ingestLine.fields.status).toBe(200);
    expect(ingestLine.fields.device).toBe('fg-01');
    expect(ingestLine.fields.request_id).toBeTruthy();
  });

  it('turns an unexpected storage failure into 500 internal with no leaked cause', async () => {
    const lines = [];
    const logger = {
      error: (msg, fields) => lines.push({ msg, fields }),
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
    const { get, db } = makeTestStack({ logger });

    db.close(); // simulate the datastore going away underneath the service

    const response = await get('/api/v1/devices').expect(500);
    expect(response.body.error.code).toBe('internal');
    expect(response.body.error.message).toBe('internal error');
    expect(JSON.stringify(response.body)).not.toMatch(/sqlite|database/i);

    // The real cause is available to an operator in the logs.
    const logged = lines.find((line) => line.msg === 'request failed');
    expect(logged.fields.status).toBe(500);
    expect(logged.fields.error).toBeTruthy();
  });
});
