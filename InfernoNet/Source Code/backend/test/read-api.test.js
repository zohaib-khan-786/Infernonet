/**
 * Read API: devices, current, readings, inventory, CSV, events, alerts, ack,
 * plus health and readiness.
 */
import { describe, expect, it } from 'vitest';
import { makeTestStack, insertReadings } from './helpers.js';
import { BASE_EPOCH, DAY, eventFixture, itemFixture, snapshotFixture } from '../src/ingest/fixtures.js';

const seedTwoDevices = async (stack) => {
  await stack.post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [itemFixture({ uid: 'A' })] })).expect(200);
  await stack.post(
    'fg-02',
    snapshotFixture({
      seq: 1,
      uptime: 10,
      state: { zone_status: 2, overall_status: 2 },
      items: [itemFixture({ uid: 'B', name: 'Cheese', status: 2 })],
    }),
  ).expect(200);
};

describe('device list', () => {
  it('returns one summary per device with labels and counts', async () => {
    const stack = makeTestStack();
    await seedTwoDevices(stack);

    const response = await stack.get('/api/v1/devices').expect(200);
    expect(response.body.devices).toHaveLength(2);
    const first = response.body.devices[0];
    expect(first.dev).toBe('fg-01');
    expect(first.zone_status).toEqual({ code: 0, label: 'fresh' });
    expect(first.counts.inventory_active).toBe(1);
    expect(first.transport.stale).toBe(false);
  });

  it('is an empty list before any device has reported', async () => {
    const { get } = makeTestStack();
    const response = await get('/api/v1/devices').expect(200);
    expect(response.body.devices).toEqual([]);
  });

  it('reports 404 unknown_device for a device that never reported', async () => {
    const { get } = makeTestStack();
    const response = await get('/api/v1/devices/ghost/current').expect(404);
    expect(response.body.error.code).toBe('unknown_device');
  });
});

describe('current aggregate', () => {
  it('returns device, transport, readings, inventory and alerts in one response', async () => {
    const stack = makeTestStack();
    stack.clock.set(new Date((BASE_EPOCH + 3 * DAY) * 1000).toISOString());
    await stack.post(
      'fg-01',
      snapshotFixture({
        seq: 7,
        uptime: 900,
        inv_revision: 4,
        pending_count: 3,
        items: [itemFixture({ uid: 'A', name: 'Tomatoes', duration_limit_days: 10 })],
      }),
    ).expect(200);

    const { body } = await stack.get('/api/v1/devices/fg-01/current').expect(200);
    expect(body.device).toMatchObject({
      dev: 'fg-01',
      seq: 7,
      uptime_s: 900,
      boot_count: 0,
      inv_revision: 4,
      pending_count: 3,
      firmware: 'freshguard-0.1.0',
      door_timeout_ms: 30_000,
      consecutive_samples: 3,
    });
    expect(body.device.thresholds.temperature_max_c).toBe(8);
    expect(body.device.provenance.source).toBe('prototype_assumption');
    expect(body.readings.temperature_c).toBe(4.2);
    expect(body.inventory[0].derived.progress_percent).toBe(30);
    expect(body.counts).toMatchObject({ inventory_active: 1, inventory_retired: 0 });
    expect(body.transport.age_seconds).toBe(0);
    expect(body.transport.note).toContain('not a freshness verdict');
  });

  it('marks the transport stale after the configured age', async () => {
    const stack = makeTestStack();
    await stack.post('fg-01', snapshotFixture()).expect(200);
    stack.clock.advanceSeconds(120);

    const { body } = await stack.get('/api/v1/devices/fg-01/current').expect(200);
    expect(body.transport.age_seconds).toBe(120);
    expect(body.transport.stale).toBe(true);
    // The device's own verdict is untouched by link staleness.
    expect(body.device.zone_status.code).toBe(0);
  });

  it('reports uptime_reset and the boot count after a reboot', async () => {
    const { post, get } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 900, uptime: 90_000 })).expect(200);
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 5 })).expect(200);
    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(body.device.boot_count).toBe(1);
    expect(body.device.seq).toBe(1);
  });
});

describe('readings endpoint', () => {
  const seedSeries = async (stack, count = 6, stepSeconds = 20) => {
    for (let index = 0; index < count; index += 1) {
      stack.clock.set(new Date((BASE_EPOCH + index * stepSeconds) * 1000).toISOString());
      await stack
        .post(
          'fg-01',
          snapshotFixture({
            seq: index + 1,
            uptime: (index + 1) * stepSeconds,
            epoch: BASE_EPOCH + index * stepSeconds,
            readings: { temperature_c: 3 + index * 0.5, humidity_pct: 50 + index },
          }),
        )
        .expect(200);
    }
  };

  it('returns raw points for a narrow window', async () => {
    const stack = makeTestStack();
    await seedSeries(stack);
    stack.clock.set(new Date((BASE_EPOCH + 200) * 1000).toISOString());

    const { body } = await stack.get('/api/v1/devices/fg-01/readings?bucket=raw&from=2025-01-01T00:00:00Z').expect(200);
    expect(body.bucket).toBe('raw');
    expect(body.requested_bucket).toBe('raw');
    expect(body.points).toBe(6);
    expect(body.series[0].temperature_c).toBe(3);
    expect(body.series.at(-1).temperature_c).toBe(5.5);
  });

  it('aggregates server-side and averages within a bucket', async () => {
    const stack = makeTestStack();
    await seedSeries(stack, 6, 10);
    stack.clock.set(new Date((BASE_EPOCH + 200) * 1000).toISOString());

    const { body } = await stack.get('/api/v1/devices/fg-01/readings?bucket=1m&fields=temperature_c').expect(200);
    expect(body.fields).toEqual(['temperature_c']);
    expect(body.points).toBe(1);
    // Six samples 10 s apart, 3.0 to 5.5 -> mean 4.25.
    expect(body.series[0].temperature_c).toBeCloseTo(4.25, 5);
    expect(body.series[0].samples).toBe(6);
  });

  it('coarsens the bucket rather than exceeding the point cap', async () => {
    const stack = makeTestStack();
    await stack.post('fg-01', snapshotFixture()).expect(200);
    // 600 raw samples, ten hours at one-minute spacing.
    insertReadings(stack, { count: 600, stepSeconds: 60 });
    const from = new Date(BASE_EPOCH * 1000).toISOString();
    const to = new Date((BASE_EPOCH + 600 * 60) * 1000).toISOString();

    const { body } = await stack.get(
      `/api/v1/devices/fg-01/readings?bucket=raw&from=${from}&to=${to}`,
    ).expect(200);
    expect(body.requested_bucket).toBe('raw');
    expect(body.bucket).toBe('5m');
    expect(body.downgraded).toBe(true);
    expect(body.points).toBe(120);
    expect(body.points).toBeLessThanOrEqual(body.max_points);
  });

  it('rejects a range that no bucket can fit under the cap', async () => {
    const stack = makeTestStack();
    await stack.post('fg-01', snapshotFixture()).expect(200);
    // 600 samples spread across a year: 1h buckets alone would be ~8 700 points.
    insertReadings(stack, { count: 600, stepSeconds: 52_560 });

    const from = new Date(BASE_EPOCH * 1000).toISOString();
    const to = new Date((BASE_EPOCH + 600 * 52_560) * 1000).toISOString();
    const tooWide = await stack.get(
      `/api/v1/devices/fg-01/readings?bucket=raw&from=${from}&to=${to}`,
    ).expect(400);
    expect(tooWide.body.error.code).toBe('range_too_wide');
  });

  it('rejects an unknown bucket or field', async () => {
    const stack = makeTestStack();
    await stack.post('fg-01', snapshotFixture()).expect(200);
    expect((await stack.get('/api/v1/devices/fg-01/readings?bucket=7d')).status).toBe(400);
    const field = await stack.get('/api/v1/devices/fg-01/readings?fields=temperature_c,co2_ppm').expect(400);
    expect(field.body.error.code).toBe('bad_request');
  });

  it('rejects an inverted range and an unparseable bound', async () => {
    const stack = makeTestStack();
    await stack.post('fg-01', snapshotFixture()).expect(200);

    const inverted = await stack.get('/api/v1/devices/fg-01/readings?from=2025-02-01T00:00:00Z&to=2025-01-01T00:00:00Z').expect(400);
    expect(inverted.body.error.code).toBe('bad_request');

    const garbage = await stack.get('/api/v1/devices/fg-01/readings?from=yesterday').expect(400);
    expect(garbage.body.error.code).toBe('bad_request');
  });

  it('accepts unix seconds as well as ISO timestamps', async () => {
    const stack = makeTestStack();
    await seedSeries(stack, 2);
    const { body } = await stack.get(`/api/v1/devices/fg-01/readings?from=${BASE_EPOCH}&to=${BASE_EPOCH + 120}&bucket=raw`).expect(200);
    expect(body.points).toBe(2);
    expect(body.from).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('inventory endpoints', () => {
  it('exports CSV with a header and one row per item, including retired', async () => {
    const stack = makeTestStack();
    await stack.post(
      'fg-01',
      snapshotFixture({ seq: 1, uptime: 10, inv_revision: 1, items: [itemFixture({ uid: 'A' }), itemFixture({ uid: 'B' })] }),
    ).expect(200);
    await stack.post('fg-01', snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [itemFixture({ uid: 'A' })] })).expect(200);

    const response = await stack.get('/api/v1/devices/fg-01/inventory/export.csv').expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('freshguard-fg-01-inventory.csv');

    const [header, ...rows] = response.text.trim().split('\n');
    expect(header).toContain('deadline_source');
    expect(header).toContain('progress_percent');
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.includes('expiry'))).toBe(false);
    expect(rows.some((row) => row.includes('duration'))).toBe(true);
  });

  it('neutralises a spreadsheet formula in a device-supplied name', async () => {
    const stack = makeTestStack();
    await stack.post('fg-01', snapshotFixture({ items: [itemFixture({ name: '=1+1' })] })).expect(200);
    const response = await stack.get('/api/v1/devices/fg-01/inventory/export.csv').expect(200);
    expect(response.text).toContain("'=1+1");
  });
});

describe('alerts and acknowledgement', () => {
  const seedAlert = async (stack) => {
    await stack.post(
      'fg-01',
      snapshotFixture({ state: { zone_status: 2, overall_status: 2, door_open: true, door_stale: false } }),
    ).expect(200);
  };

  it('lists derived active conditions with stable keys', async () => {
    const stack = makeTestStack();
    await seedAlert(stack);
    const { body } = await stack.get('/api/v1/devices/fg-01/alerts').expect(200);
    const keys = body.alerts.map((alert) => alert.condition_key);
    expect(keys).toContain('door_open');
    expect(keys).toContain('zone_check_food');
    for (const alert of body.alerts) expect(alert.acknowledged).toBe(false);
  });

  it('acknowledges and un-acknowledges a condition without touching the device', async () => {
    const stack = makeTestStack();
    await seedAlert(stack);

    const acked = await stack
      .send('post')('/api/v1/devices/fg-01/alerts/door_open/ack')
      .send({ acknowledged_by: 'operator-1', note: 'door propped open for cleaning' })
      .expect(200);
    expect(acked.body.acknowledged).toBe(true);

    const listed = await stack.get('/api/v1/devices/fg-01/alerts').expect(200);
    const door = listed.body.alerts.find((alert) => alert.condition_key === 'door_open');
    expect(door).toMatchObject({ acknowledged: true, acknowledged_by: 'operator-1' });

    // The device is untouched: its snapshot state is identical.
    const current = await stack.get('/api/v1/devices/fg-01/current').expect(200);
    expect(current.body.device.door.open).toBe(true);
    expect(current.body.counts.alerts_unacknowledged).toBe(1);

    await stack.send('delete')('/api/v1/devices/fg-01/alerts/door_open/ack').expect(200);
    const cleared = await stack.get('/api/v1/devices/fg-01/alerts').expect(200);
    expect(cleared.body.alerts.find((alert) => alert.condition_key === 'door_open').acknowledged).toBe(false);
  });

  it('re-acknowledging updates rather than duplicating', async () => {
    const stack = makeTestStack();
    await seedAlert(stack);
    await stack.send('post')('/api/v1/devices/fg-01/alerts/door_open/ack').send({ acknowledged_by: 'a' }).expect(200);
    await stack.send('post')('/api/v1/devices/fg-01/alerts/door_open/ack').send({ acknowledged_by: 'b' }).expect(200);

    const { body } = await stack.get('/api/v1/devices/fg-01/alerts').expect(200);
    expect(body.alerts.filter((alert) => alert.condition_key === 'door_open')).toHaveLength(1);
    expect(body.alerts.find((alert) => alert.condition_key === 'door_open').acknowledged_by).toBe('b');
  });

  it('rejects a malformed condition key and a missing ack', async () => {
    const stack = makeTestStack();
    await seedAlert(stack);
    const bad = await stack.send('post')('/api/v1/devices/fg-01/alerts/bad%20key/ack').send({}).expect(400);
    expect(bad.body.error.code).toBe('bad_request');
    expect((await stack.send('delete')('/api/v1/devices/fg-01/alerts/door_open/ack')).status).toBe(404);
  });

  it('404s an acknowledgement for a device that never reported', async () => {
    const { send } = makeTestStack();
    const response = await send('post')('/api/v1/devices/ghost/alerts/door_open/ack').send({}).expect(404);
    expect(response.body.error.code).toBe('unknown_device');
  });
});

describe('health and readiness', () => {
  it('reports health without touching the database', async () => {
    const { get, db } = makeTestStack();
    const response = await get('/healthz').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body).not.toHaveProperty('migrations');
    expect(db.prepare('SELECT 1').get()).toBeTruthy();
  });

  it('reports readiness with the applied migration count', async () => {
    const { get } = makeTestStack();
    const response = await get('/readyz').expect(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.migrations).toBeGreaterThan(0);
  });

  it('404s an unknown route with the standard envelope', async () => {
    const { get } = makeTestStack();
    const response = await get('/api/v1/nope').expect(404);
    expect(response.body.error.code).toBe('not_found');
    expect(response.body.error.request_id).toBeTruthy();
  });
});

describe('events', () => {
  it('exposes device-reported type, message and timestamp', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({
        events: [
          eventFixture({ event_id: 11, type: 'food_use_soon', message: 'Tomatoes is approaching its storage/expiry limit' }),
          eventFixture({ event_id: 12, type: 'door_open', message: 'Storage door remained open beyond the prototype timeout' }),
        ],
      }),
    ).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/events').expect(200);
    expect(body.count).toBe(2);
    expect(body.events[0].type).toBe('door_open');
    expect(body.events[0].timestamp).toBe('2025-01-01T00:00:00.000Z');
  });

  it('caps the page size', async () => {
    const { post, get } = makeTestStack();
    const events = Array.from({ length: 4 }, (_, index) => eventFixture({ event_id: index + 1 }));
    await post('fg-01', snapshotFixture({ events })).expect(200);
    const { body } = await get('/api/v1/devices/fg-01/events?limit=9999').expect(200);
    expect(body.limit).toBe(200);
  });

  // `event_id` is the device's per-boot counter, so after a reflash it restarts
  // and ids 1-3 exist in BOTH boots. A history ordered or paged by event_id
  // cannot express that: the cursor would land on a colliding id and page past
  // every other row sharing it, hiding stored rows from a client forever. The
  // row id is the order, and this walks a whole history the way a client does.
  it('pages across a reboot without skipping or repeating a row', async () => {
    const { post, get } = makeTestStack();
    const firstBoot = Array.from({ length: 4 }, (_, index) =>
      eventFixture({ event_id: index + 1, type: 'temperature_high', message: `boot one ${index + 1}` }),
    );
    await post('fg-01', snapshotFixture({ seq: 50, uptime: 500, events: firstBoot })).expect(200);

    const secondBoot = Array.from({ length: 3 }, (_, index) =>
      eventFixture({ event_id: index + 1, type: 'door_open', message: `boot two ${index + 1}` }),
    );
    const reboot = await post('fg-01', snapshotFixture({ seq: 1, uptime: 2, events: secondBoot })).expect(200);
    expect(reboot.body.reboot).toBe(true);

    const seen = [];
    let before;
    for (let page = 0; page < 10; page += 1) {
      const url = before === undefined ? '?limit=2' : `?limit=2&before=${before}`;
      const { body } = await get(`/api/v1/devices/fg-01/events${url}`).expect(200);
      seen.push(...body.events.map((event) => event.message));
      if (!body.has_more) break;
      before = body.next_before;
    }

    // Seven rows out, newest first, each exactly once: the reboot's events lead,
    // the first boot's follow in order, and the loop terminates.
    expect(seen).toEqual([
      'boot two 3',
      'boot two 2',
      'boot two 1',
      'boot one 4',
      'boot one 3',
      'boot one 2',
      'boot one 1',
    ]);
  });

  // The row id is the server's sequence and the client's newness mark. It has
  // three properties the client depends on: present on EVERY event (so the
  // filter has no null case to special-case), a property of the row rather than
  // of the response (so re-fetching, resuming or re-ordering pages cannot change
  // it), and additive to the existing shape (so a client built against the old
  // response keeps working).
  it('returns a row id on every event, unchanged across a repeat request and across pages', async () => {
    const { post, get } = makeTestStack();
    // Five rows over two snapshots: the contract caps a snapshot at four
    // events, and two batches also means the ids cross a batch boundary.
    const batch = (offset, count) =>
      Array.from({ length: count }, (_, index) =>
        eventFixture({ event_id: offset + index, type: 'door_open', message: `row ${offset + index}` }),
      );
    await post('fg-01', snapshotFixture({ seq: 5, uptime: 50, events: batch(1, 3) })).expect(200);
    await post('fg-01', snapshotFixture({ seq: 6, uptime: 60, events: batch(4, 2) })).expect(200);

    const first = await get('/api/v1/devices/fg-01/events?limit=2').expect(200);
    expect(first.body.events).toHaveLength(2);
    for (const event of first.body.events) {
      expect(Number.isInteger(event.id)).toBe(true);
      expect(event.id).toBeGreaterThan(0);
    }
    // Additive only: the same fields as before, plus `id`. No rename, no
    // removal, no shape change for a client that does not know about `id` yet.
    expect(Object.keys(first.body.events[0]).sort()).toEqual([
      'event_id',
      'id',
      'message',
      'received_at',
      'time_valid',
      'timestamp',
      'type',
      'uid',
    ]);

    // Stable within a page: the id belongs to the ROW, so asking again returns
    // the same values instead of a per-request sequence that would make a
    // high-water mark meaningless.
    const repeat = await get('/api/v1/devices/fg-01/events?limit=2').expect(200);
    expect(repeat.body.events.map((event) => event.id)).toEqual(first.body.events.map((event) => event.id));

    // Stable across pages: the same row fetched under a different cursor still
    // reports the same id, and the second page's ids are new rows, not a
    // continuation of a counter the response invented.
    const second = await get(`/api/v1/devices/fg-01/events?limit=2&before=${first.body.next_before}`).expect(200);
    expect(second.body.events).toHaveLength(2);
    for (const event of second.body.events) {
      expect(Number.isInteger(event.id)).toBe(true);
      expect(first.body.events.map((row) => row.id)).not.toContain(event.id);
    }
    const resume = await get(`/api/v1/devices/fg-01/events?limit=2&before=${first.body.next_before}`).expect(200);
    expect(resume.body.events.map((event) => event.id)).toEqual(second.body.events.map((event) => event.id));
  });

  // Ordering and paging are the SAME sequence, and that sequence is `id`. A
  // client that walks the history with `before`/`next_before` must see exactly
  // the rows the database holds, in the order the database holds them, because
  // `next_before` is advertised as "the row id of the last row on this page" and
  // is meant to be echoed straight back as `before`.
  it('orders by id exactly as the before/next_before cursor pages', async () => {
    const { post, get, db } = makeTestStack();
    // Two snapshots rather than one, so the history has more than a trivial
    // single-insert run of ids and the cursor has to cross a batch boundary.
    await post(
      'fg-01',
      snapshotFixture({
        seq: 5,
        uptime: 50,
        events: Array.from({ length: 3 }, (_, index) => eventFixture({ event_id: 10 + index, message: `batch a ${index}` })),
      }),
    ).expect(200);
    await post(
      'fg-01',
      snapshotFixture({
        seq: 6,
        uptime: 60,
        events: Array.from({ length: 4 }, (_, index) => eventFixture({ event_id: 20 + index, message: `batch b ${index}` })),
      }),
    ).expect(200);

    const stored = db.prepare('SELECT id FROM event ORDER BY id DESC').all().map((row) => row.id);
    expect(stored).toHaveLength(7);

    const seen = [];
    let before;
    let hasMore = true;
    let pages = 0;
    while (hasMore && pages < 20) {
      const url = before === undefined ? '?limit=3' : `?limit=3&before=${before}`;
      const { body } = await get(`/api/v1/devices/fg-01/events${url}`).expect(200);
      pages += 1;
      expect(body.count).toBe(body.events.length);

      const ids = body.events.map((event) => event.id);
      for (const id of ids) expect(Number.isInteger(id)).toBe(true);
      // Descending within the page, strictly - `ORDER BY id DESC`, and a tie
      // would mean two rows sharing a row id, which SQLite cannot do.
      expect([...ids].sort((a, b) => b - a)).toEqual(ids);
      // Everything on a later page is strictly below the cursor it was asked
      // for: `before` is exclusive, and it is the id of the last row of the
      // previous page.
      if (before !== undefined) for (const id of ids) expect(id).toBeLessThan(before);
      // The cursor handed back is this page's last id - the exact value the
      // next request must send, so response order and cursor order are one
      // sequence rather than two that merely look alike.
      expect(body.next_before).toBe(ids[ids.length - 1]);

      seen.push(...ids);
      hasMore = body.has_more;
      before = body.next_before;
    }

    // The whole history, nothing skipped, nothing repeated, newest first - the
    // same list the database returns for the same order.
    expect(seen).toEqual(stored);
    expect(new Set(seen).size).toBe(stored.length);
  });

  // TODAY'S INCIDENT, pinned. `event_id` is scoped to a boot (migration 005), so
  // ids 1-3 exist in BOTH boots after a reflash. A client keying newness on
  // `event_id` sees the second boot's events as OLDER than its own high-water
  // mark, the filter yields nothing, and the identify panel never fires again -
  // silently. The row id cannot fail that way: the server assigns it in arrival
  // order across every boot a device will ever have.
  it('returns rows from both boot generations under a repeated event_id, with strictly increasing ids', async () => {
    const { post, get, db } = makeTestStack();
    const boot = (tag) =>
      Array.from({ length: 3 }, (_, index) =>
        eventFixture({ event_id: index + 1, type: 'door_open', message: `${tag} ${index + 1}` }),
      );

    await post('fg-01', snapshotFixture({ seq: 50, uptime: 500, events: boot('boot one') })).expect(200);
    const reboot = await post('fg-01', snapshotFixture({ seq: 1, uptime: 2, events: boot('boot two') })).expect(200);
    expect(reboot.body.reboot).toBe(true);

    // The table really does hold both generations under the same event_ids, in
    // arrival order, each with its own row id.
    const stored = db.prepare('SELECT id, boot_generation, event_id FROM event ORDER BY id').all();
    expect(stored).toHaveLength(6);
    expect(stored.map((row) => row.boot_generation)).toEqual([1, 1, 1, 2, 2, 2]);
    for (const eventId of [1, 2, 3]) {
      expect(stored.filter((row) => row.event_id === eventId)).toHaveLength(2);
    }

    const { body } = await get('/api/v1/devices/fg-01/events?limit=200').expect(200);
    expect(body.count).toBe(6);

    // Both boots come back out of one response: six rows, each distinct message
    // once, and the colliding event_ids present twice rather than deduped away.
    expect(body.events.map((event) => event.message).sort()).toEqual([
      'boot one 1',
      'boot one 2',
      'boot one 3',
      'boot two 1',
      'boot two 2',
      'boot two 3',
    ]);
    for (const eventId of [1, 2, 3]) {
      expect(body.events.filter((event) => event.event_id === eventId)).toHaveLength(2);
    }

    // The `id`s the client sees ARE the row ids, and they form one strictly
    // increasing sequence - so for a duplicated event_id the second boot's row
    // is always greater, which is exactly the comparison `event_id` can no
    // longer express.
    const returned = [...body.events].map((event) => event.id).sort((a, b) => a - b);
    expect(returned).toEqual(stored.map((row) => row.id));
    returned.forEach((id, index) => {
      if (index > 0) expect(id).toBeGreaterThan(returned[index - 1]);
    });
    for (const eventId of [1, 2, 3]) {
      const pair = body.events.filter((event) => event.event_id === eventId);
      const first = pair.find((event) => event.message.startsWith('boot one'));
      const second = pair.find((event) => event.message.startsWith('boot two'));
      expect(second.id).toBeGreaterThan(first.id);
      // The trap itself: the device's own counter says the newer row is older.
      expect(second.event_id).toBe(first.event_id);
    }
  });
});
