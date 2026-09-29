/**
 * Projections: the dashboard-shaped view of what the device reported.
 *
 * This module is pure, and that is the point. It never re-evaluates a
 * threshold, never re-debounces a latch, and never replaces the device's
 * verdict with one of its own. What it does is:
 *
 *   - turn the device's 16-bit masks into named, individually acknowledgeable
 *     conditions (R-09 sensor faults, R-10 storage faults, R-11 warm-up, R-13
 *     untrustworthy clock, R-12 door);
 *   - derive the *presentational* numbers the firmware does not transmit -
 *     deadline, elapsed, remaining, progress - from the item's own epochs.
 *
 * Two rules are load-bearing and easy to get wrong:
 *
 *   R-10: a storage/admin fault is a separate condition. It never contributes
 *         to any status, and its detail says so explicitly.
 *   R-13: when the device clock is untrusted, no elapsed/remaining/progress is
 *         produced at all. A duration verdict computed against a bad clock is
 *         worse than no verdict, so the fields are null with a reason.
 */
import {
  describeMask,
  statusLabel,
  statusWithLabel,
  STATUS_CHECK_FOOD,
  STATUS_SENSOR_FAULT,
  STATUS_USE_SOON,
  WARMING_GAS_STATES,
} from '../domain.js';

const DAY_SECONDS = 86_400;
const FRESHNESS_UNAFFECTED = 'freshness status unaffected (R-10)';

const parseJson = (value) => {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const toIso = (epochSeconds) =>
  Number.isInteger(epochSeconds) && epochSeconds > 0 ? new Date(epochSeconds * 1000).toISOString() : null;

const toEpoch = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);

/**
 * Presentational view of one inventory item.
 *
 * The item's `status` is passed through untouched: the device owns that
 * verdict, including its treatment of a backwards clock. Everything below it
 * is arithmetic on the item's own epochs.
 */
export function deriveItem(item, { nowEpoch, clockTrusted }) {
  const storeDate = item.store_date_epoch ?? 0;
  const expiry = item.expiry_epoch ?? 0;
  const durationDays = item.duration_limit_days ?? 0;

  // Expiry wins over duration when both exist, exactly as the firmware does.
  const deadlineSource = expiry > 0 ? 'expiry' : durationDays > 0 ? 'duration' : 'none';
  const windowSeconds =
    deadlineSource === 'expiry'
      ? expiry - storeDate
      : deadlineSource === 'duration'
        ? durationDays * DAY_SECONDS
        : 0;
  const deadlineEpoch = deadlineSource === 'expiry' ? expiry : deadlineSource === 'duration' ? storeDate + windowSeconds : null;

  let derived = {
    deadline: toIso(deadlineEpoch),
    deadline_epoch: deadlineEpoch,
    deadline_source: deadlineSource,
    window_seconds: Math.max(0, windowSeconds),
    elapsed_seconds: null,
    remaining_seconds: null,
    progress_percent: null,
    clock_trusted: clockTrusted,
    note: null,
  };

  if (deadlineSource === 'none' || windowSeconds <= 0) {
    derived.note = 'zero-length storage window; the device reports this item as Sensor Fault';
    return derived;
  }
  if (!clockTrusted) {
    derived.note = 'device clock is not trusted (R-13); elapsed and remaining are withheld';
    return derived;
  }

  const elapsed = nowEpoch - storeDate;
  const remaining = deadlineEpoch - nowEpoch;
  derived = {
    ...derived,
    elapsed_seconds: elapsed,
    remaining_seconds: remaining,
    progress_percent: Math.round(Math.min(1, Math.max(0, elapsed / windowSeconds)) * 1000) / 10,
    note: elapsed < 0 ? 'device clock is earlier than the store date; the device reports Check Food' : null,
  };
  return derived;
}

export function deriveInventory(inventory, { nowEpoch, clockTrusted }) {
  return inventory.map((item) => ({
    uid: item.uid,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    location: item.location,
    store_date_epoch: item.store_date_epoch,
    store_date: toIso(item.store_date_epoch),
    // Reported by the device and stored as reported. `manufacture` is null when
    // the device did not know (the column is NULL, and the wire sent 0), never
    // 1970 - an unlabelled item is not an item made in 1970.
    manufacture_epoch: item.manufacture_epoch ?? null,
    manufacture: toIso(item.manufacture_epoch),
    expiry_epoch: item.expiry_epoch,
    expiry: toIso(item.expiry_epoch),
    duration_limit_days: item.duration_limit_days,
    status: statusWithLabel(item.status_code),
    derived: deriveItem(item, { nowEpoch, clockTrusted }),
    revisions: {
      first: item.first_revision,
      last: item.last_revision,
      retired: Boolean(item.retired),
      retired_at_revision: item.retired_at_revision,
    },
  }));
}

/**
 * Active conditions, derived from the device's own state block and its own
 * per-item verdicts. Each entry has a stable `condition_key` so a dashboard
 * acknowledgement attaches to the condition rather than to a row id that will
 * not survive the next projection.
 */
export function deriveActiveConditions(device, inventory) {
  const conditions = [];
  const add = (condition) => conditions.push(condition);

  for (const bit of describeMask(device.availability_mask)) {
    add({
      condition_key: `unavailable:${bit.bit}:${bit.name}`,
      kind: 'sensor_unavailable',
      severity: 'error',
      title: `Sensor unavailable: ${bit.name}`,
      detail:
        bit.name === 'mq135'
          ? 'gas is warming up or capturing a baseline; this is display-only and raises no remote sensor_fault (R-11)'
          : 'a required input is not producing data; the device reports Sensor Fault / Data Unavailable (R-09)',
      bit: bit.bit,
    });
  }

  for (const bit of describeMask(device.confirmed_fault_mask)) {
    if (bit.class === 'storage') {
      add({
        condition_key: `storage_fault:${bit.bit}:${bit.name}`,
        kind: 'storage_fault',
        severity: 'error',
        title: `Storage/admin fault: ${bit.name}`,
        detail: `LittleFS, inventory, queue-full and configuration faults are an administration problem; ${FRESHNESS_UNAFFECTED}`,
        bit: bit.bit,
      });
    } else if (bit.class === 'optional') {
      add({
        condition_key: `optional_fault:${bit.bit}:${bit.name}`,
        kind: 'optional_fault',
        severity: 'warning',
        title: `Optional function fault: ${bit.name}`,
        detail: 'an optional peripheral is unavailable; food monitoring is unaffected',
        bit: bit.bit,
      });
    } else {
      add({
        condition_key: `sensor_fault:${bit.bit}:${bit.name}`,
        kind: 'sensor_fault',
        severity: 'error',
        title: `Sensor fault: ${bit.name}`,
        detail: 'a required input failed to read and the device debounced it as a confirmed fault (R-09)',
        bit: bit.bit,
      });
    }
  }

  if (!device.time_valid) {
    add({
      condition_key: 'time_untrusted',
      kind: 'sensor_unavailable',
      severity: 'error',
      title: 'Device clock is not trusted',
      detail:
        'storage duration and expiry cannot be evaluated without a trustworthy clock; the device reports Sensor Fault (R-13) and timestamps are withheld',
    });
  }

  if (device.gas_state && WARMING_GAS_STATES.has(device.gas_state)) {
    add({
      condition_key: 'gas_warmup',
      kind: 'sensor_unavailable',
      severity: 'info',
      title: `Gas path is ${device.gas_state.replace(/_/g, ' ')}`,
      detail: 'expected for roughly the first 90 s after every power-up; no remote sensor_fault is raised (R-11)',
    });
  }

  if (device.door_stale) {
    add({
      condition_key: 'door_stale',
      kind: 'sensor_unavailable',
      severity: 'warning',
      title: 'Door input is unavailable',
      detail: 'the reed input is not reporting, so the door state is unknown; freshness status is unchanged (R-12)',
    });
  } else if (device.door_open) {
    add({
      condition_key: 'door_open',
      kind: 'door',
      severity: 'warning',
      title: 'Door is open',
      detail: 'the device raises one door_open event per open cycle; the freshness status itself is unchanged (R-12)',
    });
  }

  if (device.zone_status === STATUS_CHECK_FOOD) {
    add({
      condition_key: 'zone_check_food',
      kind: 'status',
      severity: 'error',
      title: 'Zone reported Check Food',
      detail: 'a confirmed environmental latch is active on the device; which specific threshold raised it is not transmitted',
    });
  }

  const hasAvailability = conditions.some((condition) => condition.kind === 'sensor_unavailable');
  if (device.zone_status === STATUS_SENSOR_FAULT && !hasAvailability) {
    add({
      condition_key: 'zone_sensor_fault',
      kind: 'status',
      severity: 'error',
      title: 'Zone reported Sensor Fault / Data Unavailable',
      detail: 'the device status is Sensor Fault but no availability bit is set; the two disagree and are reported as sent',
    });
  }

  // Overall verdicts that the zone did not already explain are item-driven,
  // because Use Soon is reachable only through registered inventory.
  if (device.overall_status === STATUS_USE_SOON && device.zone_status !== STATUS_USE_SOON) {
    add({
      condition_key: 'overall_use_soon',
      kind: 'status',
      severity: 'warning',
      title: 'Overall status is Use Soon',
      detail: 'at least one registered item has passed 75% of its storage window (R-02)',
    });
  }
  if (device.overall_status === STATUS_CHECK_FOOD && device.zone_status !== STATUS_CHECK_FOOD) {
    add({
      condition_key: 'overall_check_food',
      kind: 'status',
      severity: 'error',
      title: 'Overall status is Check Food',
      detail: 'an item reached its expiry or duration limit while the zone itself is acceptable (R-03)',
    });
  }
  if (device.overall_status === STATUS_SENSOR_FAULT && device.zone_status !== STATUS_SENSOR_FAULT) {
    add({
      condition_key: 'overall_sensor_fault',
      kind: 'status',
      severity: 'error',
      title: 'Overall status is Sensor Fault / Data Unavailable',
      detail: 'an item cannot be evaluated: the clock is untrusted or its storage window is zero-length (R-13)',
    });
  }

  for (const item of inventory) {
    if (item.status_code === STATUS_USE_SOON) {
      add({
        condition_key: `item_use_soon:${item.uid}`,
        kind: 'item',
        severity: 'warning',
        title: `${item.name} is approaching its limit`,
        detail: 'the device placed this item at or past 75% of its storage window (R-02)',
        uid: item.uid,
      });
    } else if (item.status_code === STATUS_CHECK_FOOD) {
      add({
        condition_key: `item_check:${item.uid}`,
        kind: 'item',
        severity: 'error',
        title: `${item.name} reached its limit`,
        detail: 'the device placed this item at or past its expiry or duration limit (R-03)',
        uid: item.uid,
      });
    } else if (item.status_code === STATUS_SENSOR_FAULT) {
      add({
        condition_key: `item_unavailable:${item.uid}`,
        kind: 'item',
        severity: 'error',
        title: `${item.name} cannot be evaluated`,
        detail: 'zero-length storage window or an untrusted clock; the device reports Sensor Fault for this item',
        uid: item.uid,
      });
    }
  }

  const severityRank = { error: 0, warning: 1, info: 2 };
  return conditions.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.condition_key.localeCompare(b.condition_key),
  );
}

/** Attach dashboard acknowledgements to derived conditions. */
export function joinAcks(conditions, acks) {
  const byKey = new Map(acks.map((ack) => [ack.condition_key, ack]));
  return conditions.map((condition) => {
    const ack = byKey.get(condition.condition_key);
    return {
      ...condition,
      acknowledged: Boolean(ack),
      acknowledged_at: ack?.acknowledged_at ?? null,
      acknowledged_by: ack?.acknowledged_by ?? null,
      acknowledgement_note: ack?.note ?? null,
    };
  });
}

/** The device block as the dashboard sees it: labels plus the raw numbers. */
export function projectDevice(device) {
  return {
    dev: device.dev,
    contract_version: device.contract_version,
    first_seen_at: device.first_seen_at,
    last_ingest_at: device.last_ingest_at,
    reported_at: device.reported_at,
    time_valid: Boolean(device.time_valid),
    seq: device.seq,
    uptime_s: device.uptime_s,
    boot_count: device.boot_count,
    inv_revision: device.inv_revision,
    pending_count: device.pending_count,
    full_snapshot: Boolean(device.full),
    zone_status: statusWithLabel(device.zone_status),
    overall_status: statusWithLabel(device.overall_status),
    confirmed_fault_mask: device.confirmed_fault_mask,
    confirmed_faults: describeMask(device.confirmed_fault_mask),
    availability_mask: device.availability_mask,
    unavailable: describeMask(device.availability_mask),
    door: { open: Boolean(device.door_open), stale: Boolean(device.door_stale) },
    gas: {
      state: device.gas_state,
      warming_or_baselining: WARMING_GAS_STATES.has(device.gas_state),
    },
    firmware: device.firmware,
    door_timeout_ms: device.door_timeout_ms,
    consecutive_samples: device.consecutive_samples,
    thresholds: parseJson(device.thresholds_json),
    provenance: parseJson(device.provenance_json),
  };
}

export function projectReading(reading) {
  if (!reading) return null;
  return {
    recorded_at: reading.recorded_at,
    reported_at: reading.reported_at,
    time_valid: Boolean(reading.time_valid),
    seq: reading.seq,
    temperature_c: reading.temperature_c,
    humidity_pct: reading.humidity_pct,
    pressure_hpa: reading.pressure_hpa,
    gas_input_mv: reading.gas_input_mv,
    gas_delta_mv: reading.gas_delta_mv,
  };
}

/**
 * Transport staleness: how long since this service last received an accepted
 * snapshot. This is a fact about the link, deliberately named so it can never
 * be mistaken for the device's own freshness verdict or for the door's `stale`
 * flag.
 */
export function projectTransport(device, { nowEpoch, staleAfterSeconds }) {
  const lastIngest = toEpoch(device.last_ingest_at) ?? 0;
  const ageSeconds = Math.max(0, nowEpoch - lastIngest);
  return {
    last_received_at: device.last_ingest_at,
    age_seconds: ageSeconds,
    stale: ageSeconds > staleAfterSeconds,
    stale_after_seconds: staleAfterSeconds,
    note: 'describes the ingest link only; it is not a freshness verdict and never overrides the device status',
  };
}

/**
 * The first-paint aggregate: everything a dashboard needs in one response.
 * Composition only - the pieces above are already pure.
 */
export function buildCurrentView({ device, reading, inventory, acks, nowEpoch, staleAfterSeconds }) {
  const clockTrusted = Boolean(device.time_valid) && device.reported_at !== null;
  const activeInventory = inventory.filter((item) => !item.retired);
  const conditions = joinAcks(deriveActiveConditions(device, activeInventory), acks);

  return {
    device: projectDevice(device),
    transport: projectTransport(device, { nowEpoch, staleAfterSeconds }),
    readings: projectReading(reading),
    inventory: deriveInventory(activeInventory, { nowEpoch, clockTrusted }),
    alerts: conditions,
    counts: {
      inventory_active: activeInventory.length,
      inventory_retired: inventory.length - activeInventory.length,
      alerts_active: conditions.length,
      alerts_unacknowledged: conditions.filter((condition) => !condition.acknowledged).length,
    },
  };
}

export { statusLabel };
