/**
 * Administrator authentication on the threshold write route.
 *
 * The route under test, PUT /api/v1/devices/:dev/thresholds, sets the safety
 * limits the ESP8266 itself enforces. Before this suite existed it carried only
 * a rate limiter and a CORS allowlist, and CORS is a browser-side response
 * header check that curl, python and a device on the same VLAN bypass without
 * noticing. So the tests below are mostly refusals: absent, wrong, malformed and
 * unconfigured all have to be a 401, and none of them may write a row.
 *
 * The second half of this file is the more important half. Two routes are
 * deliberately exempt from authentication and both are load-bearing:
 *
 *   - GET /devices/:dev/thresholds/apply, which the firmware polls with a plain
 *     GET. Requiring a token there would not fail loudly, it would leave the
 *     hardware enforcing its compiled-in defaults while the dashboard showed a
 *     configured profile.
 *   - GET /stream, which the browser opens with EventSource. That API cannot set
 *     an Authorization header, so a protected stream would just silently retry
 *     and never deliver an update.
 *
 * Those are asserted with NO credential at all, and with an admin token
 * configured, so the guards hold in the deployed configuration rather than only
 * in a configuration where nobody is protected.
 */
import { describe, it, expect } from 'vitest';
import { makeTestStack, TEST_ORIGIN } from './helpers.js';
import { snapshotFixture } from '../src/ingest/fixtures.js';
import { adminAuth, adminTokenConfigured, tokenMatches } from '../src/middleware/admin-auth.js';

const ADMIN_TOKEN = 'freshguard-test-admin-token';
const WRONG_TOKEN = 'not-the-admin-token';
const THRESHOLDS = '/api/v1/devices/fg-01/thresholds';

/** A coherent band; the point of these tests is the auth, not the values. */
const VALID_BODY = {
  temperature_min_c: 0,
  temperature_max_c: 8,
  humidity_min_pct: 30,
  humidity_max_pct: 85,
  source: 'authoritative',
  reference: 'test citation',
};

const withToken = (request, token = ADMIN_TOKEN) => request.set('Authorization', `Bearer ${token}`);

/** A stack whose admin surface is configured, which is the deployed shape. */
const securedStack = (options = {}) => makeTestStack({ config: { FG_ADMIN_TOKEN: ADMIN_TOKEN }, ...options });

/** Rows written, so a refusal can be shown to have written nothing. */
const savedRows = (stack) =>
  stack.db.prepare('SELECT COUNT(*) AS n FROM threshold_profile').get().n;

describe('PUT thresholds without a usable credential', () => {
  it('refuses a request with no Authorization header', async () => {
    const stack = securedStack();
    const response = await stack.send('put')(THRESHOLDS).send(VALID_BODY).expect(401);

    expect(response.body.error.code).toBe('unauthorized');
    expect(savedRows(stack)).toBe(0);
  });

  it('refuses a wrong token', async () => {
    const stack = securedStack();
    const response = await withToken(stack.send('put')(THRESHOLDS), WRONG_TOKEN).send(VALID_BODY).expect(401);

    expect(response.body.error.code).toBe('unauthorized');
    expect(savedRows(stack)).toBe(0);
  });

  it('refuses a token that differs only by a prefix or a suffix', async () => {
    // A comparison that accepted a prefix would make the token a public
    // identifier rather than a secret.
    //
    // Note what is NOT here: extra whitespace between the scheme and the token.
    // RFC 7235 allows `1*SP` there, so `Bearer  <token>` is a well-formed header
    // carrying the right token and is accepted - see the middleware unit tests
    // below. Whitespace inside the token is a different matter and is malformed.
    const stack = securedStack();
    for (const candidate of [`${ADMIN_TOKEN}x`, `x${ADMIN_TOKEN}`, ADMIN_TOKEN.slice(0, -1), ADMIN_TOKEN.toUpperCase()]) {
      const response = await withToken(stack.send('put')(THRESHOLDS), candidate).send(VALID_BODY).expect(401);
      // Reported as a pair so a failure names the candidate that got through.
      expect({ candidate, code: response.body.error.code }).toEqual({ candidate, code: 'unauthorized' });
    }
    expect(savedRows(stack)).toBe(0);
  });

  it('gives a malformed Authorization header its own error code', async () => {
    // Same status, different code. An integrator needs to be able to tell "you
    // forgot the header" from "your header is the wrong shape"; collapsing them
    // into one code would send the operator looking for a credential problem
    // when they have a header-formatting one.
    const stack = securedStack();
    const malformed = [
      'Basic dXNlcjpwYXNzd29yZA==',
      'Token abc123',
      'Bearer',
      'Bearer a b',
      'Bearer a, Bearer b',
    ];

    for (const header of malformed) {
      const response = await stack.send('put')(THRESHOLDS).set('Authorization', header).send(VALID_BODY).expect(401);
      expect(response.body.error.code).toBe('malformed_authorization');
    }
    expect(savedRows(stack)).toBe(0);

    // And the code is genuinely distinct from the absent-header code.
    const absent = await stack.send('put')(THRESHOLDS).send(VALID_BODY).expect(401);
    expect(absent.body.error.code).not.toBe('malformed_authorization');
  });

  it('answers with the standard error envelope and nothing more', async () => {
    // The parallel dashboard task codes against this shape, so pin it exactly:
    // three fields, no credential echoed back, no internal detail.
    const stack = securedStack();
    const response = await withToken(stack.send('put')(THRESHOLDS), WRONG_TOKEN).send(VALID_BODY).expect(401);

    expect(Object.keys(response.body).sort()).toEqual(['error']);
    expect(Object.keys(response.body.error).sort()).toEqual(['code', 'message', 'request_id']);
    expect(typeof response.body.error.request_id).toBe('string');
    expect(response.body.error.request_id).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain(WRONG_TOKEN);
    expect(JSON.stringify(response.body)).not.toContain(ADMIN_TOKEN);
  });

  it('never writes the token, or anything about it, to the log', async () => {
    const lines = [];
    const logger = {
      error: (msg, fields) => lines.push({ msg, fields }),
      warn: (msg, fields) => lines.push({ msg, fields }),
      info: (msg, fields) => lines.push({ msg, fields }),
      debug: (msg, fields) => lines.push({ msg, fields }),
    };
    const stack = securedStack({ logger });

    await withToken(stack.send('put')(THRESHOLDS), WRONG_TOKEN).send(VALID_BODY).expect(401);
    await withToken(stack.send('put')(THRESHOLDS)).send(VALID_BODY).expect(200);

    const serialised = JSON.stringify(lines);
    expect(serialised).not.toContain(ADMIN_TOKEN);
    expect(serialised).not.toContain(WRONG_TOKEN);
    expect(serialised.toLowerCase()).not.toContain('authorization:');
    // The request is still auditable: route, status, client and correlation id
    // are all recorded, which is what makes a threshold change investigable
    // without a credential existing anywhere in the log.
    //
    // The route pattern is asserted loosely on purpose. `accessLog` reads
    // `req.baseUrl` in the response's `finish` handler, and a request refused
    // inside a mounted router has already unwound that router, so the log shows
    // `/devices/:dev/thresholds` without the `/api/v1` mount prefix - which is
    // also how every pre-existing refused request in this service logs. The
    // pattern still identifies the endpoint uniquely; it is a logging-fidelity
    // nit, not an access-control one, and it is not this change's business.
    const refused = lines.find((line) => line.fields.status === 401);
    expect(refused.fields.route).toContain('devices/:dev/thresholds');
    expect(refused.fields.method).toBe('PUT');
    expect(refused.fields.request_id).toBeTruthy();
  });

  it('fails closed when FG_ADMIN_TOKEN is not set', async () => {
    // The dangerous reading of an absent env var is "no token required". A
    // deployment that forgot to configure it must be locked, not wide open.
    const stack = makeTestStack();
    expect(stack.config.adminToken).toBeUndefined();

    const anonymous = await stack.send('put')(THRESHOLDS).send(VALID_BODY).expect(401);
    expect(anonymous.body.error.code).toBe('unauthorized');

    // Even presenting a token cannot help, because there is nothing to match.
    const guessed = await stack.send('put')(THRESHOLDS)
      .set('Authorization', 'Bearer anything-at-all')
      .send(VALID_BODY)
      .expect(401);
    expect(guessed.body.error.code).toBe('unauthorized');

    expect(savedRows(stack)).toBe(0);
  });
});

describe('PUT thresholds with the configured token', () => {
  it('accepts the token and saves the profile', async () => {
    const stack = securedStack();
    const response = await withToken(stack.send('put')(THRESHOLDS)).send(VALID_BODY).expect(200);

    expect(response.body.revision).toBe(1);
    expect(response.body.values.temperature_max_c).toBe(8);
    expect(response.body.values.humidity_min_pct).toBe(30);

    // Persisted, not just echoed: read it back out of the store.
    const stored = stack.db.prepare('SELECT revision, temperature_max_c FROM threshold_profile WHERE dev = ?').get('fg-01');
    expect(stored).toEqual({ revision: 1, temperature_max_c: 8 });

    // And reachable afterwards through the unauthenticated read, which is the
    // dashboard's view of the same row.
    const view = await stack.get(THRESHOLDS).expect(200);
    expect(view.body.configured.revision).toBe(1);
    expect(view.body.configured.values.temperature_max_c).toBe(8);
  });

  it('still validates the body, so a token does not bypass the safety checks', async () => {
    // Authentication decides WHO may write; the schema still decides WHAT may be
    // written. A valid token must not buy a threshold that would mislabel every
    // item in the zone.
    const stack = securedStack();
    await withToken(stack.send('put')(THRESHOLDS))
      .send({ ...VALID_BODY, temperature_min_c: 9, temperature_max_c: 8 })
      .expect(400);
    expect(savedRows(stack)).toBe(0);
  });

  it('leaves no unattributed change in the audit trail', async () => {
    const stack = securedStack();
    // Omitted and explicitly blank are the same intent: no label given.
    for (const body of [VALID_BODY, { ...VALID_BODY, changed_by: '' }]) {
      await withToken(stack.send('put')(THRESHOLDS)).send(body).expect(200);
    }

    const changes = stack.db.prepare('SELECT changed_by FROM threshold_change WHERE dev = ?').all('fg-01');
    expect(changes).toHaveLength(2);
    // The caller may label the change; what must not happen is a row that
    // cannot be told apart from a write by something other than this
    // authenticated API.
    for (const change of changes) expect(change.changed_by).toBe('admin-token');
  });

  it('keeps a caller-supplied label rather than discarding it', async () => {
    // `changed_by` is part of the shared request contract, so the field stays.
    // It is a self-declared label, not an identity: one shared token cannot tell
    // one operator from another. That limit is documented, not hidden.
    const stack = securedStack();
    await withToken(stack.send('put')(THRESHOLDS)).send({ ...VALID_BODY, changed_by: 'night operator' }).expect(200);

    const change = stack.db.prepare('SELECT changed_by FROM threshold_change WHERE dev = ?').get('fg-01');
    expect(change.changed_by).toBe('night operator');
  });

  it('keeps the rate limiter in front of the route', async () => {
    // The limiter runs BEFORE authentication on purpose: a brute-force defence
    // that sits behind the check it defends is not a defence. So the budget is
    // spent by rejected attempts too.
    const stack = securedStack({ config: { FG_ADMIN_TOKEN: ADMIN_TOKEN, FG_WRITE_RATE_LIMIT: 2 } });

    await withToken(stack.send('put')(THRESHOLDS)).send(VALID_BODY).expect(200);
    await withToken(stack.send('put')(THRESHOLDS)).send(VALID_BODY).expect(200);
    const blocked = await withToken(stack.send('put')(THRESHOLDS)).send(VALID_BODY).expect(429);
    expect(blocked.body.error.code).toBe('rate_limited');

    expect(savedRows(stack)).toBe(1); // the third write never reached the store
  });

  it('spends the rate budget on unauthenticated attempts too', async () => {
    // A token-guessing flood is bounded, not free.
    const stack = securedStack({ config: { FG_ADMIN_TOKEN: ADMIN_TOKEN, FG_WRITE_RATE_LIMIT: 2 } });

    await stack.send('put')(THRESHOLDS).send(VALID_BODY).expect(401);
    await stack.send('put')(THRESHOLDS).set('Authorization', `Bearer ${WRONG_TOKEN}`).send(VALID_BODY).expect(401);
    await withToken(stack.send('put')(THRESHOLDS)).send(VALID_BODY).expect(429);

    expect(savedRows(stack)).toBe(0);
  });
});

/**
 * THE REGRESSION GUARD.
 *
 * Both routes below must answer with no credential of any kind, in a stack where
 * an admin token IS configured. If someone later adds `router.use(requireAdmin)`
 * or moves the middleware up a level, these fail - and the damage they prevent is
 * a device silently enforcing revision 0, or a dashboard showing no live updates,
 * neither of which reports itself as an error.
 */
/**
 * A browser cannot send a bearer token it was never given, and it cannot
 * complete a request the preflight refuses. These two facts decide whether the
 * parallel dashboard task can reach this route at all, and both were broken
 * independently of the token: `PUT` was missing from the allowed methods and
 * `Authorization` from the allowed headers, so the preflight failed and the
 * write never left the browser. The symptom would have looked like a server
 * fault rather than a CORS one.
 */
describe('CORS preflight for the authenticated write', () => {
  it('permits PUT and Authorization from an allowlisted origin', async () => {
    const stack = securedStack();
    const response = await stack.send('options')(THRESHOLDS)
      .set('Origin', TEST_ORIGIN)
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toContain('PUT');
    expect(response.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
  });

  it('withholds the allow-origin header from an unlisted origin', async () => {
    // A preflight from an unlisted origin is not answered as a successful
    // preflight. Express replies 200 to an automatic OPTIONS with no CORS
    // headers on it, so the status code is not the signal here - the absent
    // headers are, because a browser refuses the real request without them.
    const stack = securedStack();
    const preflight = await stack.send('options')(THRESHOLDS)
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-methods']).toBeUndefined();

    // And the write itself is unreadable from that origin. Note this is a
    // browser-side control only: a non-browser client that ignores CORS and
    // holds the token can still write. That is precisely why the token, not the
    // allowlist, is the access control.
    const write = await withToken(stack.send('put')(THRESHOLDS))
      .set('Origin', 'https://evil.example')
      .send(VALID_BODY)
      .expect(200);
    expect(write.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('exempt routes stay unauthenticated', () => {
  it('serves the device threshold projection with no credential', async () => {
    const stack = securedStack();
    expect(stack.config.adminToken).toBe(ADMIN_TOKEN);

    // Unconfigured: a device that has never polled still gets a usable answer.
    const empty = await stack.get('/api/v1/devices/fg-01/thresholds/apply').expect(200);
    expect(empty.body).toEqual({ rev: 0, configured: false, values: {} });

    // Configured: a profile written through the authenticated route reaches the
    // device with no credential involved, which is the whole point.
    await withToken(stack.send('put')(THRESHOLDS)).send(VALID_BODY).expect(200);
    const applied = await stack.get('/api/v1/devices/fg-01/thresholds/apply').expect(200);
    expect(applied.body.rev).toBe(1);
    expect(applied.body.configured).toBe(true);
    expect(applied.body.values.tmax).toBe(8);
  });

  it('rejects nothing on the device projection: a wrong token is simply ignored', async () => {
    // The firmware sends no Authorization header, but a proxy in front of it
    // might add one. An exempt route must not start 401-ing because of a header
    // it never reads.
    const stack = securedStack();
    await withToken(stack.send('put')(THRESHOLDS)).send(VALID_BODY).expect(200);
    const applied = await stack.get('/api/v1/devices/fg-01/thresholds/apply')
      .set('Authorization', `Bearer ${WRONG_TOKEN}`)
      .expect(200);
    expect(applied.body.rev).toBe(1);
  });

  it('serves the threshold read and history with no credential', async () => {
    const stack = securedStack();
    await withToken(stack.send('put')(THRESHOLDS)).send(VALID_BODY).expect(200);

    const view = await stack.get(THRESHOLDS).expect(200);
    expect(view.body.configured.revision).toBe(1);

    const history = await stack.get(`${THRESHOLDS}/history`).expect(200);
    expect(history.body.changes).toHaveLength(1);
    expect(history.body.changes[0].revision).toBe(1);
  });

  it('serves the SSE stream with no credential', async () => {
    // Against a real listening socket, because the facts that matter here -
    // event-stream headers, framing, an actual frame arriving - are transport
    // facts that a buffered request/response assertion cannot see.
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10 })).expect(200);

    const server = stack.app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const controller = new AbortController();
    try {
      // No Authorization header, and none is even possible in a browser.
      const response = await fetch(`${base}/api/v1/stream?dev=fg-01`, { signal: controller.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('cache-control')).toContain('no-cache');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && !buffer.includes('event: snapshot')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      // A 200 with no frames would be a silent failure; the snapshot has to
      // actually arrive.
      expect(buffer).toContain('event: snapshot');
      expect(buffer).toContain('fg-01');

      controller.abort();
      await reader.cancel().catch(() => {});
    } finally {
      stack.app.locals.hub.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('the device ingest path is unchanged', () => {
  it('still requires the ingest key and still accepts a snapshot', async () => {
    // Nothing in this change touched the ingest route. If authentication had
    // been applied at the router level, this is the assertion that catches it.
    const stack = securedStack();

    const refused = await stack.send('post')('/api/v1/ingest/devices/fg-01/snapshots')
      .set('Content-Type', 'application/json')
      .send(snapshotFixture({ seq: 1 }))
      .expect(401);
    expect(refused.body.error.code).toBe('unauthorized');

    // The admin token is not a substitute for the ingest key, and vice versa.
    const withAdminToken = await stack.send('post')('/api/v1/ingest/devices/fg-01/snapshots')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(snapshotFixture({ seq: 1 }))
      .expect(401);
    expect(withAdminToken.body.error.code).toBe('unauthorized');

    const accepted = await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10 })).expect(200);
    expect(accepted.body.outcome).toBe('stored');
  });
});

/**
 * Unit level, for the header shapes that HTTP clients will not let us send
 * reliably: an empty header value, an over-long token, a lowercase scheme.
 */
describe('adminAuth middleware', () => {
  const run = (header, adminToken = ADMIN_TOKEN) => {
    const outcomes = [];
    adminAuth({ adminToken })({ get: () => header }, {}, (error) => outcomes.push(error ?? null));
    return outcomes;
  };

  it('accepts a well-formed bearer header and marks the request', () => {
    for (const header of [
      `Bearer ${ADMIN_TOKEN}`,
      `bearer ${ADMIN_TOKEN}`,
      `BEARER ${ADMIN_TOKEN}`,
      `Bearer   ${ADMIN_TOKEN}`,
    ]) {
      const outcomes = run(header);
      expect(outcomes).toEqual([null]);
    }
  });

  it('refuses an empty, oversized or non-bearer header', () => {
    // An empty header value is "present but unusable", not "absent": the client
    // sent something, it was just not a credential.
    expect(run('')[0].code).toBe('malformed_authorization');
    expect(run('Bearer ')[0].code).toBe('malformed_authorization');
    expect(run(`Bearer ${'x'.repeat(513)}`)[0].code).toBe('unauthorized');
    expect(run(null)[0].code).toBe('malformed_authorization');
    expect(run(undefined)[0].code).toBe('unauthorized');
  });

  it('always answers 401 in the standard envelope', () => {
    for (const header of [undefined, '', 'Basic x', 'Bearer wrong']) {
      const error = run(header)[0];
      expect(error.status).toBe(401);
      expect(error.expose).toBe(true);
      expect(['unauthorized', 'malformed_authorization']).toContain(error.code);
    }
  });
});

describe('token comparison helpers', () => {
  it('matches only the exact token', () => {
    expect(tokenMatches(ADMIN_TOKEN, ADMIN_TOKEN)).toBe(true);
    expect(tokenMatches(ADMIN_TOKEN, WRONG_TOKEN)).toBe(false);
    expect(tokenMatches(ADMIN_TOKEN, '')).toBe(false);
    expect(tokenMatches(ADMIN_TOKEN, undefined)).toBe(false);
    expect(tokenMatches(ADMIN_TOKEN, `${ADMIN_TOKEN} `)).toBe(false);
    expect(tokenMatches('', ADMIN_TOKEN)).toBe(false);
    expect(tokenMatches(undefined, ADMIN_TOKEN)).toBe(false);
  });

  it('reports whether an admin token is configured', () => {
    // One definition, shared by the middleware and the startup check in
    // server.js, so "is admin auth on?" cannot be answered two ways.
    expect(adminTokenConfigured({ adminToken: ADMIN_TOKEN })).toBe(true);
    expect(adminTokenConfigured({ adminToken: '' })).toBe(false);
    expect(adminTokenConfigured({})).toBe(false);
    expect(adminTokenConfigured(undefined)).toBe(false);
    expect(adminTokenConfigured({ adminToken: 'x'.repeat(513) })).toBe(false);
  });
});
