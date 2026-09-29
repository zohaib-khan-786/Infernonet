/**
 * Administrator item registration.
 *
 * The feature under test is a command, not a write. The backend records the
 * dispatch durably (`admin_command`, migration 006), publishes `item.register`
 * on `freshguard/{dev}/cmd` and reports what the transport did; the device
 * creates the item, in its own registry, with its own store date and its own
 * verdict, and reports it back in the next snapshot - which is what resolves
 * the command to `confirmed`.
 *
 * Most of this file is refusal, and the refusals fall into three groups that
 * have to stay distinct:
 *
 *   401 - no usable administrator credential. Nothing is dispatched.
 *   400 - the body does not match the contract. Nothing is dispatched. The
 *         device must never receive a half-formed registration.
 *   503 - the transport cannot carry the command. This is the one that matters
 *         most, and the case the single-authority rule created: a dispatched-
 *         but-lost command that reports success is indistinguishable, from the
 *         dashboard, from a device that ignored the command. So it must never
 *         answer 200.
 *
 * The last describe block is the one that would be most expensive to get wrong.
 * It asserts that the POST creates no `inventory_item` row, and that the row
 * appears only when the device reports the item - with the DEVICE's values, not
 * the operator's. That is the regression guard for the whole design. The new
 * departments, meanwhile, pin the durability story: sequence numbers that are
 * monotonic per device and survive a restart, confirmation on ingest that is
 * idempotent, read-time expiry, and the status endpoint that reports it all.
 */
import { describe, it, expect } from 'vitest';
import { makeTestStack } from './helpers.js';
import { openDatabase } from '../src/db/index.js';
import { createCommandStore } from '../src/read/command-store.js';
import { BASE_EPOCH, DAY, itemFixture, snapshotFixture } from '../src/ingest/fixtures.js';
import {
  createItemRegistrationService,
  toWireCommand,
  itemRegisterBody,
  TransportUnavailable,
  CommandUnconfirmed,
  TRANSPORT_UNAVAILABLE,
  COMMAND_UNCONFIRMED,
  MAX_EPOCH_YEAR_2100,
  COMMAND_TTL_SECONDS,
} from '../src/read/item-registration.js';

const ADMIN_TOKEN = 'freshguard-test-admin-token';
const WRONG_TOKEN = 'not-the-admin-token';
const ITEMS = '/api/v1/devices/fg-01/items';

/** Exactly the shared wire contract, minus `op`. */
const REGISTER = {
  uid: '1778F106',
  name: 'Milk',
  category: 'Dairy',
  quantity: '1',
  location: 'Fridge',
  duration_days: 7,
  expiry_epoch: 0,
  manufacture_epoch: 0,
};

/** A stack whose admin surface is configured, which is the deployed shape. */
const securedStack = (options = {}) => makeTestStack({ config: { FG_ADMIN_TOKEN: ADMIN_TOKEN }, ...options });

const withToken = (request, token = ADMIN_TOKEN) => request.set('Authorization', `Bearer ${token}`);

/** POST a registration with the valid admin token. */
const register = (stack, body = REGISTER, token = ADMIN_TOKEN) =>
  withToken(stack.send('post')(ITEMS), token).send(body);

/**
 * A stand-in for a live broker, dropped into the one slot server.js fills.
 *
 * This is the whole seam: the app holds a mutable `mqttPublisher` that the
 * transport populates at boot, so a test can supply a transport without standing
 * up Mosquitto. `published` is the record of what actually went out, which is
 * how a test distinguishes "rejected before dispatch" from "dispatched".
 */
function connectTransport(stack, { failWith = null } = {}) {
  const published = [];
  stack.app.locals.mqttPublisher.publishCommand = (dev, command) => {
    published.push({ dev, command });
    return failWith ? Promise.reject(failWith) : Promise.resolve();
  };
  return published;
}

/** Every item row, active or retired, for any device. */
const itemRows = (stack) => stack.db.prepare('SELECT COUNT(*) AS n FROM inventory_item').get().n;

/** Every admin_command row for a device, oldest first. */
const commandRows = (stack, dev = 'fg-01') =>
  stack.db.prepare('SELECT * FROM admin_command WHERE dev = ? ORDER BY id').all(dev);

/** The durable per-device sequence counter, or null when never dispatched. */
const commandSeq = (stack, dev = 'fg-01') =>
  stack.db.prepare('SELECT last_seq FROM device_command_counter WHERE dev = ?').get(dev)?.last_seq ?? null;

/** Dispatch against a bare service and return whatever it threw. */
const dispatchError = (service, dev, uid) =>
  service.dispatch(dev, { uid }, {}).then(() => null, (error) => error);

describe('registration without a usable credential', () => {
  it('refuses a request with no Authorization header and dispatches nothing', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    const response = await stack.send('post')(ITEMS).send(REGISTER).expect(401);

    expect(response.body.error.code).toBe('unauthorized');
    // The limiter is in front of the auth check, so the credential was never
    // even looked at - and nothing was sent to the device on the way.
    expect(published).toHaveLength(0);
    expect(itemRows(stack)).toBe(0);
  });

  it('refuses a wrong token', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    const response = await register(stack, REGISTER, WRONG_TOKEN).expect(401);

    expect(response.body.error.code).toBe('unauthorized');
    expect(published).toHaveLength(0);
    expect(itemRows(stack)).toBe(0);
  });

  it('does not accept the device ingest key in place of the admin token', async () => {
    // The two credentials are for different worlds. Accepting the ingest key
    // here would hand a device-held secret the ability to register items.
    const stack = securedStack();
    const response = await stack.send('post')(ITEMS)
      .set('X-FreshGuard-Key', 'freshguard-test-device-key')
      .send(REGISTER)
      .expect(401);

    expect(response.body.error.code).toBe('unauthorized');
    expect(itemRows(stack)).toBe(0);
  });

  it('fails closed when FG_ADMIN_TOKEN is not set', async () => {
    // The dangerous reading of an absent env var is "no token required".
    const stack = makeTestStack();
    expect(stack.config.adminToken).toBeUndefined();

    const response = await withToken(stack.send('post')(ITEMS)).send(REGISTER).expect(401);
    expect(response.body.error.code).toBe('unauthorized');
    expect(itemRows(stack)).toBe(0);
  });
});

describe('the body is validated before anything is dispatched', () => {
  it('rejects a missing, blank, non-hex or over-long uid', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    const cases = [
      ['missing', (() => { const body = { ...REGISTER }; delete body.uid; return body; })()],
      ['empty', { ...REGISTER, uid: '' }],
      ['blank', { ...REGISTER, uid: '   ' }],
      ['not hex', { ...REGISTER, uid: 'ZZZZ' }],
      ['not hex, mixed', { ...REGISTER, uid: '1778F106G' }],
      ['separators that would break a topic', { ...REGISTER, uid: 'A1B2/C3D4' }],
      ['over the cap', { ...REGISTER, uid: 'A'.repeat(65) }],
    ];

    for (const [label, body] of cases) {
      const response = await register(stack, body);
      expect(response.status, `uid ${label}`).toBe(400);
      expect(response.body.error.code, `uid ${label}`).toBe('bad_request');
    }
    // Nothing was sent for any of them: a rejected request must not leave a
    // half-formed command on the device's topic.
    expect(published).toHaveLength(0);
    expect(itemRows(stack)).toBe(0);
  });

  it('rejects any string field over its cap', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    for (const field of ['name', 'category', 'quantity', 'location']) {
      // One over the cap, which is the boundary the caps were chosen for.
      const response = await register(stack, { ...REGISTER, [field]: 'x'.repeat(65) });
      expect(response.status, field).toBe(400);
      expect(response.body.error.code, field).toBe('bad_request');
    }
    expect(published).toHaveLength(0);
  });

  it('rejects a duration outside 0-3650', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    for (const duration_days of [-1, 3651, 7.5, '7', null, Number.NaN]) {
      const response = await register(stack, { ...REGISTER, duration_days });
      expect(response.status, String(duration_days)).toBe(400);
    }
    // The boundaries themselves are legal: zero means "no limit", ten years is
    // the contract's own maximum.
    await register(stack, { ...REGISTER, duration_days: 0 }).expect(200);
    await register(stack, { ...REGISTER, duration_days: 3650 }).expect(200);

    expect(published).toHaveLength(2);
  });

  it('rejects a negative or absurd epoch', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    for (const field of ['expiry_epoch', 'manufacture_epoch']) {
      for (const value of [-1, MAX_EPOCH_YEAR_2100 + 1, 2 ** 40, 1.5, '0']) {
        const response = await register(stack, { ...REGISTER, [field]: value });
        expect(response.status, `${field}=${value}`).toBe(400);
      }
    }
    // 0 is meaningful - "unknown", or "use duration_days" - and year 2100 is
    // the boundary, so neither may be rejected.
    await register(stack, { ...REGISTER, expiry_epoch: 0, manufacture_epoch: 0 }).expect(200);
    await register(stack, { ...REGISTER, expiry_epoch: MAX_EPOCH_YEAR_2100 }).expect(200);

    expect(published).toHaveLength(2);
  });

  it('refuses an `op` in the body, and any other undeclared key', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    // `op` is added on the way out by one function, so a body carrying its own
    // would be a body whose operation disagrees with the route it called.
    const withOp = await register(stack, { ...REGISTER, op: 'item.delete' }).expect(400);
    expect(withOp.body.error.code).toBe('bad_request');

    const unknown = await register(stack, { ...REGISTER, status: 3 }).expect(400);
    expect(unknown.body.error.code).toBe('bad_request');

    expect(published).toHaveLength(0);
  });

  it('answers with the standard error envelope and never echoes the body', async () => {
    // Pinned exactly: the dashboard codes against this shape, and a rejection
    // message can end up in a device or operator log.
    const stack = securedStack();
    connectTransport(stack);

    const response = await register(stack, { ...REGISTER, uid: 'not-hex-NOT-A-UID' }).expect(400);
    expect(Object.keys(response.body).sort()).toEqual(['error']);
    expect(Object.keys(response.body.error).sort()).toContain('code');
    expect(Object.keys(response.body.error).sort()).toContain('message');
    expect(Object.keys(response.body.error).sort()).toContain('request_id');
    expect(JSON.stringify(response.body)).not.toContain('NOT-A-UID');
  });

  it('rejects a device id that would produce a malformed topic', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    // The dev is a topic segment, so it goes through the same schema the ingest
    // route uses. Nothing is published onto a topic nobody asked for.
    const response = await withToken(stack.send('post')('/api/v1/devices/bad!id/items')).send(REGISTER);
    expect(response.status).toBe(400);
    expect(published).toHaveLength(0);
  });

  it('rejects a non-JSON content type with 415', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    const response = await withToken(stack.send('post')(ITEMS))
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(REGISTER))
      .expect(415);
    expect(response.body.error.code).toBe('unsupported_media_type');
    expect(published).toHaveLength(0);
  });

  it('answers 400 for malformed JSON and 413 for an oversized body, never 500', async () => {
    // The body parser throws before the handler runs, so these errors bypass the
    // route. If they were left untranslated the operator would see a 500 and
    // have no way to tell a malformed request from a dispatch that half-worked -
    // and the correct response to an ambiguous 503 is to retry.
    const stack = securedStack();
    const published = connectTransport(stack);

    const malformed = await withToken(stack.send('post')(ITEMS))
      .set('Content-Type', 'application/json')
      .send('{"uid":')
      .expect(400);
    expect(malformed.body.error.code).toBe('bad_request');
    expect(Object.keys(malformed.body.error).sort()).toEqual(['code', 'message', 'request_id']);

    const oversized = await withToken(stack.send('post')(ITEMS))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...REGISTER, name: 'x'.repeat(9000) }))
      .expect(413);
    expect(oversized.body.error.code).toBe('body_too_large');

    // Neither request was allowed to dispatch anything.
    expect(published).toHaveLength(0);
    expect(itemRows(stack)).toBe(0);
  });
});

describe('a transport that cannot carry the command is 503, never 200', () => {
  it('is 503 when no transport has been connected at all', async () => {
    // This is the deployed state whenever FG_MQTT_ENABLED is false, or the
    // broker is unreachable. The default app holds an empty publisher holder,
    // and a register attempt must surface that rather than report success.
    const stack = securedStack();

    const response = await register(stack);

    expect(response.status).not.toBe(200);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe(TRANSPORT_UNAVAILABLE);
    // The operator is told the item was NOT registered, and that retrying is the
    // next step. The attempt IS still recorded - as `failed`, so the status read
    // can explain the 503 later - but nothing is queued for redelivery; see
    // item-registration.js.
    expect(response.body.error.message).toMatch(/not registered/i);
    expect(itemRows(stack)).toBe(0);
  });

  it('is 503 when the transport reports itself disconnected', async () => {
    const stack = securedStack();
    connectTransport(stack, { failWith: new TransportUnavailable() });

    const response = await register(stack);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe(TRANSPORT_UNAVAILABLE);
  });

  it('is 503, with distinct wording, when the broker never confirms the publish', async () => {
    // The publish was handed to the client and the connection never confirmed
    // it. Whether the device got it is unknown, so the answer is not 200 - and
    // it is a different message from "not connected", because it is a different
    // fault and a different conversation for whoever is on call.
    const stack = securedStack();
    connectTransport(stack, { failWith: new CommandUnconfirmed('no puback within 5000ms') });

    const response = await register(stack);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe(COMMAND_UNCONFIRMED);
    expect(response.body.error.code).not.toBe(TRANSPORT_UNAVAILABLE);
    // The ambiguity is stated rather than resolved in the operator's favour.
    expect(response.body.error.message).toMatch(/unknown/i);
    expect(itemRows(stack)).toBe(0);
  });

  it('does not disguise an unexpected failure as a transport problem', async () => {
    // Anything that is neither of the two known transport outcomes is a bug or
    // a broker failure nobody anticipated. It is reported as 500 with the cause
    // in the log, rather than as a 503 that sends the operator looking at MQTT.
    const stack = securedStack();
    connectTransport(stack, { failWith: new Error('socket exploded') });

    const response = await register(stack);
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('internal');
    expect(response.body.error.message).toBe('internal error');
    expect(JSON.stringify(response.body)).not.toMatch(/socket exploded/i);
  });

  it('still logs a refusal at warn, with dev and uid and no free text', async () => {
    const lines = [];
    const stack = securedStack({
      logger: {
        error: (msg, fields) => lines.push({ msg, fields }),
        warn: (msg, fields) => lines.push({ msg, fields }),
        info: (msg, fields) => lines.push({ msg, fields }),
        debug: () => {},
      },
    });

    const response = await register(stack, { ...REGISTER, name: 'leak-me-'.repeat(30) }).expect(400);
    expect(response.status).toBe(400);

    const warned = lines.find((line) => line.msg === 'item.register rejected by validation');
    expect(warned).toBeTruthy();
    expect(warned.fields.request_id).toBeTruthy();
    // Field paths, not values: `name` is operator free text and the whole point
    // of this rejection is that it is longer than the cap allows.
    expect(warned.fields.fields).toEqual([{ path: 'name', code: 'too_big' }]);
    expect(JSON.stringify(lines)).not.toContain('leak-me');
    expect(JSON.stringify(lines)).not.toContain(ADMIN_TOKEN);
  });

  it('records the failed attempt so the status read can say why the answer was 503', async () => {
    const stack = securedStack();
    connectTransport(stack, { failWith: new TransportUnavailable() });

    const response = await register(stack).expect(503);
    expect(response.body.error.code).toBe(TRANSPORT_UNAVAILABLE);

    // The dispatch was recorded before the publish (recordDispatch), and the
    // transport refusal flips that row to `failed` with a timestamp.
    const rows = commandRows(stack);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].failed_at).toBe('2025-01-01T00:00:00.000Z');

    // The status read resolves it to `failed` - the wire never carried the
    // command, which is exactly what the operator needs to hear to retry.
    const status = await stack.get('/api/v1/devices/fg-01/commands/1778F106').expect(200);
    expect(status.body.state).toBe('failed');
    expect(status.body.commands[0].cmd_seq).toBe(1);

    // A retry gets a NEW sequence under the same device: the failed attempt is
    // a gap the device never saw, and the next command must be higher than
    // nothing.
    connectTransport(stack);
    const retry = await register(stack).expect(200);
    expect(retry.body.cmd_seq).toBe(2);
    expect(commandSeq(stack)).toBe(2);
  });
});

describe('a dispatch that is accepted', () => {
  it('answers 200 with the dispatched state and the durable dispatch facts', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    const response = await register(stack).expect(200);

    // Pinned exactly for the parallel dashboard task. The word is
    // "dispatched", NOT "applied": the device has not confirmed anything at this
    // point, and an "applied" here would be the backend claiming a decision it
    // does not own. The three additive fields are what make the dispatch
    // resolvable afterwards: the row id for the status read, the sequence the
    // device will dedupe on, and when the command stops being valid.
    expect(Object.keys(response.body).sort()).toEqual([
      'cmd_seq',
      'command_id',
      'dev',
      'expires_at_epoch',
      'state',
      'uid',
    ]);
    expect(response.body).toMatchObject({ dev: 'fg-01', uid: '1778F106', state: 'dispatched' });
    expect(response.body.command_id).toBeGreaterThan(0);
    expect(response.body.cmd_seq).toBe(1);
    // The fixed test clock starts at BASE_EPOCH, so the expiry boundary is
    // exactly one TTL later.
    expect(response.body.expires_at_epoch).toBe(BASE_EPOCH + COMMAND_TTL_SECONDS);
    expect(response.body.state).not.toBe('applied');
    expect(response.body.state).not.toBe('created');

    // The wire carried the same two durable fields the record holds.
    expect(published).toEqual([
      {
        dev: 'fg-01',
        command: {
          op: 'item.register',
          ...REGISTER,
          cmd_seq: 1,
          expires_at_epoch: BASE_EPOCH + COMMAND_TTL_SECONDS,
        },
      },
    ]);
  });

  it('publishes to the device command topic with the shared field names', async () => {
    // The topic and payload are shared with the firmware and the dashboard, so
    // they are asserted field by field rather than loosely.
    const stack = securedStack();
    const published = connectTransport(stack);
    await register(stack).expect(200);

    const [{ dev, command }] = published;
    expect(dev).toBe('fg-01');
    expect(Object.keys(command)).toEqual([
      'op',
      'uid',
      'name',
      'category',
      'quantity',
      'location',
      'duration_days',
      'expiry_epoch',
      'manufacture_epoch',
      'cmd_seq',
      'expires_at_epoch',
    ]);
    expect(command.op).toBe('item.register');
    expect(command.expiry_epoch).toBe(0);
    expect(command.manufacture_epoch).toBe(0);
    expect(command.cmd_seq).toBe(1);
    expect(command.expires_at_epoch).toBe(BASE_EPOCH + COMMAND_TTL_SECONDS);
  });

  it('omits absent fields rather than defaulting them to 0', async () => {
    // 0 is a real value on this wire - "use duration_days instead", "no limit",
    // "unknown" - so manufacturing one for a field the operator did not send
    // would destroy the distinction the device is relying on. The two fields
    // the SERVER adds (cmd_seq, expires_at_epoch) are still present: they are
    // not operator input, they are the dispatch's durable identity.
    const stack = securedStack();
    const published = connectTransport(stack);

    await register(stack, { uid: '1778F106' }).expect(200);

    expect(published[0].command).toEqual({
      op: 'item.register',
      uid: '1778F106',
      cmd_seq: 1,
      expires_at_epoch: BASE_EPOCH + COMMAND_TTL_SECONDS,
    });
    expect(Object.hasOwn(published[0].command, 'duration_days')).toBe(false);
    expect(Object.hasOwn(published[0].command, 'expiry_epoch')).toBe(false);
  });

  it('dispatches the uid exactly as sent, without normalising its case', async () => {
    // Upper-casing would be a guess about the firmware's convention, and a wrong
    // guess registers the item under a key the device does not hold.
    const stack = securedStack();
    const published = connectTransport(stack);

    await register(stack, { ...REGISTER, uid: '1778f106' }).expect(200);
    expect(published[0].command.uid).toBe('1778f106');
  });

  it('logs the dispatch at info with dev and uid', async () => {
    const lines = [];
    const stack = securedStack({
      logger: {
        error: (msg, fields) => lines.push({ msg, fields }),
        warn: () => {},
        info: (msg, fields) => lines.push({ msg, fields }),
        debug: () => {},
      },
    });
    connectTransport(stack);

    await register(stack).expect(200);

    const line = lines.find((entry) => entry.msg === 'item.register dispatched to device');
    expect(line).toBeTruthy();
    expect(line.fields.dev).toBe('fg-01');
    expect(line.fields.uid).toBe('1778F106');
    expect(line.fields.state).toBe('dispatched');
    expect(line.fields.request_id).toBeTruthy();
  });

  it('is rate limited like the other admin routes', async () => {
    const stack = securedStack({ config: { FG_ADMIN_TOKEN: ADMIN_TOKEN, FG_WRITE_RATE_LIMIT: 2 } });
    const published = connectTransport(stack);

    await register(stack).expect(200);
    await register(stack).expect(200);
    const limited = await register(stack).expect(429);
    expect(limited.body.error.code).toBe('rate_limited');
    // The third command never went out.
    expect(published).toHaveLength(2);
  });

  it('warns, but does not invent a status, when aimed at another device', async () => {
    // A known blind spot, asserted so it cannot quietly become a silent one: the
    // broker acknowledges a publish to any topic, so a registration aimed at the
    // wrong device id looks exactly like a correct one until the item fails to
    // appear. The response vocabulary is shared with the firmware and the
    // dashboard, so this stays a warning rather than a new rejection code.
    const lines = [];
    const stack = securedStack({
      logger: {
        error: (msg, fields) => lines.push({ msg, fields }),
        warn: (msg, fields) => lines.push({ msg, fields }),
        info: () => {},
        debug: () => {},
      },
    });
    const published = connectTransport(stack);

    const response = await withToken(stack.send('post')('/api/v1/devices/fg-99/items')).send(REGISTER).expect(200);
    expect(response.body).toMatchObject({ dev: 'fg-99', uid: '1778F106', state: 'dispatched' });

    const warned = lines.find((line) => line.msg === 'item.register aimed at a device this broker link is not configured for');
    expect(warned).toBeTruthy();
    expect(warned.fields.dev).toBe('fg-99');
    expect(warned.fields.expected_device).toBe(stack.config.mqttDeviceId);
    expect(warned.fields.uid).toBe('1778F106');
    expect(published).toHaveLength(1);
    expect(itemRows(stack)).toBe(0);
  });
});

describe('the command sequence is durable and strictly monotonic per device', () => {
  it('hands out 1, 2, 3 for three dispatches on one device', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);

    // Three dispatches of the same uid are exactly the retry story: every
    // attempt is its own command with its own sequence, so the device can tell
    // a retry from a replay by `cmd_seq` alone.
    const first = await register(stack).expect(200);
    const second = await register(stack).expect(200);
    const third = await register(stack).expect(200);

    expect([first.body.cmd_seq, second.body.cmd_seq, third.body.cmd_seq]).toEqual([1, 2, 3]);
    expect(published.map((entry) => entry.command.cmd_seq)).toEqual([1, 2, 3]);

    const rows = commandRows(stack);
    expect(rows.map((row) => row.cmd_seq)).toEqual([1, 2, 3]);
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set(['dispatched']));
    expect(commandSeq(stack)).toBe(3);
  });

  it('keeps per-device counters independent', async () => {
    const stack = securedStack();
    connectTransport(stack);

    await register(stack).expect(200); // fg-01 -> seq 1
    await withToken(stack.send('post')('/api/v1/devices/fg-02/items')).send(REGISTER).expect(200);

    expect(
      stack.db.prepare('SELECT dev, last_seq FROM device_command_counter ORDER BY dev').all(),
    ).toEqual([
      { dev: 'fg-01', last_seq: 1 },
      { dev: 'fg-02', last_seq: 1 },
    ]);
  });

  it('continues after a simulated restart', async () => {
    const stack = securedStack();
    const published = connectTransport(stack);
    await register(stack).expect(200);
    await register(stack).expect(200);
    expect(commandSeq(stack)).toBe(2);

    // A restart is a fresh store over the SAME database: no in-memory state may
    // survive, and the counter must resume from the persisted row rather than
    // starting at 1 (which would collide with the rows that already exist).
    const restarted = createCommandStore(stack.db);
    const restartedRow = restarted.recordDispatch({
      dev: 'fg-01',
      op: 'item.register',
      uid: '1778F106',
      dispatched_at: '2025-01-01T00:00:00.000Z',
      expires_at_epoch: BASE_EPOCH + COMMAND_TTL_SECONDS,
    });
    expect(restartedRow.cmd_seq).toBe(3);

    // The HTTP path rides the same counter: the next real dispatch is 4, not 1.
    const response = await register(stack, { ...REGISTER, uid: 'AAAA1111' }).expect(200);
    expect(response.body.cmd_seq).toBe(4);
    expect(published.map((entry) => entry.command.cmd_seq)).toEqual([1, 2, 4]);
    expect(commandSeq(stack)).toBe(4);
  });
});

describe('a device that reports the item confirms the command', () => {
  it('confirms a dispatched command when an accepted snapshot carries its uid', async () => {
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, inv_revision: 1, items: [] })).expect(200);
    connectTransport(stack);

    await register(stack).expect(200);
    expect(commandRows(stack)[0].status).toBe('dispatched');

    // The device echoes the item back - the command's resolution, exactly what
    // the dashboard has been waiting for.
    await stack.post(
      'fg-01',
      snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [itemFixture({ uid: '1778F106' })] }),
    ).expect(200);

    const row = commandRows(stack)[0];
    expect(row.status).toBe('confirmed');
    expect(row.confirmed_at).toBe('2025-01-01T00:00:00.000Z');

    // The status read agrees, and the item is visible in inventory too.
    const status = await stack.get('/api/v1/devices/fg-01/commands/1778F106').expect(200);
    expect(status.body.state).toBe('confirmed');
    expect(status.body.commands).toHaveLength(1);
    const inventory = await stack.get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.items.map((item) => item.uid)).toContain('1778F106');
  });

  it('re-confirmation is idempotent and does not move the timestamp', async () => {
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, inv_revision: 1, items: [] })).expect(200);
    connectTransport(stack);

    await register(stack).expect(200);
    const firstReport = await stack.post(
      'fg-01',
      snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [itemFixture({ uid: '1778F106' })] }),
    ).expect(200);
    expect(firstReport.body.outcome).toBe('stored');
    const first = commandRows(stack)[0];
    expect(first.status).toBe('confirmed');

    // The same uid keeps arriving (at-least-once transport, a retry, a later
    // full registry). None of it may rewrite the settled fact or add rows.
    await stack.post(
      'fg-01',
      snapshotFixture({ seq: 3, uptime: 30, inv_revision: 3, items: [itemFixture({ uid: '1778F106' })] }),
    ).expect(200);
    await stack.post(
      'fg-01',
      snapshotFixture({ seq: 4, uptime: 40, inv_revision: 4, items: [itemFixture({ uid: '1778F106' })] }),
    ).expect(200);

    const rows = commandRows(stack);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].confirmed_at).toBe(first.confirmed_at);
  });

  it('a snapshot for another device does not confirm this device command', async () => {
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [] })).expect(200);
    connectTransport(stack);

    await register(stack).expect(200);

    // The same uid appears on fg-02. The command was dispatched to fg-01, so
    // fg-02's report is another device's fact and must not resolve it.
    await stack.post('fg-02', snapshotFixture({ seq: 1, uptime: 10, items: [itemFixture({ uid: '1778F106' })] })).expect(200);

    expect(commandRows(stack)[0].status).toBe('dispatched');
  });

  it('a replayed snapshot cannot confirm', async () => {
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 2, uptime: 20, items: [itemFixture({ uid: '1778F106' })] })).expect(200);
    connectTransport(stack);

    // The item already existed before this command went out; only a NEW accepted
    // snapshot may confirm the command, never a replay of the old one.
    await register(stack).expect(200);
    expect(commandRows(stack)[0].status).toBe('dispatched');

    const replay = await stack.post('fg-01', snapshotFixture({ seq: 2, uptime: 20, items: [itemFixture({ uid: '1778F106' })] }));
    expect(replay.body.outcome).toBe('stale');
    expect(commandRows(stack)[0].status).toBe('dispatched');
  });
});

describe('a dispatched command resolves to expired when its window closes', () => {
  it('reports expired on the first status read after the TTL', async () => {
    const stack = securedStack();
    connectTransport(stack);

    await register(stack).expect(200);
    expect(commandRows(stack)[0].status).toBe('dispatched');

    // The window has not passed: reading early keeps it dispatched.
    stack.clock.advanceSeconds(COMMAND_TTL_SECONDS - 60);
    let status = await stack.get('/api/v1/devices/fg-01/commands/1778F106').expect(200);
    expect(status.body.state).toBe('dispatched');

    // Sixty seconds later the boundary crossed - and the FIRST read after it is
    // the one that resolves it: no background job, no separate sweep.
    stack.clock.advanceSeconds(60);
    status = await stack.get('/api/v1/devices/fg-01/commands/1778F106').expect(200);
    expect(status.body.state).toBe('expired');
    expect(status.body.commands[0].status).toBe('expired');

    const row = commandRows(stack)[0];
    expect(row.status).toBe('expired');
    expect(row.confirmed_at).toBeNull();
    expect(row.failed_at).toBeNull();

    // Settled: another read does not move it anywhere.
    status = await stack.get('/api/v1/devices/fg-01/commands/1778F106').expect(200);
    expect(status.body.state).toBe('expired');
  });

  it('does not rewrite an expired command when the item is reported later', async () => {
    // A command the device applied near its deadline still confirms only while
    // it is dispatched; once expired, the fact is settled. The item itself
    // still appears in /inventory - command state and item truth are separate.
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [] })).expect(200);
    connectTransport(stack);

    await register(stack).expect(200);

    // Time passes past the TTL and the read resolves the command to expired.
    stack.clock.advanceSeconds(COMMAND_TTL_SECONDS + DAY);
    let status = await stack.get('/api/v1/devices/fg-01/commands/1778F106').expect(200);
    expect(status.body.state).toBe('expired');

    // THEN the device reports the item. The item is in /inventory...
    stack.clock.set('2025-01-01T00:00:00.000Z');
    await stack.post(
      'fg-01',
      snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [itemFixture({ uid: '1778F106' })] }),
    ).expect(200);
    const inventory = await stack.get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.items.map((item) => item.uid)).toContain('1778F106');

    // ...and the command's expired verdict stays the command's own.
    status = await stack.get('/api/v1/devices/fg-01/commands/1778F106').expect(200);
    expect(status.body.state).toBe('expired');
    expect(commandRows(stack)[0].status).toBe('expired');
  });
});

describe('the command status read', () => {
  it('answers the history for a device and uid, newest first', async () => {
    const stack = securedStack();
    connectTransport(stack);

    await register(stack).expect(200);
    await register(stack).expect(200);

    const response = await stack.get('/api/v1/devices/fg-01/commands/1778F106').expect(200);
    expect(response.body.dev).toBe('fg-01');
    expect(response.body.uid).toBe('1778F106');
    expect(response.body.state).toBe('dispatched');
    expect(response.body.count).toBe(2);
    expect(response.body.commands.map((entry) => entry.cmd_seq)).toEqual([2, 1]);
    expect(response.body.commands[0].id).toBeGreaterThan(response.body.commands[1].id);
    expect(response.body.commands[0].expires_at_epoch).toBe(BASE_EPOCH + COMMAND_TTL_SECONDS);
    expect(response.body.commands[0].expires_at).toBe(new Date((BASE_EPOCH + COMMAND_TTL_SECONDS) * 1000).toISOString());
    expect(response.body.commands[0].dispatched_at).toBe('2025-01-01T00:00:00.000Z');
    expect(response.body.commands[0].confirmed_at).toBeNull();
    expect(response.body.commands[0].failed_at).toBeNull();
  });

  it('answers an empty history for a known device and a uid never dispatched', async () => {
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [] })).expect(200);

    const response = await stack.get('/api/v1/devices/fg-01/commands/AAAA0000').expect(200);
    expect(response.body).toEqual({ dev: 'fg-01', uid: 'AAAA0000', state: null, count: 0, commands: [] });
  });

  it('answers 404 for a device that has neither reported nor been dispatched to', async () => {
    const stack = securedStack();
    const response = await stack.get('/api/v1/devices/fg-77/commands/1778F106').expect(404);
    expect(response.body.error.code).toBe('unknown_device');
  });

  it('rejects a malformed uid with 400', async () => {
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [] })).expect(200);

    const response = await stack.get('/api/v1/devices/fg-01/commands/not-hex!').expect(400);
    expect(response.body.error.code).toBe('bad_request');
  });
});

describe('the durable command record (migration 006)', () => {
  it('creates both tables with the shapes the store relies on', () => {
    const stack = securedStack();

    const counter = stack.db.prepare('PRAGMA table_info(device_command_counter)').all().map((c) => c.name);
    expect(counter).toEqual(['dev', 'last_seq']);

    const command = stack.db.prepare('PRAGMA table_info(admin_command)').all().map((c) => c.name);
    for (const name of ['id', 'dev', 'op', 'uid', 'cmd_seq', 'expires_at_epoch', 'dispatched_at', 'status', 'confirmed_at', 'failed_at']) {
      expect(command).toContain(name);
    }
  });

  it('rejects an unknown status and a duplicated (dev, cmd_seq)', () => {
    const stack = securedStack();
    const db = stack.db;
    const insert = db.prepare(`
      INSERT INTO admin_command (dev, op, uid, cmd_seq, expires_at_epoch, dispatched_at, status)
      VALUES ('fg-01', 'item.register', ?, 1, 100, '2025-01-01T00:00:00.000Z', ?)
    `);

    // The status is constrained, so a typo cannot create a state the read side
    // does not know how to answer with.
    expect(() => insert.run('1778F106', 'maybe')).toThrow(/CHECK/i);

    insert.run('1778F106', 'dispatched');
    // The sequence is a database fact, not an application promise: two commands
    // with the same (dev, cmd_seq) are refused even if the counter were ever
    // bypassed.
    expect(() => insert.run('AAAABBBB', 'dispatched')).toThrow(/UNIQUE/i);
  });
});

/**
 * THE REGRESSION GUARD FOR THE WHOLE DESIGN.
 *
 * The device owns every item record. If this block ever fails, the backend has
 * become a second writer, and there are now two answers to "when does this go
 * off" - one of which nobody is watching.
 */
describe('the POST does not create an inventory_item row', () => {
  it('leaves the item datastore untouched and the device revision unchanged', async () => {
    const stack = securedStack();
    // A snapshot first, so the device row exists and the read API can answer.
    // The registry is empty, which makes "still empty" an unambiguous assertion.
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, inv_revision: 7, items: [] })).expect(200);
    const published = connectTransport(stack);

    const before = stack.db.prepare('SELECT inv_revision FROM device WHERE dev = ?').get('fg-01');
    const response = await register(stack).expect(200);
    expect(response.body.state).toBe('dispatched');

    // No item row. Not a placeholder, not a pending row, no row at all.
    expect(itemRows(stack)).toBe(0);

    // The COMMAND row is the one durable trace this write leaves (migration
    // 006) - the item row still appears only when the device reports it.
    expect(commandRows(stack)).toHaveLength(1);
    expect(commandRows(stack)[0].status).toBe('dispatched');

    // And the read API - the only place an item can be seen - agrees.
    const inventory = await stack.get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.items).toHaveLength(0);

    // The device's inventory revision is the device's to advance. A backend write
    // would have had to invent one, which is precisely what it must not do.
    const after = stack.db.prepare('SELECT inv_revision FROM device WHERE dev = ?').get('fg-01');
    expect(after.inv_revision).toBe(before.inv_revision);

    // The command did go out, though. Dispatched is not a no-op.
    expect(published).toHaveLength(1);
  });

  it('the row appears only when the device reports the item, with the DEVICE values', async () => {
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, inv_revision: 1, items: [] })).expect(200);
    connectTransport(stack);

    // The operator asked for "Milk" in the Fridge with a 7 day limit.
    await register(stack, { ...REGISTER, name: 'Milk', location: 'Fridge', duration_days: 7 }).expect(200);
    expect(itemRows(stack)).toBe(0);

    // The device reports the item. Everything about it is the device's: its own
    // uid it confirmed, its own store date from its own clock, its own verdict.
    // The operator's free-text name never reached the datastore.
    await stack.post(
      'fg-01',
      snapshotFixture({
        seq: 2,
        uptime: 20,
        inv_revision: 2,
        items: [
          itemFixture({
            uid: '1778F106',
            name: 'Semi-skimmed milk 2L',
            location: 'Top shelf',
            store_date_epoch: BASE_EPOCH + DAY,
            expiry_epoch: 0,
            duration_limit_days: 5,
            status: 1,
          }),
        ],
      }),
    ).expect(200);

    const row = stack.db.prepare('SELECT * FROM inventory_item WHERE uid = ?').get('1778F106');
    expect(row).toBeTruthy();
    expect(row.name).toBe('Semi-skimmed milk 2L');
    expect(row.location).toBe('Top shelf');
    expect(row.store_date_epoch).toBe(BASE_EPOCH + DAY);
    expect(row.duration_limit_days).toBe(5);
    expect(row.status_code).toBe(1);
    expect(row.last_revision).toBe(2);

    // The item is visible only now, which is what "dispatched" meant.
    const inventory = await stack.get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.items.map((item) => item.uid)).toEqual(['1778F106']);
  });

  it('a repeated dispatch of the same uid writes no second item row', async () => {
    // Every retry is its own durable command with its own sequence - the trace
    // grows, the item table does not. That is safe because the device is
    // idempotent on uid and the ingest upsert revives the existing row - and it
    // is safe HERE only because the backend never wrote an item row to duplicate.
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [] })).expect(200);
    const published = connectTransport(stack);

    await register(stack).expect(200);
    await register(stack).expect(200);
    expect(published).toHaveLength(2);
    expect(itemRows(stack)).toBe(0);
    expect(commandRows(stack)).toHaveLength(2);
    expect(commandRows(stack).map((row) => row.cmd_seq)).toEqual([1, 2]);

    await stack.post(
      'fg-01',
      snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [itemFixture({ uid: '1778F106' })] }),
    ).expect(200);
    await stack.post(
      'fg-01',
      snapshotFixture({ seq: 3, uptime: 30, inv_revision: 3, items: [itemFixture({ uid: '1778F106' })] }),
    ).expect(200);

    expect(itemRows(stack)).toBe(1);
  });

  it('writes nothing to the device or item tables even when the device is entirely unknown', async () => {
    // No device row, no snapshot, nothing to reconcile against. The dispatch
    // still goes out and the answer is still 200 dispatched - and still no item
    // row. The one thing written is the command's own durable record: dispatch
    // works before a device has ever reported, which is often exactly when the
    // command is needed.
    const stack = securedStack();
    const published = connectTransport(stack);

    await register(stack).expect(200);
    expect(published).toHaveLength(1);
    expect(itemRows(stack)).toBe(0);
    expect(stack.db.prepare('SELECT COUNT(*) AS n FROM device').get().n).toBe(0);
    expect(commandRows(stack)).toHaveLength(1);
    expect(commandRows(stack)[0].status).toBe('dispatched');
  });
});

/**
 * The field the device will start sending. Migration 003 adds the column; these
 * tests exist because a column that is never written is a column that never
 * appears, and it fails silently in the worst direction - the dashboard shows an
 * item with no manufacturing date and nobody can tell whether the device did not
 * know or the backend threw the value away.
 */
describe('manufacture_epoch survives the trip from the device to the database', () => {
  it('the migration added the column, nullable, to the existing table', () => {
    const stack = securedStack();
    const columns = stack.db.prepare('PRAGMA table_info(inventory_item)').all();
    const column = columns.find((entry) => entry.name === 'manufacture_epoch');
    expect(column).toBeTruthy();
    expect(column.type).toBe('INTEGER');
    // Not null-ness of the column: existing rows have no value for it, which is
    // exactly "unknown", and making it NOT NULL would have needed a backfill.
    expect(column.notnull).toBe(0);
    // The rest of the table is untouched by the migration.
    for (const name of ['uid', 'name', 'category', 'quantity', 'location', 'store_date_epoch', 'expiry_epoch', 'duration_limit_days', 'status_code', 'first_revision', 'last_revision', 'retired']) {
      expect(columns.map((entry) => entry.name)).toContain(name);
    }
  });

  it('accepts a snapshot carrying the field instead of rejecting the whole thing', async () => {
    // The item schema is strict. If the field were not declared, a device that
    // started sending it would have every snapshot refused as an unknown key -
    // losing the readings, the state block and every other item over one number.
    const stack = securedStack();
    const response = await stack.post(
      'fg-01',
      snapshotFixture({ items: [itemFixture({ uid: 'A1', manufacture_epoch: BASE_EPOCH })] }),
    ).expect(200);
    expect(response.body.outcome).toBe('stored');
  });

  it('stores a reported manufacturing date and surfaces it on the read API', async () => {
    const stack = securedStack();
    await stack.post(
      'fg-01',
      snapshotFixture({ items: [itemFixture({ uid: 'A1', manufacture_epoch: BASE_EPOCH - 2 * DAY })] }),
    ).expect(200);

    const row = stack.db.prepare('SELECT manufacture_epoch FROM inventory_item WHERE uid = ?').get('A1');
    expect(row.manufacture_epoch).toBe(BASE_EPOCH - 2 * DAY);

    const item = (await stack.get('/api/v1/devices/fg-01/inventory').expect(200)).body.items[0];
    expect(item.manufacture_epoch).toBe(BASE_EPOCH - 2 * DAY);
    expect(item.manufacture).toBe(new Date((BASE_EPOCH - 2 * DAY) * 1000).toISOString());
  });

  it('stores unknown as NULL, never as a 1970 date', async () => {
    const stack = securedStack();
    await stack.post(
      'fg-01',
      snapshotFixture({
        items: [itemFixture({ uid: 'ZERO', manufacture_epoch: 0 }), itemFixture({ uid: 'ABSENT', manufacture_epoch: undefined })],
      }),
    ).expect(200);

    const rows = stack.db.prepare('SELECT uid, manufacture_epoch FROM inventory_item ORDER BY uid').all();
    expect(rows).toEqual([
      { uid: 'ABSENT', manufacture_epoch: null },
      { uid: 'ZERO', manufacture_epoch: null },
    ]);

    const items = (await stack.get('/api/v1/devices/fg-01/inventory').expect(200)).body.items;
    for (const item of items) {
      expect(item.manufacture_epoch).toBeNull();
      expect(item.manufacture).toBeNull();
    }
  });

  it('updates the value when a later snapshot reports a different one', async () => {
    // Catches the half-done version of this change: a column added to the INSERT
    // but not to the ON CONFLICT clause, which would store the first value
    // forever and silently ignore every correction after it.
    const stack = securedStack();
    await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [itemFixture({ uid: 'A1' })] })).expect(200);
    expect(
      stack.db.prepare('SELECT manufacture_epoch FROM inventory_item WHERE uid = ?').get('A1').manufacture_epoch,
    ).toBeNull();

    await stack.post(
      'fg-01',
      snapshotFixture({
        seq: 2,
        uptime: 20,
        inv_revision: 2,
        items: [itemFixture({ uid: 'A1', manufacture_epoch: BASE_EPOCH })],
      }),
    ).expect(200);

    expect(
      stack.db.prepare('SELECT manufacture_epoch FROM inventory_item WHERE uid = ?').get('A1').manufacture_epoch,
    ).toBe(BASE_EPOCH);
  });
});

describe('the service unit, without a router', () => {
  it('refuses to be built without a transport or a command store', () => {
    expect(() => createItemRegistrationService()).toThrow(TypeError);
    // A transport without a durable record would be the old non-durable module;
    // a store without a transport would be a record that never reaches a device.
    expect(() => createItemRegistrationService({ publishCommand: () => Promise.resolve() })).toThrow(TypeError);
  });

  it('adds op itself and nothing else', () => {
    expect(toWireCommand({ uid: 'A1' })).toEqual({ op: 'item.register', uid: 'A1' });
    // Field order is the shared contract's, so a payload diff is readable.
    expect(Object.keys(toWireCommand(itemRegisterBody.parse(REGISTER)))).toEqual([
      'op',
      'uid',
      'name',
      'category',
      'quantity',
      'location',
      'duration_days',
      'expiry_epoch',
      'manufacture_epoch',
    ]);
  });

  it('maps both transport outcomes to 503, records both, and lets anything else through', async () => {
    const db = openDatabase({ path: ':memory:' });
    const service = (failWith) =>
      createItemRegistrationService({
        publishCommand: () => Promise.reject(failWith),
        commandStore: createCommandStore(db),
      });

    const unavailable = await dispatchError(service(new TransportUnavailable()), 'fg-01', 'A1');
    expect(unavailable.status).toBe(503);
    expect(unavailable.code).toBe(TRANSPORT_UNAVAILABLE);

    // The refused transports are recorded as `failed` rows, so the status read
    // can answer "what happened to my command" even when the process does not.
    let rows = db.prepare('SELECT * FROM admin_command ORDER BY id').all();
    expect(rows.map((row) => row.status)).toEqual(['failed']);

    const unconfirmed = await dispatchError(service(new CommandUnconfirmed()), 'fg-01', 'A1');
    expect(unconfirmed.status).toBe(503);
    expect(unconfirmed.code).toBe(COMMAND_UNCONFIRMED);

    rows = db.prepare('SELECT * FROM admin_command ORDER BY id').all();
    expect(rows.map((row) => row.status)).toEqual(['failed', 'failed']);
    // Both failed outputs keep the message that retrying is safe.
    expect(unavailable.expose).toBeTruthy();
    expect(unconfirmed.expose).toBeTruthy();

    // Not dressed up as a transport problem: a real fault stays a real fault.
    const bug = await dispatchError(service(new Error('boom')), 'fg-01', 'A1');
    expect(bug.status).toBeUndefined();
    expect(bug.message).toBe('boom');
  });

  it('resolves to the dispatched state once the transport confirms', async () => {
    const db = openDatabase({ path: ':memory:' });
    const service = createItemRegistrationService({
      publishCommand: () => Promise.resolve(),
      commandStore: createCommandStore(db),
      now: () => new Date(BASE_EPOCH * 1000),
    });
    await expect(service.dispatch('fg-01', { uid: 'A1' })).resolves.toEqual({
      dev: 'fg-01',
      uid: 'A1',
      state: 'dispatched',
      command_id: 1,
      cmd_seq: 1,
      expires_at_epoch: BASE_EPOCH + COMMAND_TTL_SECONDS,
    });
  });
});
