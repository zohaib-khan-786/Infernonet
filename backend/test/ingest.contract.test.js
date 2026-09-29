/**
 * Contract enforcement: strict validation, size limit, media type, auth.
 *
 * The device-facing error vocabulary is part of the contract, so these tests
 * assert on `error.code`, not on prose.
 */
import { describe, expect, it } from 'vitest';
import { TEST_KEY, WRONG_KEY, makeTestStack } from './helpers.js';
import { configFixture, eventFixture, itemFixture, snapshotFixture } from '../src/ingest/fixtures.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

describe('ingest contract', () => {
  it('accepts a complete snapshot and echoes the contract version', async () => {
    const { post } = makeTestStack();
    const response = await post('fg-01', snapshotFixture()).expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      outcome: 'stored',
      reason: 'first_contact',
      device: 'fg-01',
      seq: 1,
      contract_version: 1,
    });
  });

  it('rejects an unknown key with code unknown_key', async () => {
    const { post } = makeTestStack();
    const body = { ...snapshotFixture(), pressure_hpa_at_sea_level: 1013 };
    const response = await post('fg-01', body).expect(400);

    expect(response.body.error.code).toBe('unknown_key');
    expect(JSON.stringify(response.body.error.details)).toContain('pressure_hpa_at_sea_level');
  });

  it('rejects an unknown nested key inside state', async () => {
    const { post } = makeTestStack();
    const body = snapshotFixture({ state: { gas_state: 'ready', gas_ppm: 400 } });
    const response = await post('fg-01', body).expect(400);
    expect(response.body.error.code).toBe('unknown_key');
  });

  it('rejects a contract version other than 1', async () => {
    const { post } = makeTestStack();
    const response = await post('fg-01', snapshotFixture({ v: 2 })).expect(400);
    expect(response.body.error.code).toBe('invalid_snapshot');
  });

  it('rejects every missing required field', async () => {
    const { post } = makeTestStack();
    for (const key of ['v', 'seq', 'uptime', 'epoch', 'time_valid', 'inv_revision', 'pending_count', 'full', 'readings', 'state']) {
      const body = clone(snapshotFixture());
      delete body[key];
      const response = await post('fg-01', body).expect(400);
      expect(response.body.error.code, `missing ${key}`).toBe('invalid_snapshot');
    }
  });

  it('rejects a missing reading key, and accepts an explicit null', async () => {
    const { post } = makeTestStack();
    const missing = snapshotFixture({ readings: { temperature_c: 4.2 } });
    delete missing.readings.gas_delta_mv;
    expect((await post('fg-01a', missing)).status).toBe(400);

    const explicitNull = snapshotFixture({ readings: { temperature_c: 4.2, gas_delta_mv: null } });
    const accepted = await post('fg-01b', explicitNull).expect(200);
    expect(accepted.body.outcome).toBe('stored');
  });

  it('rejects out-of-range readings and negative counts', async () => {
    const { post } = makeTestStack();
    const cases = [
      snapshotFixture({ readings: { humidity_pct: 140 } }),
      snapshotFixture({ readings: { temperature_c: 400 } }),
      snapshotFixture({ readings: { gas_input_mv: -5 } }),
      snapshotFixture({ readings: { pressure_hpa: 10 } }),
      snapshotFixture({ seq: -1 }),
      snapshotFixture({ pending_count: -1 }),
      snapshotFixture({ state: { availability_mask: 70000 } }),
      snapshotFixture({ state: { zone_status: 7 } }),
    ];
    for (const body of cases) {
      const response = await post('fg-01', body);
      expect(response.status, JSON.stringify(body).slice(0, 120)).toBe(400);
      expect(response.body.error.code).toBe('invalid_snapshot');
    }
  });

  it('rejects more than 12 items and more than 4 events', async () => {
    const { post } = makeTestStack();
    const items = Array.from({ length: 13 }, (_, index) => itemFixture({ uid: `UID${index}` }));
    const tooManyItems = await post('fg-01', snapshotFixture({ items })).expect(400);
    expect(tooManyItems.body.error.code).toBe('invalid_snapshot');

    const events = Array.from({ length: 5 }, (_, index) => eventFixture({ event_id: 2000 + index }));
    const tooManyEvents = await post('fg-02', snapshotFixture({ events })).expect(400);
    expect(tooManyEvents.body.error.code).toBe('invalid_snapshot');
  });

  it('deduplicates repeated event ids inside one snapshot instead of failing it', async () => {
    const { post } = makeTestStack();
    const events = [eventFixture({ event_id: 7 }), eventFixture({ event_id: 7 })];
    const response = await post('fg-01', snapshotFixture({ events })).expect(200);
    expect(response.body.events).toEqual({ received: 2, inserted: 1, duplicates: 1 });
  });

  it('requires items when full is true, so an empty registry is expressible', async () => {
    const { post } = makeTestStack();
    const withoutItems = snapshotFixture({ full: true });
    delete withoutItems.items;
    expect((await post('fg-01', withoutItems)).status).toBe(400);

    const emptyRegistry = snapshotFixture({ full: true, items: [] });
    expect((await post('fg-02', emptyRegistry)).status).toBe(200);
  });

  it('rejects time_valid true with a zero epoch', async () => {
    const { post } = makeTestStack();
    const response = await post('fg-01', snapshotFixture({ time_valid: true, epoch: 0 })).expect(400);
    expect(response.body.error.code).toBe('invalid_snapshot');
  });

  // The clock-evidence block. These fields are what let a clock-trust rule tell
  // a real DS3231 reading from a server-corrected one, and they are OPTIONAL so
  // a build predating them keeps validating - the strict schema turns an unknown
  // key into a whole-snapshot rejection, which is how one added field once cost
  // every reading, every item and the entire config block.
  it('accepts the clock-evidence block and keeps it optional', async () => {
    const { post } = makeTestStack();

    // Absent entirely: a device build that predates the fields.
    const legacy = snapshotFixture();
    delete legacy.time_source;
    delete legacy.clock_offset_s;
    delete legacy.rtc_alive;
    delete legacy.rtc_battery_low;
    expect((await post('fg-01', legacy)).status).toBe(200);

    // Present, with a measured 5-hour correction. Negative is legal: a device
    // whose own clock runs FAST must be able to say so.
    for (const [id, offset] of [['fg-02', 17_946], ['fg-03', -3_600]]) {
      const body = snapshotFixture({
        time_source: 'server_synced',
        clock_offset_s: offset,
        rtc_alive: true,
        rtc_battery_low: true,
      });
      const response = await post(id, body).expect(200);
      expect(response.body.ok).toBe(true);
    }
  });

  it('accepts every time_source value and rejects an unknown one', async () => {
    const { post } = makeTestStack();
    for (const [index, source] of ['rtc', 'server_synced', 'rtc_offset', 'none'].entries()) {
      const body = snapshotFixture({ time_source: source, clock_offset_s: 0 });
      // `none` means no time, and the refine() rule forbids pairing it with
      // time_valid true - so that one case is asserted as a rejection below
      // rather than silently skipped here.
      if (source === 'none') {
        body.time_valid = false;
        body.epoch = 0;
      }
      expect((await post(`fg-1${index}`, body)).status, source).toBe(200);
    }

    const unknown = snapshotFixture({ time_source: 'ntp' });
    const rejected = await post('fg-99', unknown).expect(400);
    expect(rejected.body.error.code).toBe('invalid_snapshot');
  });

  it('rejects a clock_offset_s outside a physically possible clock error', async () => {
    const { post } = makeTestStack();
    for (const offset of [-90_000, 90_000, 1.5]) {
      const body = snapshotFixture({ time_source: 'server_synced', clock_offset_s: offset });
      const response = await post('fg-01', body);
      expect(response.status, String(offset)).toBe(400);
      expect(response.body.error.code).toBe('invalid_snapshot');
    }
  });

  // The device must never pair "I have no time" with "my time is valid", whatever
  // it claims the source is. time_valid is what gates the whole date layer, so a
  // device that sets it true with epoch 0 would have every food item evaluated
  // against a time the service does not have.
  it('rejects time_valid true whenever the epoch is absent, whatever the source', async () => {
    const { post } = makeTestStack();
    for (const source of ['rtc', 'server_synced', 'rtc_offset', 'none']) {
      const body = snapshotFixture({ time_source: source, time_valid: true, epoch: 0 });
      const response = await post('fg-01', body).expect(400);
      expect(response.body.error.code, source).toBe('invalid_snapshot');
    }
  });

  it('rejects an invalid device id in the path', async () => {
    const { post } = makeTestStack();
    const response = await post('bad id!', snapshotFixture()).expect(400);
    expect(response.body.error.code).toBe('invalid_snapshot');
  });

  it('rejects a config block with an unknown threshold key', async () => {
    const { post } = makeTestStack();
    const config = configFixture();
    config.thresholds.co2_ppm_max = 5000;
    const response = await post('fg-01', snapshotFixture({ config })).expect(400);
    expect(response.body.error.code).toBe('unknown_key');
  });

  it('rejects a body over the configured byte limit with 413 body_too_large', async () => {
    const { post } = makeTestStack();
    // The size gate fires before validation, so padding alone is enough.
    const oversized = JSON.stringify({ ...snapshotFixture(), pad: 'x'.repeat(5000) });
    expect(oversized.length).toBeGreaterThan(4096);

    const response = await post('fg-01', null, { raw: oversized }).expect(413);
    expect(response.body.error.code).toBe('body_too_large');
  });

  it('accepts a maximal 12-item snapshot that still fits the limit', async () => {
    const { post } = makeTestStack();
    const items = Array.from({ length: 12 }, (_, index) =>
      itemFixture({ uid: `UID${index}`, name: `Container-${index}` }),
    );
    const body = JSON.stringify(snapshotFixture({ items }));
    expect(body.length).toBeLessThan(4096);

    const response = await post('fg-01', snapshotFixture({ items })).expect(200);
    expect(response.body.inventory_active).toBe(12);
  });

  it('honours a smaller configured limit', async () => {
    const { post } = makeTestStack({ config: { FG_BODY_LIMIT_BYTES: '512' } });
    const response = await post('fg-01', snapshotFixture()).expect(413);
    expect(response.body.error.code).toBe('body_too_large');
  });

  it('rejects a non-JSON content type with 415', async () => {
    const { post } = makeTestStack();
    const response = await post('fg-01', snapshotFixture(), { contentType: 'text/plain', raw: 'v=1' }).expect(415);
    expect(response.body.error.code).toBe('unsupported_media_type');
  });

  it('rejects malformed JSON with invalid_snapshot, not internal', async () => {
    const { post } = makeTestStack();
    const response = await post('fg-01', null, { raw: '{"v":1,' }).expect(400);
    expect(response.body.error.code).toBe('invalid_snapshot');
  });

  it('rejects a missing or wrong credential with 401 unauthorized', async () => {
    const { app, post } = makeTestStack();
    const supertest = (await import('supertest')).default;

    const missing = await supertest(app)
      .post('/api/v1/ingest/devices/fg-01/snapshots')
      .set('Content-Type', 'application/json')
      .send(snapshotFixture())
      .expect(401);
    expect(missing.body.error.code).toBe('unauthorized');

    const wrong = await post('fg-01', snapshotFixture(), { key: WRONG_KEY }).expect(401);
    expect(wrong.body.error.code).toBe('unauthorized');
    expect(wrong.body.error.message).not.toContain(WRONG_KEY);
  });

  it('accepts a key that is a prefix or a superset of nothing valid', async () => {
    const { post } = makeTestStack();
    await post('fg-01', snapshotFixture(), { key: TEST_KEY.slice(0, -1) }).expect(401);
    await post('fg-01', snapshotFixture(), { key: `${TEST_KEY}x` }).expect(401);
  });

  it('rate limits ingest and answers with code rate_limited', async () => {
    const { post } = makeTestStack({ config: { FG_INGEST_RATE_LIMIT: '3' } });
    for (let index = 0; index < 3; index += 1) {
      await post('fg-01', snapshotFixture({ seq: index + 1, uptime: 100 + index })).expect(200);
    }
    const limited = await post('fg-01', snapshotFixture({ seq: 99, uptime: 199 })).expect(429);
    expect(limited.body.error.code).toBe('rate_limited');
  });

  it('never puts the credential, the body, or a query string in the error payload', async () => {
    const { post } = makeTestStack();
    const body = snapshotFixture({ state: { gas_state: 'ready', extra: 'leak-me' } });
    const response = await post('fg-01', body, { key: WRONG_KEY }).expect(401);
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain(WRONG_KEY);
    expect(serialised).not.toContain('leak-me');
  });
});
