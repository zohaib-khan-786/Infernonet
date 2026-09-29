/**
 * Administrator-configured thresholds (SRS requirement xii).
 *
 * The behaviour under test is mostly refusal. A threshold is the number that
 * decides whether food gets flagged, so the cases that matter are the ones
 * where a bad configuration must be rejected at write time rather than
 * discovered later against real food in a real fridge.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { createThresholdService, thresholdBody } from '../src/read/thresholds.js';

function freshDb() {
  return openDatabase({ path: ':memory:' });
}

const VALID = {
  temperature_min_c: 0,
  temperature_max_c: 8,
  humidity_min_pct: 30,
  humidity_max_pct: 85,
  gas_delta_abnormal_mv: 50,
  gas_delta_clear_mv: 40,
  use_soon_percent: 75,
  door_timeout_ms: 30000,
  source: 'authoritative',
  reference: 'test citation',
};

describe('thresholdBody', () => {
  it('accepts a coherent band', () => {
    expect(thresholdBody.safeParse(VALID).success).toBe(true);
  });

  it('rejects a temperature minimum at or above its maximum', () => {
    const parsed = thresholdBody.safeParse({ ...VALID, temperature_min_c: 8, temperature_max_c: 8 });
    expect(parsed.success).toBe(false);
  });

  it('rejects a gas clear threshold at or above its abnormal threshold', () => {
    const parsed = thresholdBody.safeParse({ ...VALID, gas_delta_clear_mv: 60, gas_delta_abnormal_mv: 50 });
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues[0].path).toEqual(['gas_delta_clear_mv']);
  });

  it('rejects an inverted humidity band', () => {
    expect(thresholdBody.safeParse({ ...VALID, humidity_min_pct: 90, humidity_max_pct: 20 }).success).toBe(false);
  });

  it('requires a note when the values are a prototype assumption', () => {
    // The SRS is explicit that unsourced values must be identifiable as
    // prototype assumptions rather than presented as food-safety limits.
    const parsed = thresholdBody.safeParse({ ...VALID, source: 'prototype_assumption', note: undefined });
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues[0].path).toEqual(['note']);
  });

  it('accepts a prototype assumption that explains itself', () => {
    expect(thresholdBody.safeParse({ ...VALID, source: 'prototype_assumption', note: 'bench default' }).success).toBe(true);
  });

  it('rejects unknown fields rather than silently dropping them', () => {
    expect(thresholdBody.safeParse({ ...VALID, invented_limit: 5 }).success).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(thresholdBody.safeParse({ ...VALID, humidity_max_pct: 140 }).success).toBe(false);
    expect(thresholdBody.safeParse({ ...VALID, door_timeout_ms: 10 }).success).toBe(false);
    expect(thresholdBody.safeParse({ ...VALID, use_soon_percent: 0 }).success).toBe(false);
  });
});

describe('threshold service', () => {
  let db;
  let thresholds;

  beforeEach(() => {
    db = freshDb();
    thresholds = createThresholdService({ db });
  });

  afterEach(() => db.close());

  it('returns null before anything is configured', () => {
    expect(thresholds.get('fg-01', 'zone')).toBeNull();
  });

  it('stores a profile and reports its revision', () => {
    const saved = thresholds.set('fg-01', VALID);
    expect(saved.revision).toBe(1);
    expect(saved.values.temperature_max_c).toBe(8);
  });

  it('keeps fields that a later partial update does not mention', () => {
    thresholds.set('fg-01', VALID);
    const updated = thresholds.set('fg-01', { temperature_max_c: 5, source: 'authoritative' });
    expect(updated.values.temperature_max_c).toBe(5);
    expect(updated.values.humidity_max_pct).toBe(85);
    expect(updated.values.gas_delta_abnormal_mv).toBe(50);
    expect(updated.values.door_timeout_ms).toBe(30000);
  });

  it('treats an explicit null as clearing a limit', () => {
    thresholds.set('fg-01', VALID);
    const updated = thresholds.set('fg-01', { gas_delta_abnormal_mv: null, source: 'authoritative' });
    expect(updated.values.gas_delta_abnormal_mv).toBeNull();
    // The others are untouched.
    expect(updated.values.temperature_max_c).toBe(8);
  });

  it('increments the revision on every change', () => {
    thresholds.set('fg-01', VALID);
    expect(thresholds.set('fg-01', { ...VALID, temperature_max_c: 6 }).revision).toBe(2);
    expect(thresholds.set('fg-01', { ...VALID, temperature_max_c: 7 }).revision).toBe(3);
  });

  it('records who changed what and when', () => {
    thresholds.set('fg-01', { ...VALID, changed_by: 'operator', note: 'first' });
    thresholds.set('fg-01', { ...VALID, temperature_max_c: 5, changed_by: 'admin2' });
    const history = thresholds.history('fg-01', 'zone');
    expect(history).toHaveLength(2);
    // Newest first.
    expect(history[0].revision).toBe(2);
    expect(history[0].changed_by).toBe('admin2');
    expect(history[0].before.values.temperature_max_c).toBe(8);
    expect(history[0].after.values.temperature_max_c).toBe(5);
    expect(history[1].before).toBeNull();
  });

  it('keeps scopes independent', () => {
    thresholds.set('fg-01', { ...VALID, scope: 'zone' });
    thresholds.set('fg-01', { ...VALID, scope: 'item', temperature_max_c: 4 });
    expect(thresholds.get('fg-01', 'zone').values.temperature_max_c).toBe(8);
    expect(thresholds.get('fg-01', 'item').values.temperature_max_c).toBe(4);
  });

  it('keeps devices independent', () => {
    thresholds.set('fg-01', VALID);
    thresholds.set('fg-02', { ...VALID, temperature_max_c: 12 });
    expect(thresholds.get('fg-01', 'zone').values.temperature_max_c).toBe(8);
    expect(thresholds.get('fg-02', 'zone').values.temperature_max_c).toBe(12);
  });
});

describe('device-facing projection', () => {
  let db;
  let thresholds;

  beforeEach(() => {
    db = freshDb();
    thresholds = createThresholdService({ db });
  });

  afterEach(() => db.close());

  it('reports rev 0 and nothing configured when unset', () => {
    const payload = thresholds.forDevice('fg-01', 'zone');
    expect(payload).toEqual({ rev: 0, configured: false, values: {} });
  });

  it('is flat with short unique keys', () => {
    // The firmware parses this with a small scanner that has no schema
    // knowledge. A nested or ambiguous document would make it guess which
    // "revision" it found, and the one number that matters is that one.
    thresholds.set('fg-01', VALID);
    const payload = thresholds.forDevice('fg-01', 'zone');
    expect(payload.rev).toBe(1);
    expect(payload.configured).toBe(true);
    for (const key of ['tmin', 'tmax', 'hmin', 'hmax', 'gabn', 'gclr', 'usp', 'dtms']) {
      expect(Object.hasOwn(payload.values, key)).toBe(true);
    }
  });
});

describe('sync reporting', () => {
  let db;
  let thresholds;

  beforeEach(() => {
    db = freshDb();
    thresholds = createThresholdService({ db });
  });

  afterEach(() => db.close());

  it('reports in_sync as null, not false, when the device has no revision', () => {
    // Honest unknown. Reporting false would claim the device is definitely
    // running stale limits, which a device too old to carry a revision cannot
    // support either way.
    thresholds.set('fg-01', VALID);
    expect(thresholds.view('fg-01', 'zone').in_sync).toBeNull();
  });

  it('never returns a verdict of its own', () => {
    thresholds.set('fg-01', VALID);
    const view = thresholds.view('fg-01', 'zone');
    // The device is the sole authority for freshness. Nothing here may be
    // mistaken for a computed status.
    expect(view.configured).not.toHaveProperty('status');
    expect(view).not.toHaveProperty('zone_status');
    expect(view).not.toHaveProperty('overall_status');
  });
});
