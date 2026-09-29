/**
 * Tag identification: the scan event, and the lookup it feeds.
 *
 * SRS grounding, because the two halves of this file answer to different
 * requirements and the difference is the design:
 *
 *   - L105-108 / L157 / L305-308: identification is MANDATORY, and it is
 *     mandatory through a QR-code sticker carrying a UNIQUE IDENTIFICATION ID -
 *     "Scanning the QR code should allow the food item to be identified and its
 *     details to be retrieved or updated."
 *   - L542: "The system may include recipe suggestions, QR or RFID tracking..."
 *     RFID is therefore OPTIONAL, and so is the reader that produces the uid.
 *   - L227: "the gas sensor should not be used to identify which specific food
 *     item caused the [condition]".
 *
 * So the uid is the contract and the reader is one way of getting it. Everything
 * the API exposes is named `uid`, never `rfid`/`tag`/`scan`/`qr`, and the tests
 * below assert that - not as style, but because a camera-based QR scanner is
 * going to call the same route and the naming is what keeps that true.
 *
 * The four lookup outcomes are asserted by CODE, not by prose, because the
 * operator's next action differs for each and a caller must be able to branch
 * without reading English.
 */
import { describe, expect, it } from 'vitest';
import { insertReadings, makeTestStack } from './helpers.js';
import { BASE_EPOCH, DAY, eventFixture, itemFixture, scanEventFixture, snapshotFixture } from '../src/ingest/fixtures.js';

const DEV = 'fg-01';

/** Every (path, key, value) pair and every string leaf, for the leak scan. */
function walk(value, path = '$', out = { entries: [], strings: [] }) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`, out));
    return out;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.entries.push({ path: `${path}.${key}`, key, value: child });
      walk(child, `${path}.${key}`, out);
    }
    return out;
  }
  if (typeof value === 'string') out.strings.push({ path, value });
  return out;
}

describe('the scan event', () => {
  it('accepts rfid_scanned, and persists and returns the uid', async () => {
    const { post, get, db } = makeTestStack();

    const response = await post(DEV, snapshotFixture({ events: [scanEventFixture()] })).expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.events).toEqual({ received: 1, inserted: 1, duplicates: 0 });

    // Stored, verbatim, exactly as the device read it.
    const row = db.prepare('SELECT * FROM event WHERE event_id = 7').get();
    expect(row.type).toBe('rfid_scanned');
    expect(row.uid).toBe('1778F106');

    // And returned on the read side, so a dashboard can answer "when was this
    // tag last seen" without parsing the message text.
    const { body } = await get(`/api/v1/devices/${DEV}/events`).expect(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      event_id: 7,
      type: 'rfid_scanned',
      uid: '1778F106',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
  });

  it('round-trips the exact payload in the shared contract, uid and all', async () => {
    const { post, get } = makeTestStack();
    // The document a firmware agent is building against, byte for byte.
    const shared = {
      event_id: 7,
      type: 'rfid_scanned',
      uid: '1778F106',
      message: 'RFID tag 1778F106 presented',
      timestamp_epoch: 1790560198,
      time_valid: true,
    };
    await post(DEV, snapshotFixture({ epoch: 1790560198, events: [shared] })).expect(200);

    const { body } = await get(`/api/v1/devices/${DEV}/events`).expect(200);
    expect(body.events[0]).toMatchObject({ uid: '1778F106', type: 'rfid_scanned' });
    expect(body.events[0].timestamp).toBe('2026-09-28T01:49:58.000Z');
  });

  // THE SCHEMA-BREAK GUARD.
  //
  // `eventSchema` is strict, so a device that started sending `uid` while this
  // field did not exist would have had every snapshot rejected as an unknown
  // key - the reading, the state block, all twelve items and the config block,
  // gone, over one extra field. Adding `uid` must not have cost the eleven event
  // types that carry no tag anything, so the absent case is pinned here rather
  // than left to be discovered on a device that has already been flashed.
  it('still validates a pre-existing event type with no uid at all', async () => {
    const { post, get, db } = makeTestStack();

    // `eventFixture` deliberately has no `uid` key, and its default type is a
    // pre-existing one. Every firmware event type is exercised, not just this.
    for (const [index, type] of [
      'temperature_high',
      'temperature_low',
      'humidity_high',
      'humidity_low',
      'gas_relative_high',
      'door_open',
      'food_use_soon',
      'food_check',
      'sensor_fault',
      'storage_fault',
    ].entries()) {
      const body = snapshotFixture({ seq: index + 1, uptime: 10 + index, events: [eventFixture({ event_id: 500 + index, type })] });
      expect(body.events[0].uid, `${type} must not be given a uid by the fixture`).toBeUndefined();
      await post(DEV, body).expect(200);
    }

    const rows = db.prepare('SELECT uid FROM event ORDER BY event_id').all();
    expect(rows).toHaveLength(10);
    // Absent is NULL in the column, never an empty string or a sentinel.
    for (const row of rows) expect(row.uid).toBeNull();
  });

  it('rejects a uid that is not hex, rather than storing it', async () => {
    const { post } = makeTestStack();
    for (const uid of ['ZZZZ', '17 78', '1778F106-1', '0x1778', '', 'x'.repeat(65)]) {
      const body = snapshotFixture({ events: [scanEventFixture({ uid })] });
      const response = await post(DEV, body);
      expect(response.status, `uid ${JSON.stringify(uid)}`).toBe(400);
      expect(response.body.error.code).toBe('invalid_snapshot');
    }
  });

  // The event vocabulary is CLOSED. A firmware build that invents a type must be
  // told so immediately, rather than writing a row that looks like a real event
  // and that nothing will ever flag. `gas_state` and `time_source` are already
  // closed enums in this contract and an unknown value in either rejects the
  // whole snapshot; event types now behave the same way.
  it('rejects an event type the firmware invented', async () => {
    const { post, db } = makeTestStack();
    for (const type of ['rfid_scan', 'Rfid_Scanned', 'tag_scanned', 'scanned', '']) {
      const body = snapshotFixture({ events: [scanEventFixture({ type })] });
      const response = await post(DEV, body);
      expect(response.status, type).toBe(400);
      expect(response.body.error.code).toBe('invalid_snapshot');
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM event').get().n).toBe(0);
  });
});

describe('a scan is an observation, not a condition', () => {
  // A reader that has just been fitted meets tags nobody has registered. That is
  // the expected first outcome, so it must be stored as a fact with no side
  // effect: nothing created, nothing faulted, and no food-safety condition
  // derived from the fact that a stranger's tag was held near the cabinet.
  it('accepts a scan for an unregistered uid and creates and faults nothing', async () => {
    const { post, get, db } = makeTestStack();

    const response = await post(
      DEV,
      snapshotFixture({ items: [itemFixture({ uid: 'A1B2C3D4' })], events: [scanEventFixture({ uid: 'DEADBEEF' })] }),
    ).expect(200);

    // Normal acceptance: 200, and the event is recorded.
    expect(response.body.ok).toBe(true);
    expect(response.body.events).toEqual({ received: 1, inserted: 1, duplicates: 0 });
    expect(db.prepare('SELECT uid FROM event WHERE type = ?').get('rfid_scanned').uid).toBe('DEADBEEF');

    // Nothing was created. The uid in the event is not a request to register
    // anything, and the message text is not mined for one either.
    const after = await get(`/api/v1/devices/${DEV}/inventory`).expect(200);
    expect(after.body.items.map((item) => item.uid)).toEqual(['A1B2C3D4']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM inventory_item WHERE uid = ?').get('DEADBEEF').n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM inventory_item').get().n).toBe(1);

    // No fault bit, of any class. R-10 makes a storage fault an administration
    // problem; a tag is neither a storage fault nor anything else, so the masks
    // must come back exactly as the device reported them.
    const current = await get(`/api/v1/devices/${DEV}/current`).expect(200);
    expect(current.body.device.confirmed_fault_mask).toBe(0);
    expect(current.body.device.availability_mask).toBe(0);
    expect(current.body.device.confirmed_faults).toEqual([]);
    expect(current.body.device.unavailable).toEqual([]);

    const alerts = await get(`/api/v1/devices/${DEV}/alerts`).expect(200);
    expect(alerts.body.alerts).toEqual([]);
    // Belt and braces on the vocabulary itself: no condition key anywhere claims
    // a storage fault, and no item-scoped condition appeared out of nowhere.
    const keys = alerts.body.alerts.map((alert) => alert.condition_key);
    expect(keys.filter((key) => key.startsWith('storage_fault:'))).toEqual([]);
    expect(keys.filter((key) => key.startsWith('item_'))).toEqual([]);

    // The device row is untouched by the scan as well: no pending_count change,
    // no revision, nothing that would make an operator think the reader is
    // managing the registry.
    const device = db.prepare('SELECT * FROM device WHERE dev = ?').get(DEV);
    expect(device.confirmed_fault_mask).toBe(0);
    expect(device.availability_mask).toBe(0);
    expect(device.inv_revision).toBe(1);
  });

  it('does not fault when the cabinet reports Sensor Fault at the same time as a scan', async () => {
    // The two are independent axes and must stay so: the scan is not the cause
    // and the fault is not raised by the scan.
    const { post, get, db } = makeTestStack();
    await post(
      DEV,
      snapshotFixture({
        state: { zone_status: 3, overall_status: 3, availability_mask: 1 << 4 },
        events: [scanEventFixture({ uid: 'DEADBEEF' })],
      }),
    ).expect(200);

    const current = await get(`/api/v1/devices/${DEV}/current`).expect(200);
    // The clock condition the device itself reported, and nothing invented.
    expect(current.body.device.unavailable.map((bit) => bit.name)).toEqual(['ds3231']);
    expect(current.body.alerts.every((alert) => alert.kind !== 'storage_fault')).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM inventory_item').get().n).toBe(1);
  });
});

describe('lookup by uid', () => {
  const seed = async (stack, atEpoch = BASE_EPOCH) =>
    stack.post(DEV, snapshotFixture({
      epoch: atEpoch,
      items: [itemFixture({ uid: '1778F106', name: 'Milk', store_date_epoch: BASE_EPOCH, duration_limit_days: 7 })],
    })).expect(200);

  it('returns the item in the /inventory shape, with its computed freshness', async () => {
    const stack = makeTestStack();
    const { post, get, clock, db } = stack;
    // 6 days into a 7 day window, with the device clock agreeing with the server
    // and a reading history inside the engine's window, so the date layer is
    // evaluated rather than degraded to insufficient_data.
    const at = BASE_EPOCH + 6 * DAY;
    clock.set(new Date(at * 1000).toISOString());
    await seed(stack, at);
    insertReadings(stack, { startIso: new Date(at * 1000).toISOString(), count: 30, stepSeconds: 60, temperatureC: 4 });

    const found = await get(`/api/v1/devices/${DEV}/inventory/1778F106`).expect(200);
    expect(found.body.dev).toBe(DEV);
    expect(found.body.uid).toBe('1778F106');

    const item = found.body.item;
    expect(item.uid).toBe('1778F106');
    expect(item.name).toBe('Milk');
    // Details AND status in one response: the device's own verdict, the derived
    // dates, and the server-computed freshness.
    expect(item.status).toEqual({ code: 0, label: 'fresh' });
    expect(item.store_date).toBe('2025-01-01T00:00:00.000Z');
    expect(item.derived.deadline_source).toBe('duration');
    expect(item.derived.remaining_seconds).toBe(DAY);
    expect(item.freshness).not.toBeNull();
    expect(item.freshness.uid).toBe('1778F106');
    expect(item.freshness.status).toBe('use_soon');

    // The same shape /inventory already returns, byte for byte, so a consumer
    // that learned the item shape from the list endpoint needs to learn nothing
    // new here. Compared against the live list rather than restating it.
    const list = await get(`/api/v1/devices/${DEV}/inventory`).expect(200);
    expect(item).toEqual(list.body.items.find((entry) => entry.uid === '1778F106'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM inventory_item').get().n).toBe(1);
  });

  it('answers 409 uid_retired, saying when, for a tag withdrawn from service', async () => {
    const { post, get } = makeTestStack();
    await seed({ post });
    // The tag is absent from the next full registry, so the device retired it.
    await post(DEV, snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [], events: [] })).expect(200);

    const response = await get(`/api/v1/devices/${DEV}/inventory/1778F106`).expect(409);
    expect(response.body.error.code).toBe('uid_retired');
    // "When" is machine-readable, not only prose.
    expect(response.body.error.context).toMatchObject({
      uid: '1778F106',
      retired: true,
      retired_at_revision: 2,
    });
    expect(Date.parse(response.body.error.context.retired_at)).not.toBeNaN();
    // And said in words too, so a human reading a log gets it too.
    expect(response.body.error.message).toMatch(/retired/i);
    expect(response.body.error.message).toContain('1778F106');

    // 409, not 200 and not 404: a withdrawn tag is neither a usable item nor a
    // tag that was never registered.
    expect(response.body.item).toBeUndefined();
  });

  it('answers 404 unknown_uid for a tag that was never registered', async () => {
    const { post, get } = makeTestStack();
    await seed({ post });

    const response = await get(`/api/v1/devices/${DEV}/inventory/DEADBEEF`).expect(404);
    expect(response.body.error.code).toBe('unknown_uid');
    // A distinct code from the retired case, so a caller branches on the code
    // rather than on a message.
    expect(response.body.error.code).not.toBe('uid_retired');
  });

  it('answers 400 for a uid that is not hex, and never 404', async () => {
    const { post, get } = makeTestStack();
    await seed({ post });

    for (const uid of ['ZZZZ', '17-78', '0x1778F106', 'x'.repeat(65)]) {
      const response = await get(`/api/v1/devices/${DEV}/inventory/${uid}`);
      // A malformed value and a missing one are different problems, so a
      // malformed one is never dressed up as "not found" - which would tell the
      // caller to go and register a tag when the real fault is their scanner.
      expect(response.status, uid).toBe(400);
      expect(response.body.error.code).toBe('bad_request');
    }
  });

  it('keeps the three answers distinguishable by code alone', async () => {
    const { post, get } = makeTestStack();
    await seed({ post });
    await post(DEV, snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [itemFixture({ uid: 'A1B2C3D4', name: 'Tomatoes' })] })).expect(200);

    const found = await get(`/api/v1/devices/${DEV}/inventory/A1B2C3D4`);
    const retired = await get(`/api/v1/devices/${DEV}/inventory/1778F106`);
    const unknown = await get(`/api/v1/devices/${DEV}/inventory/DEADBEEF`);
    const malformed = await get(`/api/v1/devices/${DEV}/inventory/ZZZZ`);

    expect([found.status, retired.status, unknown.status, malformed.status]).toEqual([200, 409, 404, 400]);
    const codes = [found, retired, unknown, malformed].map((response) => response.body.error?.code ?? 'ok');
    expect(codes).toEqual(['ok', 'uid_retired', 'unknown_uid', 'bad_request']);
    expect(new Set(codes).size).toBe(4);
  });

  it('reports unknown_device for a device that never reported, not unknown_uid', async () => {
    const { get } = makeTestStack();
    const response = await get('/api/v1/devices/never-seen/inventory/1778F106').expect(404);
    // Both are 404, so the code is the only way to tell "this cabinet is not
    // there" from "this cabinet has no such tag".
    expect(response.body.error.code).toBe('unknown_device');
  });

  // The uid is the contract and the reader is optional (SRS L542). A camera-based
  // QR scanner is going to call this route; these tests are the guarantee that it
  // can, unchanged.
  it('exposes no reader-specific naming in the route, the body or the codes', async () => {
    const { post, get } = makeTestStack();
    await seed({ post });
    await post(DEV, snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [] })).expect(200);

    const responses = [
      await get(`/api/v1/devices/${DEV}/inventory/DEADBEEF`).expect(404),
      await get(`/api/v1/devices/${DEV}/inventory/ZZZZ`).expect(400),
      await get(`/api/v1/devices/${DEV}/inventory/1778F106`).expect(409),
    ];
    for (const response of responses) {
      const { entries } = walk(response.body);
      const named = entries.filter((entry) => /rfid|reader|scan|tag|qr|nfc|barcode/i.test(entry.key));
      expect(named.map((entry) => entry.path)).toEqual([]);
    }
    // And the path itself, which is the part a future contributor copies.
    expect('/api/v1/devices/fg-01/inventory/1778F106').not.toMatch(/rfid|scan|tag|qr/i);
  });

  // Registered after `/inventory/export.csv` deliberately, because Express matches
  // in order and `:uid` would otherwise bind to the literal "export.csv".
  it('does not capture the CSV export route', async () => {
    const { post, get } = makeTestStack();
    await seed({ post });
    const response = await get(`/api/v1/devices/${DEV}/inventory/export.csv`).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('1778F106');
  });
});

describe('SRS L227: a tag never identifies which item caused a condition', () => {
  // L227: "the gas sensor should not be used to identify which specific food
  // item caused the [condition]". Identifying a tag says WHICH ITEM IS PRESENT.
  // It must never say which item a reading belongs to or caused anything - that
  // is a different claim, and one MQ-135 over a shared cabinet cannot support.
  it('carries no attribution of a condition to the identified item', async () => {
    const stack = makeTestStack();
    const { post, get, clock } = stack;
    // 6 days into a 7 day window, the device clock agreeing with the server, and
    // a reading history in the engine's window: the date layer is evaluated
    // rather than withheld, which is the case in which a leak would be most
    // tempting.
    const at = BASE_EPOCH + 6 * DAY;
    clock.set(new Date(at * 1000).toISOString());
    // A cabinet in a critical condition, and a scan of the tag, in the same
    // snapshot: exactly the situation where an implementation could be tempted
    // to join the two.
    await post(DEV, snapshotFixture({
      epoch: at,
      readings: { temperature_c: 18.4, humidity_pct: 92, gas_delta_mv: 180 },
      state: { zone_status: 2, overall_status: 2, gas_state: 'ready' },
      items: [itemFixture({ uid: '1778F106', name: 'Milk' })],
      events: [scanEventFixture({ uid: '1778F106' })],
    })).expect(200);
    // A history of out-of-band air, so the cabinet condition is critical for a
    // stated reason rather than by default.
    insertReadings(stack, {
      startIso: new Date(at * 1000).toISOString(),
      count: 30,
      stepSeconds: 60,
      temperatureC: 18.4,
    });

    const found = await get(`/api/v1/devices/${DEV}/inventory/1778F106`).expect(200);
    const { entries, strings } = walk(found.body);

    // No key asserts the item CAUSED anything. `used_in_status` is the one that
    // has to be checked by value, not by name - it is the legitimate form of
    // "this item's verdict references the cabinet condition".
    const accusing = entries.filter((entry) =>
      /cause|caused|culprit|blame|responsible|at_fault|offending|triggered_by|originated|guilty|culprit_uid/i.test(entry.key));
    expect(accusing.map((entry) => entry.path)).toEqual([]);

    // The cabinet condition is present, but only as a reference, and it says so.
    const cabinet = found.body.item.freshness.evidence.cabinet_derived;
    expect(cabinet.applies).toBe(true);
    expect(cabinet.used_in_status).toBe(true);
    expect(cabinet.measured).toBe('cabinet_air');
    expect(cabinet.note).toContain("the item's own temperature is not measured");
    expect(cabinet.attribution).toContain('cabinet air');

    // No item temperature, and no per-item gas. Both are the concrete forms the
    // leak would take.
    for (const flag of entries.filter((entry) => entry.key === 'item_temperature_measured')) {
      expect(flag.value).toBe(false);
    }
    const suspicious = entries.filter((entry) => entry.key !== 'item_temperature_measured'
      && /item/i.test(entry.key) && /temp/i.test(entry.key));
    expect(suspicious.map((entry) => entry.path)).toEqual([]);
    const concentration = entries.filter((entry) => /ppm|parts_per_million|concentration|co2|vol_?frac/i.test(entry.key));
    expect(concentration.map((entry) => entry.path)).toEqual([]);

    // No string pairs the item with a temperature or a gas concentration number.
    for (const { path, value } of strings) {
      expect(value, `gas concentration at ${path}`).not.toMatch(/\d+(?:\.\d+)?\s*(?:ppm|ppb)\b/i);
      expect(value, `item temperature claim at ${path}`).not.toMatch(
        /\bitem\b[^.]{0,60}?-?\d+(?:\.\d+)?\s*(?:°|deg\b|degrees?\s*c\b|celsius)/i,
      );
    }

    // The gas reading is reported as cabinet air in millivolts, and the item
    // references it rather than owning it.
    const alerts = await get(`/api/v1/devices/${DEV}/alerts`).expect(200);
    const itemAlerts = alerts.body.alerts.filter((alert) => alert.kind === 'item');
    expect(itemAlerts.every((alert) => alert.uid === undefined)).toBe(true);
  });

  it('does not let a scan become an alert about the item it names', async () => {
    const { post, get } = makeTestStack();
    await post(DEV, snapshotFixture({
      items: [itemFixture({ uid: '1778F106', name: 'Milk' })],
      events: [scanEventFixture({ uid: '1778F106' })],
    })).expect(200);

    const alerts = await get(`/api/v1/devices/${DEV}/alerts`).expect(200);
    // The tag is known, the item is fine, and the scan is a record - not a
    // condition. Nothing here references the scanned uid at all.
    expect(alerts.body.alerts).toEqual([]);
    const serialised = JSON.stringify(alerts.body);
    expect(serialised).not.toContain('1778F106');
  });
});
