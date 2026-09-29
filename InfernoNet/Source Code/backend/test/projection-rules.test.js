/**
 * Projection behaviour against the Freshness Decision Rule Matrix.
 *
 * Scope, stated honestly: the device owns the verdicts, so most of what the
 * matrix defines is already decided on the ESP8266. What this backend can be
 * held to is (a) that it reproduces the device's verdict faithfully, (b) that
 * it never masks one class of fault with another, and (c) that it derives only
 * the presentational facts the firmware does not transmit. These tests cover
 * exactly that, rule by rule, and say so where a rule is not server-enforced.
 */
import { describe, expect, it } from 'vitest';
import { makeTestStack } from './helpers.js';
import { BASE_EPOCH, DAY, itemFixture, snapshotFixture } from '../src/ingest/fixtures.js';

const keysOf = (body) => body.alerts.map((alert) => alert.condition_key);
const alertFor = (body, key) => body.alerts.find((alert) => alert.condition_key === key);

describe('rule matrix projection', () => {
  it('R-01: an in-range zone with a young item stays fresh', async () => {
    const { post, get, clock } = makeTestStack();
    clock.set(new Date((BASE_EPOCH + 1 * DAY) * 1000).toISOString());
    await post('fg-01', snapshotFixture({ items: [itemFixture({ duration_limit_days: 10, status: 0 })] })).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(body.device.zone_status).toEqual({ code: 0, label: 'fresh' });
    expect(body.device.overall_status).toEqual({ code: 0, label: 'fresh' });
    expect(body.inventory[0].derived.progress_percent).toBe(10);
    expect(keysOf(body)).not.toContain('overall_use_soon');
  });

  it('R-02: Use Soon is reachable only through inventory', async () => {
    const { post, get } = makeTestStack();

    // An empty registry: overall must equal the zone, and Use Soon is impossible.
    await post('fg-01', snapshotFixture({ items: [] })).expect(200);
    const empty = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(empty.body.device.overall_status).toEqual({ code: 0, label: 'fresh' });
    expect(keysOf(empty.body)).not.toContain('overall_use_soon');

    // With an item at 80% of its window the device says Use Soon.
    await post(
      'fg-02',
      snapshotFixture({
        state: { zone_status: 0, overall_status: 1 },
        items: [itemFixture({ uid: 'U1', duration_limit_days: 10, status: 1 })],
      }),
    ).expect(200);
    const withItem = await get('/api/v1/devices/fg-02/current').expect(200);
    expect(withItem.body.device.overall_status.label).toBe('use_soon');
    expect(keysOf(withItem.body)).toContain('overall_use_soon');
    expect(keysOf(withItem.body)).toContain('item_use_soon:U1');
  });

  it('R-03: an item past its limit raises the item and overall conditions, not the zone', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({
        state: { zone_status: 0, overall_status: 2 },
        items: [itemFixture({ uid: 'U1', name: 'Milk', duration_limit_days: 1, status: 2 })],
      }),
    ).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(body.device.zone_status.code).toBe(0);
    expect(body.device.overall_status.code).toBe(2);
    expect(keysOf(body)).toContain('overall_check_food');
    expect(keysOf(body)).toContain('item_check:U1');
    expect(keysOf(body)).not.toContain('zone_check_food');
  });

  it('R-04..R-08: an environmental latch shows as a zone Check Food without naming a threshold', async () => {
    const { post, get } = makeTestStack();
    await post('fg-01', snapshotFixture({ state: { zone_status: 2, overall_status: 2 } })).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    const zone = alertFor(body, 'zone_check_food');
    expect(zone.severity).toBe('error');
    // The contract carries the verdict, not the latching detail; inventing one
    // would be a guess dressed as data.
    expect(zone.detail).toContain('not transmitted');
  });

  it('R-09: an availability bit outranks the environmental verdict and names the inputs', async () => {
    const { post, get } = makeTestStack();
    // Zone would be Check Food, but a required input is unavailable: the
    // device reported Sensor Fault, and that is what is surfaced.
    await post(
      'fg-01',
      snapshotFixture({
        state: { zone_status: 3, overall_status: 3, availability_mask: 1 << 2 }, // ADS1115
      }),
    ).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(body.device.zone_status.label).toBe('sensor_fault');
    expect(keysOf(body)).toContain('unavailable:2:ads1115');
    expect(keysOf(body)).not.toContain('zone_check_food');
  });

  it('R-10: a storage fault never changes the freshness verdict', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({
        state: {
          zone_status: 2,
          overall_status: 2,
          confirmed_fault_mask: (1 << 8) | (1 << 11), // LittleFS, configuration
        },
      }),
    ).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    // The food verdict survives untouched.
    expect(body.device.zone_status.code).toBe(2);
    expect(keysOf(body)).toContain('zone_check_food');
    for (const key of ['storage_fault:8:littlefs', 'storage_fault:11:configuration']) {
      expect(alertFor(body, key).detail).toContain('freshness status unaffected');
    }
    // And no alert claims the food is fine because of it.
    const errors = body.alerts.filter((alert) => alert.severity === 'error');
    expect(errors.some((alert) => alert.condition_key === 'zone_check_food')).toBe(true);
  });

  it('R-11: gas warm-up is display-only and raises no sensor_fault condition', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({
        state: { zone_status: 3, overall_status: 3, gas_state: 'capturing_baseline', availability_mask: 1 << 3, confirmed_fault_mask: 0 },
      }),
    ).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(keysOf(body)).toContain('gas_warmup');
    expect(keysOf(body)).toContain('unavailable:3:mq135');
    expect(keysOf(body)).not.toContain('sensor_fault:3:mq135');
    expect(body.device.gas).toEqual({ state: 'capturing_baseline', warming_or_baselining: true });
  });

  it('R-12: an open door is a condition, never a status change', async () => {
    const { post, get } = makeTestStack();
    await post('fg-01', snapshotFixture({ state: { zone_status: 0, overall_status: 0, door_open: true } })).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(body.device.door).toEqual({ open: true, stale: false });
    expect(body.device.zone_status.code).toBe(0);
    const door = alertFor(body, 'door_open');
    expect(door.severity).toBe('warning');
    expect(door.detail).toContain('unchanged (R-12)');
  });

  it('R-12: a stale door input is reported as unavailable, not as an open door', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({ state: { door_open: true, door_stale: true, availability_mask: 1 << 7 } }),
    ).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(keysOf(body)).toContain('door_stale');
    expect(keysOf(body)).toContain('unavailable:7:reed');
    expect(keysOf(body)).not.toContain('door_open');
  });

  it('R-13: an untrusted clock is a Sensor Fault condition and withholds derived durations', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({
        time_valid: false,
        epoch: 0,
        state: { zone_status: 3, overall_status: 3, availability_mask: 1 << 4 },
      }),
    ).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(body.device.time_valid).toBe(false);
    expect(body.device.reported_at).toBeNull();
    expect(body.readings.reported_at).toBeNull();
    expect(keysOf(body)).toContain('time_untrusted');
    expect(keysOf(body)).toContain('unavailable:4:ds3231');
    for (const item of body.inventory) {
      expect(item.derived.elapsed_seconds).toBeNull();
      expect(item.derived.remaining_seconds).toBeNull();
    }
  });

  it('R-13: a zero-length window is reported as Sensor Fault for that item only', async () => {
    const { post, get } = makeTestStack();
    await post(
      'fg-01',
      snapshotFixture({
        state: { zone_status: 0, overall_status: 3 },
        items: [itemFixture({ uid: 'BAD', status: 3, expiry_epoch: 0, duration_limit_days: 0 })],
      }),
    ).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(body.device.zone_status.code).toBe(0);
    expect(body.device.overall_status.code).toBe(3);
    expect(keysOf(body)).toContain('item_unavailable:BAD');
    expect(keysOf(body)).toContain('overall_sensor_fault');
  });

  it('never presents a misaligned fault mask and Sensor Fault verdict as agreement', async () => {
    const { post, get } = makeTestStack();
    // Contradictory on purpose: the device says Sensor Fault with no
    // availability bit set. The projection reports the contradiction instead of
    // silently picking a side.
    await post('fg-01', snapshotFixture({ state: { zone_status: 3, overall_status: 3, availability_mask: 0 } })).expect(200);

    const { body } = await get('/api/v1/devices/fg-01/current').expect(200);
    const summary = alertFor(body, 'zone_sensor_fault');
    expect(summary.detail).toContain('disagree');
  });
});
