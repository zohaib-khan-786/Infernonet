/**
 * Per-device idempotency and the reboot exception.
 *
 * The rule under test: a strictly increasing seq stores state, an equal or
 * lower seq is a replay that changes nothing, and a drop in uptime is a reboot
 * that is accepted even though the device restarts its sequence. Events are
 * deduplicated independently of all of that.
 */
import { describe, expect, it } from 'vitest';
import { makeTestStack } from './helpers.js';
import { createIngestService } from '../src/ingest/service.js';
import { eventFixture, scanEventFixture, snapshotFixture } from '../src/ingest/fixtures.js';

const deviceState = (db, dev) => db.prepare('SELECT * FROM device WHERE dev = ?').get(dev);
const readingCount = (db, dev) =>
  db
    .prepare(
      'SELECT COUNT(*) AS n FROM reading r JOIN device d ON d.id = r.device_id WHERE d.dev = ?',
    )
    .get(dev).n;

describe('snapshot idempotency', () => {
  it('stores the first snapshot and a strictly increasing one', async () => {
    const { post, db } = makeTestStack();

    const first = await post('fg-01', snapshotFixture({ seq: 10, uptime: 100 })).expect(200);
    expect(first.body).toMatchObject({ outcome: 'stored', reason: 'first_contact', seq: 10 });

    const second = await post('fg-01', snapshotFixture({ seq: 11, uptime: 105 })).expect(200);
    expect(second.body).toMatchObject({ outcome: 'stored', reason: 'seq_advanced' });

    expect(deviceState(db, 'fg-01').seq).toBe(11);
    expect(readingCount(db, 'fg-01')).toBe(2);
  });

  it('returns 200 outcome=stale for an exact replay and writes no state', async () => {
    const { post, db, clock } = makeTestStack();
    const snapshot = snapshotFixture({ seq: 5, uptime: 50, readings: { temperature_c: 4.2 } });

    await post('fg-01', snapshot).expect(200);
    clock.advanceSeconds(30);

    const replay = await post('fg-01', snapshot).expect(200);
    expect(replay.body).toMatchObject({ outcome: 'stale', reason: 'replay', seq: 5 });

    // No new reading, and last_ingest_at is untouched: the replay did not move
    // the transport clock either.
    expect(readingCount(db, 'fg-01')).toBe(1);
    expect(deviceState(db, 'fg-01').last_ingest_at).toBe('2025-01-01T00:00:00.000Z');
  });

  it('returns 200 outcome=stale for a lower seq with higher uptime', async () => {
    const { post, db } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 20, uptime: 200 })).expect(200);
    const out = await post('fg-01', snapshotFixture({ seq: 19, uptime: 210 })).expect(200);
    expect(out.body.outcome).toBe('stale');
    expect(deviceState(db, 'fg-01').seq).toBe(20);
  });

  it('accepts a reboot: uptime drops and the sequence restarts', async () => {
    const { post, db } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 500, uptime: 86_400, inv_revision: 3 })).expect(200);
    expect(deviceState(db, 'fg-01').boot_count).toBe(0);

    const reboot = await post('fg-01', snapshotFixture({ seq: 1, uptime: 12, inv_revision: 3 })).expect(200);
    expect(reboot.body).toMatchObject({ outcome: 'stored', reason: 'uptime_reset', reboot: true, boot_count: 1 });

    const row = deviceState(db, 'fg-01');
    expect(row.seq).toBe(1);
    expect(row.uptime_s).toBe(12);
    expect(row.boot_count).toBe(1);
  });

  it('counts each uptime drop as another boot', async () => {
    const { post, db } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 1000 })).expect(200);
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 30 })).expect(200);
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 20 })).expect(200);
    expect(deviceState(db, 'fg-01').boot_count).toBe(2);
  });

  it('keeps devices independent', async () => {
    const { post, db } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 100, uptime: 100 })).expect(200);
    const other = await post('fg-02', snapshotFixture({ seq: 3, uptime: 10 })).expect(200);
    expect(other.body).toMatchObject({ outcome: 'stored', reason: 'first_contact' });
    expect(deviceState(db, 'fg-01').seq).toBe(100);
    expect(deviceState(db, 'fg-02').seq).toBe(3);
  });

  it('preserves null readings and never substitutes a sentinel', async () => {
    const { post, get } = makeTestStack();
    const readings = {
      temperature_c: null,
      humidity_pct: null,
      pressure_hpa: null,
      gas_input_mv: null,
      gas_delta_mv: null,
    };
    await post('fg-01', snapshotFixture({ readings, state: { gas_state: 'warming_up' } })).expect(200);

    const current = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(current.body.readings).toMatchObject(readings);
    // The pre-warm-up -999 sentinel the firmware puts on ThingSpeak is
    // deliberately not part of this contract at all.
    for (const field of ['temperature_c', 'humidity_pct', 'pressure_hpa', 'gas_input_mv', 'gas_delta_mv']) {
      expect(current.body.readings[field]).toBeNull();
    }
  });

  it('keeps aggregated buckets null when every sample in the bucket is null', async () => {
    const { post, get, clock } = makeTestStack();
    const at = (iso) => {
      clock.set(iso);
      return iso;
    };
    at('2025-01-01T00:00:00.000Z');
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 1, readings: { temperature_c: null } })).expect(200);
    at('2025-01-01T00:00:30.000Z');
    await post('fg-01', snapshotFixture({ seq: 2, uptime: 31, readings: { temperature_c: null } })).expect(200);
    at('2025-01-01T00:01:00.000Z');

    // The window is half-open [from, to), so a reading at exactly `to` is
    // excluded; moving past it makes both samples land in the same minute.
    const series = await get('/api/v1/devices/fg-01/readings?bucket=1m').expect(200);
    expect(series.body.points).toBe(1);
    expect(series.body.series[0].temperature_c).toBeNull();
    expect(series.body.series[0].samples).toBe(2);
  });

  it('never acknowledges or mutates the device alert queue', async () => {
    const { post, db } = makeTestStack();
    const first = await post('fg-01', snapshotFixture({ seq: 1, uptime: 10, pending_count: 7 })).expect(200);
    expect(first.body.note).toContain('neither acknowledged nor modified');

    // A later snapshot reports a lower pending count because the device drained
    // its own queue. The stored value is whatever the device last said.
    const second = await post('fg-01', snapshotFixture({ seq: 2, uptime: 20, pending_count: 2 })).expect(200);
    expect(second.body.outcome).toBe('stored');
    expect(deviceState(db, 'fg-01').pending_count).toBe(2);
  });
});

describe('event deduplication', () => {
  it('stores events once per (device, boot, event_id)', async () => {
    const { post, get } = makeTestStack();
    const events = [eventFixture({ event_id: 42, type: 'door_open', message: 'Door open' })];

    const first = await post('fg-01', snapshotFixture({ seq: 1, uptime: 10, events })).expect(200);
    expect(first.body.events).toEqual({ received: 1, inserted: 1, duplicates: 0 });

    const replay = await post('fg-01', snapshotFixture({ seq: 1, uptime: 10, events })).expect(200);
    expect(replay.body.outcome).toBe('stale');
    expect(replay.body.events).toEqual({ received: 1, inserted: 0, duplicates: 1 });

    const stored = await get('/api/v1/devices/fg-01/events').expect(200);
    expect(stored.body.events).toHaveLength(1);
    expect(stored.body.events[0]).toMatchObject({ event_id: 42, type: 'door_open', message: 'Door open' });
  });

  // The silent data-loss bug, as a test. A firmware reflash recreates the
  // LittleFS queue, so the device's OWN event counter starts again at 1 while
  // the server still holds rows from before - same ids, different types. The
  // old key, UNIQUE (device_id, event_id), read all three of these as duplicates
  // and dropped them: the device got its 200, popped them from its queue, and
  // the alerts were gone while the drain still looked healthy.
  it('stores a counter reset after a reboot instead of dropping it as a duplicate', async () => {
    const { post, get, db } = makeTestStack();

    const beforeReflash = [
      eventFixture({ event_id: 1, type: 'temperature_high' }),
      eventFixture({ event_id: 2, type: 'temperature_high' }),
      eventFixture({ event_id: 3, type: 'door_open' }),
    ];
    await post('fg-01', snapshotFixture({ seq: 900, uptime: 86_400, events: beforeReflash })).expect(200);

    const afterReflash = [
      eventFixture({ event_id: 1, type: 'door_open', message: 'Storage door remained open beyond the prototype timeout' }),
      scanEventFixture({ event_id: 2, uid: '1778F106' }),
      scanEventFixture({ event_id: 3, uid: '06B11206' }),
    ];
    const reboot = await post('fg-01', snapshotFixture({ seq: 1, uptime: 4, events: afterReflash })).expect(200);
    expect(reboot.body).toMatchObject({ outcome: 'stored', reason: 'uptime_reset', reboot: true });
    expect(reboot.body.events).toEqual({ received: 3, inserted: 3, duplicates: 0 });

    const rows = db.prepare('SELECT boot_generation, event_id, type FROM event ORDER BY id').all();
    expect(rows).toHaveLength(6);
    // Three rows in the first boot's generation and three in the second: no row
    // merged with, or overwrote, one from the other boot, and the four-row shape
    // of the incident (events present, alerts missing) cannot recur.
    expect(rows.slice(0, 3).map((row) => `${row.boot_generation}:${row.event_id}:${row.type}`)).toEqual([
      '1:1:temperature_high',
      '1:2:temperature_high',
      '1:3:door_open',
    ]);
    expect(rows.slice(3).map((row) => `${row.boot_generation}:${row.event_id}:${row.type}`)).toEqual([
      '2:1:door_open',
      '2:2:rfid_scanned',
      '2:3:rfid_scanned',
    ]);

    const stored = await get('/api/v1/devices/fg-01/events?limit=50').expect(200);
    expect(stored.body.count).toBe(6);
  });

  it('a true replay of the post-reboot snapshot stores nothing extra and opens no generation', async () => {
    const { post, db } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 900, uptime: 86_400, events: [eventFixture({ event_id: 1 })] })).expect(200);

    const rebooted = snapshotFixture({
      seq: 1,
      uptime: 4,
      events: [eventFixture({ event_id: 1, type: 'door_open', message: 'Door open' })],
    });
    await post('fg-01', rebooted).expect(200);
    const generationBefore = deviceState(db, 'fg-01').boot_seq;
    const rowsBefore = db.prepare('SELECT COUNT(*) AS n FROM event').get().n;

    // The same bytes again: an equal seq over an equal uptime is a replay, not a
    // second boot. It must store no rows - and, just as importantly, must NOT
    // bump the generation, or every redelivery would re-key the device and the
    // same event would be stored once per at-least-once retry.
    const replay = await post('fg-01', rebooted).expect(200);
    expect(replay.body).toMatchObject({ outcome: 'stale', reason: 'replay', reboot: false });
    expect(replay.body.events).toEqual({ received: 1, inserted: 0, duplicates: 1 });
    expect(deviceState(db, 'fg-01').boot_seq).toBe(generationBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM event').get().n).toBe(rowsBefore);
  });

  it('keeps the boot generation across a backend restart', async () => {
    const { post, db, clock } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 900, uptime: 86_400 })).expect(200);
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 3 })).expect(200);
    expect(deviceState(db, 'fg-01').boot_seq).toBe(2);

    // A process restart, as the generation sees it: a brand-new service instance
    // holding nothing but the same database handle. The value has to come back
    // as 2 - a restart that opened a new generation mid-boot would split one
    // boot's events across two keys and put the duplicate-drop bug back to work
    // for every redelivery after a deploy.
    const restarted = createIngestService({ db, now: clock.now });
    const outcome = restarted.applySnapshot('fg-01', snapshotFixture({ seq: 2, uptime: 10 }));

    expect(outcome.outcome).toBe('stored');
    expect(deviceState(db, 'fg-01').boot_seq).toBe(2);
  });

  it('accepts new events carried by a stale snapshot', async () => {
    const { post, get } = makeTestStack();
    await post('fg-01', snapshotFixture({ seq: 9, uptime: 90, events: [eventFixture({ event_id: 1 })] })).expect(200);

    // Late delivery: a replayed sequence, with uptime that has not gone
    // backwards so it is not a reboot, carrying an event the server has not
    // seen. The event must be stored even though no state is written.
    const stale = await post(
      'fg-01',
      snapshotFixture({ seq: 3, uptime: 95, events: [eventFixture({ event_id: 2, type: 'food_check' })] }),
    ).expect(200);
    expect(stale.body).toMatchObject({ outcome: 'stale', events: { inserted: 1, duplicates: 0 } });

    const stored = await get('/api/v1/devices/fg-01/events').expect(200);
    expect(stored.body.events.map((event) => event.event_id).sort()).toEqual([1, 2]);
  });

  it('scopes dedupe to one device', async () => {
    const { post } = makeTestStack();
    const events = [eventFixture({ event_id: 5 })];
    const a = await post('fg-01', snapshotFixture({ seq: 1, uptime: 1, events })).expect(200);
    const b = await post('fg-02', snapshotFixture({ seq: 1, uptime: 1, events })).expect(200);
    expect(a.body.events.inserted).toBe(1);
    expect(b.body.events.inserted).toBe(1);
  });

  it('keeps time_valid false events with a null timestamp', async () => {
    const { post, get } = makeTestStack();
    const events = [eventFixture({ event_id: 8, timestamp_epoch: 0, time_valid: false })];
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 1, events })).expect(200);

    const stored = await get('/api/v1/devices/fg-01/events').expect(200);
    expect(stored.body.events[0].time_valid).toBe(false);
    expect(stored.body.events[0].timestamp).toBeNull();
  });

  // The cursor is the row the page ended on (a row id, since migration 005 gave
  // event_id a per-boot scope and it can no longer order a whole history); the
  // test drives it exactly the way a client does, straight back in as `before`.
  it('pages events with a before cursor', async () => {
    const { post, get } = makeTestStack();
    const events = Array.from({ length: 4 }, (_, index) => eventFixture({ event_id: 10 + index }));
    await post('fg-01', snapshotFixture({ seq: 1, uptime: 1, events })).expect(200);

    const page = await get('/api/v1/devices/fg-01/events?limit=2').expect(200);
    expect(page.body.events.map((event) => event.event_id)).toEqual([13, 12]);
    expect(page.body.has_more).toBe(true);

    const next = await get(`/api/v1/devices/fg-01/events?limit=2&before=${page.body.next_before}`).expect(200);
    expect(next.body.events.map((event) => event.event_id)).toEqual([11, 10]);
    expect(next.body.has_more).toBe(false);
  });
});
