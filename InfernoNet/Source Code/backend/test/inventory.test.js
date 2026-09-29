/**
 * Inventory replacement, expiry precedence, and the availability mask driving
 * Sensor Fault.
 *
 * Three separate promises are checked here, and they are easy to conflate:
 *   - a `full` snapshot is the whole registry, so absence means removal, and
 *     removal is a soft retire rather than a delete;
 *   - a non-zero expiry outranks the duration limit for the derived window;
 *   - the device's per-item status is stored and returned verbatim, and the
 *     availability mask - not the zone status field - is what names the inputs
 *     behind a Sensor Fault verdict.
 */
import { describe, expect, it } from 'vitest';
import { makeTestStack } from './helpers.js';
import { BASE_EPOCH, DAY, itemFixture, snapshotFixture } from '../src/ingest/fixtures.js';

describe('inventory replacement', () => {
  it('replaces the registry on a full snapshot and soft-retires what is absent', async () => {
    const { post, get, db } = makeTestStack();
    const first = [
      itemFixture({ uid: 'AAA1', name: 'Tomatoes' }),
      itemFixture({ uid: 'BBB2', name: 'Cheese' }),
    ];
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 10, inv_revision: 1, items: first })).expect(200);

    const second = [itemFixture({ uid: 'BBB2', name: 'Cheese' }), itemFixture({ uid: 'CCC3', name: 'Milk' })];
    await post('fg-01', snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: second })).expect(200);

    const inventory = await get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.items.map((item) => item.uid).sort()).toEqual(['BBB2', 'CCC3']);

    const retired = await get('/api/v1/devices/fg-01/inventory?retired=true').expect(200);
    const tomatoes = retired.body.items.find((item) => item.uid === 'AAA1');
    expect(tomatoes.revisions).toMatchObject({ retired: true, retired_at_revision: 2 });

    // Soft, not deleted: the row survives with its history.
    const row = db.prepare('SELECT * FROM inventory_item WHERE uid = ?').get('AAA1');
    expect(row.retired).toBe(1);
    expect(row.first_revision).toBe(1);
  });

  it('updates an existing item in place, preserving its first revision', async () => {
    const { post, get, db } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 10, inv_revision: 1, items: [itemFixture({ name: 'Tomatoes' })] })).expect(200);
    await post(
      'fg-01',
      snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [itemFixture({ name: 'Tomatoes (ripe)' })] }),
    ).expect(200);

    const row = db.prepare('SELECT * FROM inventory_item WHERE uid = ?').get('A1B2C3D4');
    expect(row.name).toBe('Tomatoes (ripe)');
    expect(row.first_revision).toBe(1);
    expect(row.last_revision).toBe(2);

    const inventory = await get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.items).toHaveLength(1);
  });

  it('retires everything for a full snapshot with an empty registry', async () => {
    const { post, get } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [itemFixture(), itemFixture({ uid: 'X2' })] })).expect(200);
    await post('fg-01', snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [] })).expect(200);

    const active = await get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(active.body.items).toHaveLength(0);
    const all = await get('/api/v1/devices/fg-01/inventory?retired=true').expect(200);
    expect(all.body.items).toHaveLength(2);
  });

  it('does not retire anything when full is false', async () => {
    const { post, get } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [itemFixture({ uid: 'KEEP' })] })).expect(200);

    const incremental = snapshotFixture({ seq: 2, uptime: 20, full: false, items: [itemFixture({ uid: 'NEW' })] });
    await post('fg-01', incremental).expect(200);

    const inventory = await get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.items.map((item) => item.uid).sort()).toEqual(['KEEP', 'NEW']);
  });

  it('applies no inventory change for a stale snapshot', async () => {
    const { post, get } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 5, uptime: 50, inv_revision: 2, items: [itemFixture({ uid: 'LIVE' })] })).expect(200);

    const replay = snapshotFixture({
      seq: 4,
      uptime: 55,
      inv_revision: 3,
      items: [itemFixture({ uid: 'GHOST' })],
    });
    const response = await post('fg-01', replay).expect(200);
    expect(response.body.outcome).toBe('stale');

    const inventory = await get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.items.map((item) => item.uid)).toEqual(['LIVE']);
  });

  it('revives a soft-retired item that reappears in a newer full snapshot', async () => {
    const { post, get } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 10, items: [itemFixture({ uid: 'R1' })] })).expect(200);
    await post('fg-01', snapshotFixture({ seq: 2, uptime: 20, inv_revision: 2, items: [] })).expect(200);
    await post('fg-01', snapshotFixture({ seq: 3, uptime: 30, inv_revision: 3, items: [itemFixture({ uid: 'R1' })] })).expect(200);

    const inventory = await get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.items).toHaveLength(1);
    expect(inventory.body.items[0].revisions.retired).toBe(false);
  });
});

describe('derived item timings', () => {
  it('uses the expiry epoch when both expiry and duration are present', async () => {
    const { post, get, clock } = makeTestStack();
    clock.set(new Date((BASE_EPOCH + 4 * DAY) * 1000).toISOString());

    await post(
      'fg-01',
      snapshotFixture({
        items: [
          itemFixture({
            store_date_epoch: BASE_EPOCH,
            expiry_epoch: BASE_EPOCH + 10 * DAY,
            duration_limit_days: 30,
          }),
        ],
      }),
    ).expect(200);

    const item = (await get('/api/v1/devices/fg-01/inventory').expect(200)).body.items[0];
    expect(item.derived.deadline_source).toBe('expiry');
    expect(item.derived.window_seconds).toBe(10 * DAY);
    expect(item.derived.elapsed_seconds).toBe(4 * DAY);
    expect(item.derived.remaining_seconds).toBe(6 * DAY);
    expect(item.derived.progress_percent).toBe(40);
  });

  it('uses the duration limit when the expiry epoch is zero', async () => {
    const { post, get, clock } = makeTestStack();
    clock.set(new Date((BASE_EPOCH + 5 * DAY) * 1000).toISOString());
    await post('fg-01', snapshotFixture({ items: [itemFixture({ expiry_epoch: 0, duration_limit_days: 10 })] })).expect(200);

    const item = (await get('/api/v1/devices/fg-01/inventory').expect(200)).body.items[0];
    expect(item.derived.deadline_source).toBe('duration');
    expect(item.derived.deadline_epoch).toBe(BASE_EPOCH + 10 * DAY);
    expect(item.derived.progress_percent).toBe(50);
  });

  it('marks a zero-length window and still reports the device verdict', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({ items: [itemFixture({ expiry_epoch: 0, duration_limit_days: 0, status: 3 })] }),
    ).expect(200);

    const item = (await get('/api/v1/devices/fg-01/inventory').expect(200)).body.items[0];
    expect(item.derived.deadline).toBeNull();
    expect(item.derived.window_seconds).toBe(0);
    expect(item.derived.note).toContain('zero-length');
    expect(item.status).toEqual({ code: 3, label: 'sensor_fault' });
  });

  it('withholds elapsed and remaining when the device clock is untrusted', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({ time_valid: false, epoch: 0, state: { zone_status: 3, overall_status: 3, availability_mask: 1 << 4 } }),
    ).expect(200);

    const inventory = await get('/api/v1/devices/fg-01/inventory').expect(200);
    expect(inventory.body.clock_trusted).toBe(false);
    const item = inventory.body.items[0];
    expect(item.derived.deadline).not.toBeNull(); // arithmetic on the item's own epochs
    expect(item.derived.elapsed_seconds).toBeNull();
    expect(item.derived.remaining_seconds).toBeNull();
    expect(item.derived.progress_percent).toBeNull();
    expect(item.derived.note).toContain('R-13');
  });

  it('flags a device clock earlier than the store date without changing the verdict', async () => {
    const { post, get, clock } = makeTestStack();
    clock.set(new Date((BASE_EPOCH - 2 * DAY) * 1000).toISOString());
    await post('fg-01', snapshotFixture()).expect(200);

    const item = (await get('/api/v1/devices/fg-01/inventory').expect(200)).body.items[0];
    expect(item.derived.elapsed_seconds).toBe(-2 * DAY);
    expect(item.derived.progress_percent).toBe(0);
    expect(item.derived.note).toContain('earlier than the store date');
    expect(item.status.code).toBe(0); // still whatever the device said
  });

  it('keeps the device per-item status authoritative', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({
        state: { zone_status: 0, overall_status: 2 },
        items: [itemFixture({ uid: 'A', name: 'Milk', status: 2 })],
      }),
    ).expect(200);

    const item = (await get('/api/v1/devices/fg-01/inventory').expect(200)).body.items[0];
    // Status 2 with a comfortable time budget left: the server does not
    // second-guess the device's verdict.
    expect(item.status).toEqual({ code: 2, label: 'check_food' });
    expect(item.derived.remaining_seconds).toBeGreaterThan(0);
  });
});

describe('availability mask drives Sensor Fault', () => {
  it('names the unavailable inputs from the availability mask', async () => {
    const { post, get } = makeTestStack();
    // Bit 0 = BME280, bit 4 = DS3231/time. Zone and overall both report 3.
    await post(
      'fg-01',
      snapshotFixture({
        state: {
          zone_status: 3,
          overall_status: 3,
          availability_mask: (1 << 0) | (1 << 4),
          confirmed_fault_mask: 1 << 0,
        },
      }),
    ).expect(200);

    const current = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(current.body.device.zone_status).toEqual({ code: 3, label: 'sensor_fault' });
    expect(current.body.device.unavailable.map((entry) => entry.name)).toEqual(['bme280', 'ds3231']);
    expect(current.body.device.confirmed_faults.map((entry) => entry.name)).toEqual(['bme280']);

    const keys = current.body.alerts.map((alert) => alert.condition_key);
    expect(keys).toContain('unavailable:0:bme280');
    expect(keys).toContain('unavailable:4:ds3231');
    expect(keys).toContain('sensor_fault:0:bme280');
    // The mask already explains the Sensor Fault verdict, so no bare summary
    // row is added on top of it.
    expect(keys).not.toContain('zone_sensor_fault');
  });

  it('distinguishes a storage fault from a sensor fault (R-10)', async () => {
    const { post, get } = makeTestStack();
    // Bit 9 = inventory, bit 10 = alert queue. Both are admin faults.
    await post(
      'fg-01',
      snapshotFixture({ state: { zone_status: 0, overall_status: 0, confirmed_fault_mask: (1 << 9) | (1 << 10) } }),
    ).expect(200);

    const current = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(current.body.device.zone_status.code).toBe(0);
    const storage = current.body.alerts.filter((alert) => alert.kind === 'storage_fault');
    expect(storage.map((alert) => alert.condition_key)).toEqual(['storage_fault:10:alert_queue', 'storage_fault:9:inventory']);
    for (const alert of storage) expect(alert.detail).toContain('freshness status unaffected');
  });

  it('surfaces gas warm-up as display-only, with no sensor_fault (R-11)', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({ state: { gas_state: 'warming_up', availability_mask: 1 << 3, confirmed_fault_mask: 0 } }),
    ).expect(200);

    const current = await get('/api/v1/devices/fg-01/current').expect(200);
    const keys = current.body.alerts.map((alert) => alert.condition_key);
    expect(keys).toContain('gas_warmup');
    expect(keys).toContain('unavailable:3:mq135');
    expect(keys).not.toContain('sensor_fault:3:mq135');
    const warmup = current.body.alerts.find((alert) => alert.condition_key === 'gas_warmup');
    expect(warmup.detail).toContain('R-11');
  });

  it('names optional hardware faults without touching the freshness verdict', async () => {
    const { post, get } = makeTestStack();
    await post('fg-01', snapshotFixture({ state: { confirmed_fault_mask: 1 << 12 } })).expect(200);
    const current = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(current.body.device.zone_status.code).toBe(0);
    expect(current.body.alerts.map((alert) => alert.condition_key)).toContain('optional_fault:12:rc522');
  });
});
