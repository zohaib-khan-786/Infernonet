/**
 * Ingest service: the one place a device snapshot becomes stored state.
 *
 * Interface: `createIngestService({ db, now }) -> { applySnapshot(dev, snapshot) }`
 *
 * Three behaviours the interface hides, and which every caller depends on:
 *
 *  1. Idempotency by sequence. A strictly increasing `seq` over a
 *     non-decreasing `uptime` stores state. An equal or lower `seq` is a
 *     replay: 200 with `outcome: "stale"` and no state write. A *drop* in
 *     `uptime` is a reboot, and is accepted even though the device restarts its
 *     sequence.
 *  2. Events are independent of that decision. A replayed snapshot still
 *     contributes its events, deduplicated on `(device, boot, event_id)`,
 *     because event delivery is at-least-once and may legitimately arrive late.
 *     The boot dimension is not decoration: `event_id` is the device's own
 *     counter, persisted in the LittleFS queue header, and it restarts at 1
 *     whenever that file is recreated - a firmware reflash. Without the boot a
 *     post-reflash event 1 collides with a pre-reflash event 1 of a DIFFERENT
 *     type, `INSERT OR IGNORE` reads the new alert as a duplicate and drops it,
 *     and the device still gets its 2xx and pops it: the drain looks healthy
 *     while the record is gone. The generation is derived from the very reboot
 *     `classify()` already detects (uptime going backwards), read from the
 *     `device` row inside the SAME transaction that writes the events, so the
 *     key cannot drift from the decision that produced it and a backend restart
 *     cannot reset it - see migration 005 for why it is a column rather than a
 *     counter held here.
 *  3. Nothing here decides whether the food is fresh. Statuses, masks and
 *     per-item verdicts are stored as received. In particular the device's
 *     LittleFS alert queue is read-only here: `pending_count` is kept for
 *     observability and is never acknowledged, drained or otherwise mutated,
 *     because nothing on the device side can act on a server response.
 *
 *  4. An event is a record, not an instruction. `applyEvents` writes one row per
 *     event and touches nothing else - it never creates, revives, retires or
 *     updates an `inventory_item`, and never reaches for a fault mask. That is
 *     what makes an identification event an OBSERVATION: a device reporting that
 *     a tag was presented for a uid this backend has never heard of is a normal,
 *     expected outcome (a reader that has just been fitted meets a stranger's tag
 *     on its first sweep), and it is stored as a fact with no side effect. If a
 *     uid a scan carries is not registered, nothing is created, no item is
 *     invented from the event's message text, and no fault - `storage_fault` or
 *     otherwise - is raised. `tests/uid-identification.test.js` pins this.
 */
import { CONTRACT_VERSION } from './contract.js';

const isoOf = (epochSeconds) => new Date(epochSeconds * 1000).toISOString();

/**
 * The first boot generation the server ever assigns to a device.
 *
 * 1 and never 0, because migration 005 reserved 0 for the event rows it
 * backfilled: generation 0 means "recorded before boot-scoped dedupe existed",
 * and nothing the server writes after that migration may land there. A device
 * the server meets for the first time has no backfilled rows, so starting it at
 * 1 costs nothing and keeps the rule unconditional - every generation the server
 * assigns is >= 1, every generation-0 row is history.
 */
const FIRST_BOOT_SEQ = 1;

/** The device's clock is the only clock allowed to stamp device-reported times. */
function reportedIso(snapshot) {
  if (!snapshot.time_valid) return null;
  const epoch = snapshot.epoch ?? 0;
  return epoch > 0 ? isoOf(epoch) : null;
}

export function createIngestService({ db, now = () => new Date(), confirmCommands = null }) {
  const q = {
    deviceByDev: db.prepare('SELECT * FROM device WHERE dev = ?'),
    insertDevice: db.prepare(`
      INSERT INTO device (
        dev, contract_version, first_seen_at, last_ingest_at, reported_at, time_valid,
        seq, uptime_s, boot_count, boot_seq, inv_revision, pending_count, full, zone_status,
        overall_status, confirmed_fault_mask, availability_mask, door_open, door_stale,
        gas_state, firmware, door_timeout_ms, consecutive_samples, thresholds_json,
        thresholds_rev, provenance_json
      ) VALUES (
        @dev, @contract_version, @first_seen_at, @last_ingest_at, @reported_at, @time_valid,
        @seq, @uptime_s, @boot_count, @boot_seq, @inv_revision, @pending_count, @full, @zone_status,
        @overall_status, @confirmed_fault_mask, @availability_mask, @door_open, @door_stale,
        @gas_state, @firmware, @door_timeout_ms, @consecutive_samples, @thresholds_json,
        @thresholds_rev, @provenance_json
      )
    `),
    updateDevice: db.prepare(`
      UPDATE device SET
        contract_version = @contract_version, last_ingest_at = @last_ingest_at,
        reported_at = @reported_at, time_valid = @time_valid, seq = @seq,
        uptime_s = @uptime_s, boot_count = @boot_count, boot_seq = @boot_seq,
        inv_revision = @inv_revision,
        pending_count = @pending_count, full = @full, zone_status = @zone_status,
        overall_status = @overall_status, confirmed_fault_mask = @confirmed_fault_mask,
        availability_mask = @availability_mask, door_open = @door_open,
        door_stale = @door_stale, gas_state = @gas_state, firmware = @firmware,
        door_timeout_ms = @door_timeout_ms, consecutive_samples = @consecutive_samples,
        thresholds_json = @thresholds_json, thresholds_rev = @thresholds_rev,
        provenance_json = @provenance_json
      WHERE id = @id
    `),
    insertReading: db.prepare(`
      INSERT INTO reading (
        device_id, recorded_at, reported_at, time_valid, seq,
        temperature_c, humidity_pct, pressure_hpa, gas_input_mv, gas_delta_mv
      ) VALUES (
        @device_id, @recorded_at, @reported_at, @time_valid, @seq,
        @temperature_c, @humidity_pct, @pressure_hpa, @gas_input_mv, @gas_delta_mv
      )
    `),
    upsertItem: db.prepare(`
      INSERT INTO inventory_item (
        device_id, uid, name, category, quantity, location, store_date_epoch, expiry_epoch,
        duration_limit_days, status_code, manufacture_epoch, first_revision, last_revision,
        retired, retired_at_revision, created_at, updated_at
      ) VALUES (
        @device_id, @uid, @name, @category, @quantity, @location, @store_date_epoch, @expiry_epoch,
        @duration_limit_days, @status_code, @manufacture_epoch, @revision, @revision,
        0, NULL, @at, @at
      )
      ON CONFLICT (device_id, uid) DO UPDATE SET
        name = excluded.name, category = excluded.category, quantity = excluded.quantity,
        location = excluded.location, store_date_epoch = excluded.store_date_epoch,
        expiry_epoch = excluded.expiry_epoch, duration_limit_days = excluded.duration_limit_days,
        status_code = excluded.status_code, manufacture_epoch = excluded.manufacture_epoch,
        last_revision = excluded.last_revision,
        retired = 0, retired_at_revision = NULL, updated_at = excluded.updated_at
    `),
    retireAbsent: db.prepare(`
      UPDATE inventory_item
         SET retired = 1, retired_at_revision = @revision, updated_at = @at
       WHERE device_id = @device_id AND retired = 0
         AND uid NOT IN (SELECT value FROM json_each(@uids))
    `),
    retireAll: db.prepare(`
      UPDATE inventory_item
         SET retired = 1, retired_at_revision = @revision, updated_at = @at
       WHERE device_id = @device_id AND retired = 0
    `),
    countItems: db.prepare(
      'SELECT COUNT(*) AS n FROM inventory_item WHERE device_id = ? AND retired = 0',
    ),
    // The dedupe key is `(device_id, boot_generation, event_id)` - the triple
    // migration 005 created. `event_id` alone is never a key: it is the device's
    // per-boot counter, unique within one boot and restarting at 1 when the
    // LittleFS queue is recreated (a reflash), so scoping it to the boot
    // generation is what lets a reset counter in a later boot insert instead of
    // being ignored as a duplicate of an earlier boot's row. `IGNORE` keeps the
    // job it was always meant to have: the SAME snapshot redelivered by
    // at-least-once transport is still one row.
    insertEvent: db.prepare(`
      INSERT OR IGNORE INTO event (
        device_id, boot_generation, event_id, type, message, event_epoch, time_valid, uid, received_at
      ) VALUES (
        @device_id, @boot_generation, @event_id, @type, @message, @event_epoch, @time_valid, @uid, @received_at
      )
    `),
  };

  /**
   * Decide whether a snapshot may write state. Pure, and exported through the
   * service as `classify` so the rule can be tested on its own.
   */
  function classify(existing, snapshot) {
    if (!existing) return { accepted: true, reboot: false, reason: 'first_contact' };
    if (snapshot.uptime < existing.uptime_s) {
      // A reboot restarts both uptime and seq. Uptime is the only signal here
      // that distinguishes "newer state" from "old state replayed slowly".
      //
      // This is also the ONLY branch that ever returns `reboot: true`, and it
      // returns it on an accepted decision - so `reboot` carries a single
      // unambiguous meaning for every caller: this snapshot is the first one the
      // server has seen of a NEW boot. The boot generation for event dedupe is
      // built on exactly that meaning, and it holds because this uptime check
      // runs before the seq comparison below: a reboot whose seq restarted at 1
      // would otherwise fall through to `replay` and be rejected, taking the new
      // boot's first events with it.
      return { accepted: true, reboot: true, reason: 'uptime_reset' };
    }
    if (snapshot.seq > existing.seq) return { accepted: true, reboot: false, reason: 'seq_advanced' };
    return { accepted: false, reboot: false, reason: 'replay' };
  }

  const applyInventory = db.transaction((deviceId, snapshot, at) => {
    const items = snapshot.items ?? [];
    if (items.length > 0) {
      for (const item of items) {
        q.upsertItem.run({
          device_id: deviceId,
          uid: item.uid,
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          location: item.location,
          store_date_epoch: item.store_date_epoch,
          expiry_epoch: item.expiry_epoch,
          duration_limit_days: item.duration_limit_days,
          status_code: item.status,
          // 0 and absent both mean "the device did not know", and are stored as
          // NULL. Writing the 0 through would put 1970-01-01 in the column and
          // every reader would have to know that 0 was a sentinel - which is
          // exactly what migration 001's nullable-column rule forbids.
          manufacture_epoch: item.manufacture_epoch > 0 ? item.manufacture_epoch : null,
          revision: snapshot.inv_revision,
          at,
        });
      }
    }

    if (!snapshot.full) return { upserted: items.length, retired: 0 };

    // Full gate: `items` is the whole registry, so anything absent was removed
    // on the device. Soft-retire keeps the history and the store date intact;
    // a re-registered UID is revived by the upsert above.
    if (items.length === 0) {
      const result = q.retireAll.run({ device_id: deviceId, revision: snapshot.inv_revision, at });
      return { upserted: 0, retired: result.changes };
    }
    const result = q.retireAbsent.run({
      device_id: deviceId,
      revision: snapshot.inv_revision,
      at,
      uids: JSON.stringify(items.map((item) => item.uid)),
    });
    return { upserted: items.length, retired: result.changes };
  });

  /**
   * Write one row per event, in the boot generation the caller computed.
   *
   * `bootGeneration` is a parameter rather than something read inside here on
   * purpose: the value comes from the same `classify()` decision, in the same
   * transaction, that decided whether this snapshot is a reboot - so the events
   * of a snapshot are keyed against the boot that snapshot actually belongs to,
   * including when the snapshot itself was rejected as a replay (in which case
   * the caller passes the generation the device is already in, unchanged).
   */
  const applyEvents = db.transaction((deviceId, bootGeneration, events, at) => {
    let inserted = 0;
    let duplicates = 0;
    for (const event of events) {
      const eventEpoch = event.time_valid && event.timestamp_epoch > 0 ? event.timestamp_epoch : null;
      const result = q.insertEvent.run({
        device_id: deviceId,
        boot_generation: bootGeneration,
        event_id: event.event_id,
        type: event.type,
        message: event.message,
        event_epoch: eventEpoch,
        time_valid: event.time_valid ? 1 : 0,
        // Absent on every event type that is not about a tag, and absent on a
        // firmware build predating the field. Stored as NULL either way, never
        // as an empty string, so "no tag" and "a tag that read as nothing" stay
        // the same statement they are on the wire.
        uid: event.uid ?? null,
        received_at: at,
      });
      if (result.changes === 1) inserted += 1;
      else duplicates += 1;
    }
    return { received: events.length, inserted, duplicates };
  });

  const applySnapshotTx = db.transaction((dev, snapshot, at) => {
    const existing = q.deviceByDev.get(dev) ?? null;
    const decision = classify(existing, snapshot);
    const reportedAt = reportedIso(snapshot);
    const config = snapshot.config;

    // The boot generation these events belong to, computed ONCE, before the
    // accepted/rejected branch, so the device row and the event rows can never
    // disagree about which boot a snapshot came from - it is read and written in
    // the same transaction that runs classify() and applies the events, which is
    // the whole point: a reboot and its events either both land or neither does.
    //
    // `classify` can only report `reboot: true` on an ACCEPTED decision, because
    // the uptime check sits above the seq rule and a drop in uptime short-circuits
    // to "accepted" before `seq` is ever compared - a reboot restarts seq too, and
    // reading it as a replay would reject the first snapshot of every boot. So a
    // rejected snapshot takes the branch where `reboot` is false and recomputes
    // the generation it already has: a replay can neither open a generation nor
    // have its events filed against a later one.
    //
    // And because this reads `existing.boot_seq` from the device ROW rather than
    // from any counter held in this module, a backend restart mid-boot resumes
    // the generation the database is already in instead of starting a new one -
    // which is what makes "no generation without a reboot" a property of the
    // schema rather than of a process's lifetime.
    const bootSeq = existing ? existing.boot_seq + (decision.reboot ? 1 : 0) : FIRST_BOOT_SEQ;

    let deviceId;
    let bootCount;

    if (existing && !decision.accepted) {
      deviceId = existing.id;
      bootCount = existing.boot_count;
    } else {
      bootCount = existing ? existing.boot_count + (decision.reboot ? 1 : 0) : 0;
      const record = {
        contract_version: CONTRACT_VERSION,
        last_ingest_at: at,
        reported_at: reportedAt,
        time_valid: snapshot.time_valid ? 1 : 0,
        seq: snapshot.seq,
        uptime_s: snapshot.uptime,
        boot_count: bootCount,
        // Persisted with every accepted snapshot: the value the next snapshot's
        // events are keyed against, so it survives a restart by definition.
        boot_seq: bootSeq,
        inv_revision: snapshot.inv_revision,
        pending_count: snapshot.pending_count,
        full: snapshot.full ? 1 : 0,
        zone_status: snapshot.state.zone_status,
        overall_status: snapshot.state.overall_status,
        confirmed_fault_mask: snapshot.state.confirmed_fault_mask,
        availability_mask: snapshot.state.availability_mask,
        door_open: snapshot.state.door_open ? 1 : 0,
        door_stale: snapshot.state.door_stale ? 1 : 0,
        gas_state: snapshot.state.gas_state,
        firmware: config?.firmware ?? existing?.firmware ?? null,
        door_timeout_ms: config?.door_timeout_ms ?? existing?.door_timeout_ms ?? null,
        consecutive_samples: config?.consecutive_samples ?? existing?.consecutive_samples ?? null,
        thresholds_json: config ? JSON.stringify(config.thresholds) : (existing?.thresholds_json ?? null),
        thresholds_rev: config?.thresholds_rev ?? existing?.thresholds_rev ?? null,
        provenance_json: config ? JSON.stringify(config.provenance) : (existing?.provenance_json ?? null),
      };

      if (existing) {
        q.updateDevice.run({ ...record, id: existing.id });
        deviceId = existing.id;
      } else {
        const result = q.insertDevice.run({ ...record, dev, first_seen_at: at });
        deviceId = Number(result.lastInsertRowid);
      }

      q.insertReading.run({
        device_id: deviceId,
        recorded_at: at,
        reported_at: reportedAt,
        time_valid: snapshot.time_valid ? 1 : 0,
        seq: snapshot.seq,
        temperature_c: snapshot.readings.temperature_c,
        humidity_pct: snapshot.readings.humidity_pct,
        pressure_hpa: snapshot.readings.pressure_hpa,
        gas_input_mv: snapshot.readings.gas_input_mv,
        gas_delta_mv: snapshot.readings.gas_delta_mv,
      });

      applyInventory(deviceId, snapshot, at);

      // A uid in an ACCEPTED snapshot is the device's own word that it holds,
      // or has just created, the item - so every still-dispatched admin command
      // for that uid is confirmed HERE, in the same transaction that upserted
      // the row. Idempotent by construction (see command-store.js), scoped to
      // the accepted branch so a replayed snapshot can neither confirm nor
      // rewrite, and a no-op for a backend wired without a command store.
      // `confirmCommands` is a callback rather than a store dependency so the
      // ingest service stays the one place device state is written; it is
      // provided by app.js, which owns the command store.
      const itemUids = (snapshot.items ?? []).map((item) => item.uid);
      if (itemUids.length > 0) confirmCommands?.(dev, itemUids, at);
    }

    // Independent of the stale decision, on purpose: see the module docstring.
    // `bootSeq` rides along because it, unlike the state write above, is NOT
    // conditional on acceptance - a replayed snapshot's late events belong to the
    // generation the device is in now, which for a replay is the one it was
    // already in.
    const events = applyEvents(deviceId, bootSeq, snapshot.events ?? [], at);

    return {
      outcome: decision.accepted ? 'stored' : 'stale',
      reason: decision.reason,
      device_id: deviceId,
      reboot: decision.reboot,
      boot_count: bootCount,
      seq: decision.accepted ? snapshot.seq : existing.seq,
      uptime_s: decision.accepted ? snapshot.uptime : existing.uptime_s,
      inv_revision: decision.accepted ? snapshot.inv_revision : existing.inv_revision,
      inventory_active: q.countItems.get(deviceId).n,
      events,
      // The server's own clock, in unix seconds, derived from the SAME instant
      // that was stamped into recorded_at / last_ingest_at / received_at.
      //
      // Returned so the device can fall back to it when its own DS3231 is not
      // trusted. A device whose oscillator has stopped has no way to learn the
      // time from itself, and this acknowledgement is the only place the two
      // clocks meet. Deriving it from `at` rather than calling now() again
      // matters: the value the device adopts has to correspond to the moment its
      // reading was actually recorded, or the offset it computes is wrong by
      // however long the transaction took.
      server_time_epoch: Math.floor(Date.parse(at) / 1000),
    };
  });

  return {
    classify,
    applySnapshot(dev, snapshot) {
      return applySnapshotTx(dev, snapshot, now().toISOString());
    },
  };
}
