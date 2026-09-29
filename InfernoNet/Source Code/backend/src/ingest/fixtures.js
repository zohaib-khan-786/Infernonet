/**
 * The canonical shape of a v1 snapshot, as data.
 *
 * This lives next to `contract.js` rather than under `test/` because it is used
 * by two consumers: the test suite, and `tools/mock-device.js`, which has to
 * produce payloads a real device would produce. One definition means a mock
 * POST cannot drift away from what the contract accepts.
 *
 * Every value is fixed, so the same call produces byte-identical JSON and tests
 * assert on facts rather than on timing luck. `BASE_EPOCH` is 2025-01-01T00:00Z
 * specifically so expiry arithmetic in tests stays readable.
 */

/** 2025-01-01T00:00:00Z. Fixed so expiry math in tests is readable. */
export const BASE_EPOCH = 1_735_689_600;
export const DAY = 86_400;

export function readingsFixture(overrides = {}) {
  return {
    temperature_c: 4.2,
    humidity_pct: 55.5,
    pressure_hpa: 1013.2,
    gas_input_mv: 780,
    gas_delta_mv: 3.5,
    ...overrides,
  };
}

export function stateFixture(overrides = {}) {
  return {
    zone_status: 0,
    overall_status: 0,
    door_open: false,
    door_stale: false,
    confirmed_fault_mask: 0,
    availability_mask: 0,
    gas_state: 'ready',
    ...overrides,
  };
}

export function itemFixture(overrides = {}) {
  return {
    uid: 'A1B2C3D4',
    name: 'Tomatoes',
    category: 'Vegetables',
    quantity: '2 kg',
    location: 'Storage zone',
    store_date_epoch: BASE_EPOCH,
    expiry_epoch: 0,
    duration_limit_days: 7,
    status: 0,
    // 0 = "the device did not know", which is the honest default for a fixture
    // and for a real item with no label. Tests that care about a manufacturing
    // date pass a real epoch through `overrides`.
    manufacture_epoch: 0,
    ...overrides,
  };
}

export function eventFixture(overrides = {}) {
  return {
    event_id: 1001,
    type: 'temperature_high',
    message: 'Temperature high: 9.4 C (prototype max 8.0 C)',
    timestamp_epoch: BASE_EPOCH,
    time_valid: true,
    // Deliberately absent: an event that is a condition carries no tag, and the
    // whole point of `uid` being optional is that this fixture is what every
    // event type that is not an observation looks like. A fixture that
    // defaulted `uid` would make the regression guard - "a pre-existing event
    // type still validates with no uid" - untestable, because nothing in the
    // suite would ever exercise the absent case.
    ...overrides,
  };
}

/**
 * A tag-presentation event, exactly as the shared contract specifies it.
 *
 * `uid` is the tag the reader read. It is NOT required to be registered: a
 * reader that has just been fitted meets tags nobody has registered yet, and
 * that is a normal event, not an error.
 */
export function scanEventFixture(overrides = {}) {
  return {
    event_id: 7,
    type: 'rfid_scanned',
    uid: '1778F106',
    message: 'RFID tag 1778F106 presented',
    timestamp_epoch: BASE_EPOCH,
    time_valid: true,
    ...overrides,
  };
}

export function configFixture(overrides = {}) {
  return {
    firmware: 'freshguard-0.1.0',
    thresholds: {
      temperature_min_c: 0,
      temperature_max_c: 8,
      humidity_min_pct: 30,
      humidity_max_pct: 85,
      gas_delta_abnormal_mv: 50,
      gas_delta_clear_mv: 40,
      use_soon_percent: 75,
    },
    door_timeout_ms: 30_000,
    consecutive_samples: 3,
    provenance: {
      source: 'prototype_assumption',
      note: 'Zone-wide prototype band, not a certified food-safety limit',
      reference: 'FOOD_STORAGE_ARCHITECTURE.md §9',
    },
    ...overrides,
  };
}

/** A complete, valid, `full: true` snapshot. */
export function snapshotFixture(overrides = {}) {
  const {
    readings = {},
    state = {},
    items = [itemFixture()],
    events = [],
    config = configFixture(),
    ...rest
  } = overrides;

  return {
    v: 1,
    seq: 1,
    uptime: 120,
    epoch: BASE_EPOCH,
    time_valid: true,
    inv_revision: 1,
    pending_count: 0,
    full: true,
    readings: readingsFixture(readings),
    state: stateFixture(state),
    items,
    events,
    config,
    ...rest,
  };
}

/** The same snapshot at a later sequence, with the inventory block omitted. */
export function partialSnapshotFixture(seq, overrides = {}) {
  const base = snapshotFixture({ seq, full: false, items: undefined, events: [], ...overrides });
  delete base.items;
  return base;
}
