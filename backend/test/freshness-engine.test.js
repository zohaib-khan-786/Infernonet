/**
 * FreshGuard freshness engine.
 *
 * WHAT IS BEING PROVEN, and why it is proven this way:
 *
 * This is a food-safety tool, so the tests are mostly about what the engine
 * REFUSES to claim. A verdict that is right is worth much less than one that
 * cannot be right for the wrong reason, and the ways this feature could
 * confidently lie are all mundane: a sensor that read nothing, a device clock
 * left at a test epoch, a threshold nobody configured.
 *
 * So every history below is WRITTEN OUT BY HAND, sample by sample, with the
 * exact value, the exact minute and the exact server clock at each step. No
 * seeded randomness, no "assert whatever falls out". A verdict is only ever
 * asserted after a history was constructed to produce it and nothing else, and
 * the boundary cases (a value exactly on a limit, a deviation exactly equal to
 * the warning margin) are pinned deliberately so a future edit to a comparison
 * operator shows up here rather than in a fridge.
 *
 * The histories are delivered through the real ingest path, moving the test
 * clock to each sample's instant, so `reading.recorded_at` lands exactly where
 * the test says it does. That matters: the exposure window is built from server
 * receipt time, and a test that inserted rows behind the service would not be
 * testing the thing that ships.
 *
 * SRS references are to `FreshGuard-Smart IoT Revolution_SRS.pdf`, cited by
 * section and page. See src/freshness/rules.js for the full citation table.
 */
import { describe, expect, it } from 'vitest';
import { makeTestStack } from './helpers.js';
import { BASE_EPOCH, DAY, itemFixture, snapshotFixture } from '../src/ingest/fixtures.js';

const MINUTE = 60;
const DEV = 'fg-01';
/** The instant every scenario is judged at. The default test clock sits here. */
const EVAL = BASE_EPOCH;
/** The built-in prototype maximum, and the warning margin either side of it. */
const MAX_C = 8;
const MARGIN_C = 2.0;
const GAS_ABNORMAL_MV = 50;

/** In-range cabinet air, written out rather than shared, so a change is visible. */
const AIR = { temperature_c: 4.2, humidity_pct: 55.5, pressure_hpa: 1013.2, gas_input_mv: 780, gas_delta_mv: 3.5 };

/**
 * A hub that records what the ingest path pushes, instead of a real one.
 *
 * Deliberately not a listening socket: this proves the recompute-and-push
 * contract without any server being started. `attach` throws, so a test that
 * accidentally opens a stream fails loudly instead of quietly succeeding.
 */
function recordingHub() {
  const published = [];
  return {
    published,
    get clientCount() {
      return 0;
    },
    attach() {
      throw new Error('recordingHub cannot attach a client; this test must not open a stream');
    },
    publish(dev, data) {
      published.push({ dev, data });
      return 1;
    },
    close() {},
  };
}

/**
 * Deliver one snapshot per sample, moving the server clock to each sample's own
 * instant so the stored `recorded_at` is the sample's timestamp.
 *
 * `deviceEpoch` is the DEVICE clock and is deliberately separate from the server
 * clock: that separation is the whole point of the clock-trust tests, and it
 * cannot be exercised if the two are the same value.
 */
async function seedHistory(stack, {
  dev = DEV,
  samples,
  items = [],
  state = {},
  startEpoch = EVAL - 9 * MINUTE,
  step = MINUTE,
  deviceEpoch = (at) => at,
  timeValid = true,
} = {}) {
  let seq = 0;
  let uptime = 60;
  for (const [index, sample] of samples.entries()) {
    const at = startEpoch + index * step;
    stack.clock.set(new Date(at * 1000).toISOString());
    seq += 1;
    uptime += step;
    const snapshot = snapshotFixture({
      seq,
      uptime,
      epoch: timeValid ? deviceEpoch(at) : 0,
      time_valid: timeValid,
      inv_revision: 1,
      full: index === 0,
      readings: { ...AIR, ...sample },
      state,
    });
    // Only the first snapshot carries the registry. `snapshotFixture` defaults
    // `items` to a fixture item, and passing `items: undefined` would trigger
    // that default rather than omitting the key - so a later snapshot would
    // quietly re-register the default item over the one under test.
    if (index === 0) snapshot.items = items;
    else delete snapshot.items;
    await stack.post(dev, snapshot).expect(200);
  }
  return startEpoch + (samples.length - 1) * step;
}

/** `n` identical samples, one a minute, ending at EVAL. */
const steady = (n, readings = {}) => Array.from({ length: n }, () => ({ ...readings }));

/** Item fixtures positioned relative to the evaluation instant. */
const itemDaysAgo = (days, overrides = {}) => itemFixture({
  store_date_epoch: EVAL - days * DAY,
  expiry_epoch: 0,
  duration_limit_days: 10,
  ...overrides,
});

const getFreshness = async (stack, dev = DEV) =>
  (await stack.get(`/api/v1/devices/${dev}/freshness`).expect(200)).body;

const onlyItem = (body) => {
  expect(body.items).toHaveLength(1);
  return body.items[0];
};

// ---------------------------------------------------------------------------

describe('layer 2: the cabinet condition, judged from a constructed history', () => {
  it('reports in_range when every channel sits inside its configured band', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(10), items: [itemDaysAgo(1)] });

    const { cabinet } = await getFreshness(stack);
    expect(cabinet.condition).toBe('in_range');
    expect(cabinet.source).toBe('cabinet_measured');
    expect(cabinet.evidence.coverage).toBe('complete');
    expect(cabinet.evidence.minutes_out_of_range).toBe(0);

    const temperature = cabinet.evidence.per_measurement.temperature_c;
    expect(temperature).toMatchObject({ samples: 10, min: 4.2, max: 4.2, avg: 4.2, severity: 'in_range' });
    expect(temperature.label).toBe('cabinet air temperature');
    expect(cabinet.evidence.per_measurement.humidity_pct.avg).toBe(55.5);
    expect(cabinet.evidence.active_channels).toEqual(['temperature_c', 'humidity_pct', 'gas_delta_mv']);
    expect(cabinet.evidence.missing_inputs).toEqual([]);
    // The window is stated, along with the time base it is measured on.
    expect(cabinet.evidence.window.minutes).toBe(360);
    expect(cabinet.evidence.window.samples).toBe(10);
    expect(cabinet.evidence.window.time_base).toContain('server receipt time');
    expect(cabinet.evidence.window.requested_to).toBe(new Date(EVAL * 1000).toISOString());
  });

  it('reports warning when temperature leaves the band by less than the stated margin', async () => {
    const stack = makeTestStack();
    // 9.0 is 1.0 over the built-in 8.0 maximum, inside the 2.0 warning margin.
    await seedHistory(stack, { samples: steady(10, { temperature_c: 9 }), items: [itemDaysAgo(1)] });

    const { cabinet } = await getFreshness(stack);
    expect(cabinet.condition).toBe('warning');
    expect(cabinet.evidence.per_measurement.temperature_c).toMatchObject({
      severity: 'warning',
      worst_deviation: 1,
      out_of_band_samples: 10,
    });
    expect(cabinet.evidence.severity_rules.margins.temperature_c).toBe(MARGIN_C);
    expect(cabinet.evidence.severity_rules.source).toBe('built_in_assumption');
  });

  it('reports critical when temperature leaves the band by more than the margin', async () => {
    const stack = makeTestStack();
    // 11.0 is 3.0 over: past the 2.0 margin.
    await seedHistory(stack, { samples: steady(10, { temperature_c: 11 }), items: [itemDaysAgo(1)] });

    const { cabinet } = await getFreshness(stack);
    expect(cabinet.condition).toBe('critical');
    expect(cabinet.evidence.per_measurement.temperature_c.severity).toBe('critical');
    expect(cabinet.reason).toContain('cabinet air left its configured limits');
  });

  it('treats a configured band edge as inside the band, and pins both sides of the margin', async () => {
    const stack = makeTestStack();

    // Exactly on the maximum. The limit is the edge of an acceptable RANGE, so
    // sitting on it is inside it.
    await seedHistory(stack, { samples: steady(4, { temperature_c: MAX_C }) });
    expect((await getFreshness(stack)).cabinet.condition).toBe('in_range');

    // Exactly one margin over: the margin is inclusive at warning.
    stack.clock.set(new Date(EVAL * 1000).toISOString());
    await seedHistory(stack, { samples: steady(4, { temperature_c: MAX_C + MARGIN_C }) });
    expect((await getFreshness(stack)).cabinet.evidence.per_measurement.temperature_c.severity).toBe('warning');

    // A hair past the margin: critical.
    stack.clock.set(new Date(EVAL * 1000).toISOString());
    await seedHistory(stack, { samples: steady(4, { temperature_c: MAX_C + MARGIN_C + 0.5 }) });
    expect((await getFreshness(stack)).cabinet.evidence.per_measurement.temperature_c.severity).toBe('critical');
  });

  it('takes the MQ-135 straight to critical at the configured abnormal threshold', async () => {
    const stack = makeTestStack();

    // Gas has no warning tier: the configured abnormal level is the alarm.
    await seedHistory(stack, { samples: steady(6, { gas_delta_mv: GAS_ABNORMAL_MV - 0.1 }) });
    const below = await getFreshness(stack);
    expect(below.cabinet.evidence.per_measurement.gas_delta_mv.severity).toBe('in_range');
    expect(below.cabinet.evidence.gas.at_or_above_abnormal).toBe(false);

    stack.clock.set(new Date(EVAL * 1000).toISOString());
    await seedHistory(stack, { samples: steady(6, { gas_delta_mv: GAS_ABNORMAL_MV }) });
    const at = await getFreshness(stack);
    expect(at.cabinet.evidence.per_measurement.gas_delta_mv.severity).toBe('critical');
    expect(at.cabinet.condition).toBe('critical');
    expect(at.cabinet.evidence.gas.at_or_above_abnormal).toBe(true);
  });

  it('counts only exposure bracketed by two real measurements', async () => {
    const stack = makeTestStack();
    // Four out-of-band samples (E-9..E-6) then six good ones (E-5..E), one a
    // minute.
    //
    // Zero-order hold attributes the interval AFTER a sample to that sample, so
    // E-9->E-8, E-8->E-7, E-7->E-6 and E-6->E-5 are each bracketed by an
    // out-of-band reading and count. E-5->E-4 and onwards are bracketed by
    // in-band readings and do not. Four minutes, and nothing is extrapolated
    // past the newest sample to reach "now".
    const samples = [
      { temperature_c: 9 },
      { temperature_c: 9 },
      { temperature_c: 9 },
      { temperature_c: 9 },
      {}, {}, {}, {}, {}, {},
    ];
    await seedHistory(stack, { samples, items: [itemDaysAgo(1)] });

    const { cabinet } = await getFreshness(stack);
    const temperature = cabinet.evidence.per_measurement.temperature_c;
    expect(temperature.out_of_band_samples).toBe(4);
    expect(temperature.minutes_out_of_range).toBe(4);
    expect(temperature.exposure_basis).toBe('observed_intervals');
    expect(cabinet.evidence.minutes_out_of_range).toBe(4);
    expect(cabinet.evidence.unobserved_after_seconds).toBe(0);
  });

  it('reports the gap after the newest sample separately, never inside the exposure', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(10), items: [itemDaysAgo(1)] });
    // Twenty minutes pass with no new snapshot at all.
    stack.clock.advanceSeconds(20 * 60);

    const { cabinet } = await getFreshness(stack);
    expect(cabinet.evidence.per_measurement.temperature_c.minutes_out_of_range).toBe(0);
    expect(cabinet.evidence.unobserved_after_seconds).toBe(1200);
    expect(cabinet.evidence.last_sample_at).toBe(new Date(EVAL * 1000).toISOString());
  });

  it('reports gas in millivolts only, and says the reading cannot be attributed to an item', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(8), items: [itemDaysAgo(1)] });

    const { cabinet } = await getFreshness(stack);
    expect(cabinet.evidence.gas.unit).toBe('mV');
    expect(cabinet.evidence.gas.abnormal_threshold_mv).toBe(GAS_ABNORMAL_MV);
    expect(cabinet.evidence.gas.clear_below_mv).toBe(40);
    expect(cabinet.evidence.per_measurement.gas_delta_mv.unit).toBe('mV');
    expect(cabinet.evidence.observed_only.gas_input_mv.unit).toBe('mV');
    // SRS 1.6 (x): one MQ-135 over a shared zone, not attributable to an item.
    expect(cabinet.evidence.gas.note).toContain('cabinet-air aggregate');
    expect(cabinet.evidence.gas.note).toContain('cannot be attributed to any specific food item');
    // SRS 1.6 (v): no concentration is reported, so no ppm field can exist.
    expect(JSON.stringify(cabinet)).not.toMatch(/"[a-z_]*ppm[a-z_]*"\s*:/i);
    expect(JSON.stringify(cabinet)).not.toMatch(/\d\s*ppm\b/i);
  });

  it('excludes an MQ-135 that is still warming and refuses to call the cabinet in range', async () => {
    const stack = makeTestStack();
    // SRS 1.6 (v): the sensor must stabilise before any baseline is recorded,
    // so its output is not a cabinet measurement yet.
    await seedHistory(stack, {
      samples: steady(10),
      items: [itemDaysAgo(1)],
      state: { gas_state: 'warming_up' },
    });

    const { cabinet } = await getFreshness(stack);
    expect(cabinet.evidence.per_measurement.gas_delta_mv.severity).toBe('excluded');
    expect(cabinet.evidence.missing_inputs).toContainEqual({ channel: 'gas_delta_mv', reason: 'mq135_not_ready' });
    expect(cabinet.condition).toBe('insufficient_data');
    // The samples are still shown - excluded from judgement, not hidden.
    expect(cabinet.evidence.per_measurement.gas_delta_mv.samples).toBe(10);
  });

  it('labels the built-in defaults as an assumption rather than a cited limit', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(4), items: [itemDaysAgo(1)] });

    const { thresholds } = await getFreshness(stack);
    expect(thresholds.source).toBe('built_in_assumption');
    expect(thresholds.basis).toBe('built_in_default');
    expect(thresholds.revision).toBeNull();
    expect(thresholds.values.temperature_max_c).toBe(MAX_C);
    expect(thresholds.note).toContain('NOT cited food-safety limits');
  });
});

// ---------------------------------------------------------------------------

describe('layer 1: the item date status, from the item\'s own fields', () => {
  it('lets a non-zero expiry epoch outrank the duration limit and names itself', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, {
      samples: steady(4),
      items: [itemFixture({
        store_date_epoch: EVAL - 5 * DAY,
        expiry_epoch: EVAL + 5 * DAY,
        duration_limit_days: 30,
      })],
    });

    const item = onlyItem(await getFreshness(stack));
    const date = item.evidence.date_derived;
    expect(date.driving_field).toBe('expiry_epoch');
    expect(date.driving_rule).toContain('outranks duration_limit_days');
    expect(date.status).toBe('fresh');
    expect(date.progress_percent).toBe(50);
    expect(date.days_remaining).toBe(5);
    expect(date.days_overdue).toBe(0);
  });

  it('uses the duration limit when there is no expiry epoch, and names itself', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(4), items: [itemDaysAgo(8)] });

    const date = onlyItem(await getFreshness(stack)).evidence.date_derived;
    expect(date.driving_field).toBe('duration_limit_days');
    expect(date.status).toBe('use_soon');
    expect(date.progress_percent).toBe(80);
    expect(date.days_remaining).toBe(2);
  });

  it('reports days overdue for a passed deadline', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, {
      samples: steady(4),
      items: [itemFixture({ store_date_epoch: EVAL - 10 * DAY, expiry_epoch: EVAL - 2 * DAY, duration_limit_days: 0 })],
    });

    const date = onlyItem(await getFreshness(stack)).evidence.date_derived;
    expect(date.status).toBe('expired');
    expect(date.days_remaining).toBe(0);
    expect(date.days_overdue).toBe(2);
    expect(date.reason).toContain('2 day(s) ago');
  });

  it('cannot judge an item the device registered with neither date nor duration', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, {
      samples: steady(4),
      items: [itemFixture({ store_date_epoch: EVAL - DAY, expiry_epoch: 0, duration_limit_days: 0 })],
    });

    const item = onlyItem(await getFreshness(stack));
    expect(item.evidence.date_derived.status).toBe('insufficient_data');
    expect(item.evidence.date_derived.driving_field).toBeNull();
    expect(item.evidence.date_derived.reason).toContain('neither an expiry epoch nor a duration limit');
    // A registration gap, not a freshness finding.
    expect(item.evidence.date_derived.note).toContain('registration gap');
  });
});

// ---------------------------------------------------------------------------

describe('the blended per-item status: all four, each from its own history', () => {
  it('fresh: the date layer is early and the cabinet is in range', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(10), items: [itemDaysAgo(1)] });

    const item = onlyItem(await getFreshness(stack));
    expect(item.status).toBe('fresh');
    expect(item.forced_by).toBeNull();
    expect(item.evidence.date_derived.status).toBe('fresh');
    expect(item.evidence.cabinet_derived.condition).toBe('in_range');
  });

  it('use_soon: the date layer is approaching its limit', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(10), items: [itemDaysAgo(8)] });

    const item = onlyItem(await getFreshness(stack));
    expect(item.status).toBe('use_soon');
    expect(item.forced_by).toBe('date_derived');
    expect(item.evidence.date_derived.status).toBe('use_soon');
    expect(item.evidence.cabinet_derived.condition).toBe('in_range');
    expect(item.evidence.cabinet_derived.used_in_status).toBe(false);
  });

  it('use_soon: the cabinet it shares is in a warning condition', async () => {
    const stack = makeTestStack();
    // Date layer is comfortably fresh, so only the cabinet can have forced this.
    await seedHistory(stack, { samples: steady(10, { temperature_c: 9 }), items: [itemDaysAgo(1)] });

    const item = onlyItem(await getFreshness(stack));
    expect(item.status).toBe('use_soon');
    expect(item.forced_by).toBe('cabinet_derived');
    expect(item.evidence.date_derived.status).toBe('fresh');
    expect(item.evidence.cabinet_derived.condition).toBe('warning');
    expect(item.evidence.cabinet_derived.used_in_status).toBe(true);
  });

  it('check_food: the date layer is past its registered deadline', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, {
      samples: steady(10),
      items: [itemFixture({ store_date_epoch: EVAL - 10 * DAY, expiry_epoch: EVAL - 3 * DAY, duration_limit_days: 0 })],
    });

    const item = onlyItem(await getFreshness(stack));
    expect(item.status).toBe('check_food');
    expect(item.forced_by).toBe('date_derived');
    expect(item.evidence.date_derived.status).toBe('expired');
    expect(item.evidence.date_derived.days_overdue).toBe(3);
    expect(item.evidence.cabinet_derived.condition).toBe('in_range');
  });

  it('check_food: the cabinet it shares is in a critical condition', async () => {
    const stack = makeTestStack();
    // Date layer is comfortably fresh, so only the cabinet can have forced this.
    await seedHistory(stack, { samples: steady(10, { gas_delta_mv: 62 }), items: [itemDaysAgo(1)] });

    const item = onlyItem(await getFreshness(stack));
    expect(item.status).toBe('check_food');
    expect(item.forced_by).toBe('cabinet_derived');
    expect(item.evidence.date_derived.status).toBe('fresh');
    expect(item.evidence.cabinet_derived.condition).toBe('critical');
  });

  it('insufficient_data: the window holds no history at all', async () => {
    // The window is shortened to five minutes so the gap can be opened WITHOUT
    // also pushing the device clock out of tolerance. That is deliberate: this
    // test is about a cabinet that produced no measurements while the dates
    // remain perfectly judgeable, and a longer wait would have invalidated the
    // clock too and tested the wrong thing (the clock-trust tests below cover
    // that case properly).
    const stack = makeTestStack({ config: { FG_FRESHNESS_WINDOW_MINUTES: 5 } });
    await seedHistory(stack, { samples: steady(6), items: [itemDaysAgo(1)] });
    expect(onlyItem(await getFreshness(stack)).status).toBe('fresh');

    // The device then goes quiet for longer than the exposure window. The item
    // itself is untouched, and the date layer can still be judged - but nothing
    // at all was measured, so a clean `fresh` is not available.
    stack.clock.advanceSeconds(11 * 60);

    const body = await getFreshness(stack);
    expect(body.clock_trusted).toBe(true);
    expect(body.cabinet.condition).toBe('insufficient_data');
    expect(body.cabinet.evidence.window.samples).toBe(0);
    expect(body.cabinet.reason).toContain('no cabinet measurement was recorded in the window');

    const item = onlyItem(body);
    expect(item.status).toBe('insufficient_data');
    expect(item.evidence.date_derived.status).toBe('fresh');
    expect(item.evidence.cabinet_derived.condition).toBe('insufficient_data');
    expect(item.reason).toContain('cabinet layer');
  });

  it('insufficient_data: a channel that produced nothing is named, and a good one is not promoted', async () => {
    const stack = makeTestStack();
    // Temperature is unavailable; humidity and gas are perfect. "In range" is a
    // claim that everything is fine, and this engine cannot make it.
    await seedHistory(stack, {
      samples: steady(10, { temperature_c: null }),
      items: [itemDaysAgo(1)],
      state: { availability_mask: 1 << 0 },
    });

    const body = await getFreshness(stack);
    expect(body.cabinet.condition).toBe('insufficient_data');
    expect(body.cabinet.evidence.coverage).toBe('partial');
    expect(body.cabinet.evidence.missing_inputs).toContainEqual({
      channel: 'temperature_c',
      reason: 'no_samples_in_window',
    });
    // The input that did report is still shown, and still judged on its own.
    expect(body.cabinet.evidence.per_measurement.temperature_c.measured).toBe(false);
    expect(body.cabinet.evidence.per_measurement.humidity_pct.severity).toBe('in_range');
    expect(onlyItem(body).status).toBe('insufficient_data');
  });

  it('insufficient_data: the date layer cannot be judged even with a perfect cabinet', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, {
      samples: steady(10),
      items: [itemFixture({ store_date_epoch: EVAL - DAY, expiry_epoch: 0, duration_limit_days: 0 })],
    });

    const body = await getFreshness(stack);
    expect(body.cabinet.condition).toBe('in_range');
    expect(onlyItem(body).status).toBe('insufficient_data');
  });

  it('never downgrades a definite bad verdict because another layer is missing', async () => {
    // Five-minute window again, so the cabinet goes silent while the device
    // clock stays inside tolerance and the date layer keeps its certainty.
    const stack = makeTestStack({ config: { FG_FRESHNESS_WINDOW_MINUTES: 5 } });
    // Three days past a registered expiry AND no cabinet measurements at all.
    // The certain problem is reported; the missing sensor is reported beside it.
    await seedHistory(stack, {
      samples: steady(6),
      items: [itemFixture({ store_date_epoch: EVAL - 10 * DAY, expiry_epoch: EVAL - 3 * DAY, duration_limit_days: 0 })],
    });
    stack.clock.advanceSeconds(11 * 60);

    const body = await getFreshness(stack);
    expect(body.cabinet.condition).toBe('insufficient_data');
    expect(body.clock_trusted).toBe(true);

    const item = onlyItem(body);
    expect(item.status).toBe('check_food');
    expect(item.forced_by).toBe('date_derived');
    expect(item.evidence.date_derived.days_overdue).toBe(3);
    expect(item.evidence.cabinet_derived.condition).toBe('insufficient_data');
  });
});

// ---------------------------------------------------------------------------

describe('clock trust', () => {
  it('degrades the date layer and names it when the device says its own clock is invalid', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(10), items: [itemDaysAgo(1)], timeValid: false });

    const body = await getFreshness(stack);
    expect(body.clock_trusted).toBe(false);
    expect(body.clock.trusted).toBe(false);
    expect(body.clock.reasons).toContain('device_time_invalid');
    expect(body.clock.device_reported_at).toBeNull();
    expect(body.clock.untrustworthy_layers).toEqual(['date_derived']);
    expect(body.clock.trustworthy_layers).toEqual(['cabinet_derived']);

    const item = onlyItem(body);
    expect(item.evidence.date_derived.status).toBe('insufficient_data');
    expect(item.evidence.date_derived.days_remaining).toBeNull();
    expect(item.evidence.date_derived.days_overdue).toBeNull();
    expect(item.evidence.date_derived.progress_percent).toBeNull();
    // The deadline itself is clock-independent, so it is still shown.
    expect(item.evidence.date_derived.deadline).not.toBeNull();
    expect(item.evidence.date_derived.reason).toContain('device clock is not trusted');
    expect(item.status).toBe('insufficient_data');
  });

  it('degrades the date layer when the device RTC is left at a test epoch', async () => {
    const stack = makeTestStack();
    // Device thinks it is 400 days later than the server does. Nothing about the
    // resulting day count would look wrong, which is exactly the danger.
    await seedHistory(stack, {
      samples: steady(10),
      items: [itemDaysAgo(1)],
      deviceEpoch: () => EVAL + 400 * DAY,
    });

    const body = await getFreshness(stack);
    expect(body.clock_trusted).toBe(false);
    expect(body.clock.reasons).toContain('device_clock_skew_exceeds_max');
    expect(body.clock.skew_seconds).toBe(400 * DAY);
    expect(body.clock.max_skew_seconds).toBe(900);

    // The cabinet layer is untouched, because its window is built from server
    // receipt times rather than from the device clock.
    expect(body.cabinet.condition).toBe('in_range');
    expect(body.cabinet.evidence.window.time_base).toContain('server receipt time');

    const item = onlyItem(body);
    expect(item.evidence.date_derived.status).toBe('insufficient_data');
    expect(item.evidence.date_derived.days_remaining).toBeNull();
    expect(item.evidence.cabinet_derived.note).toContain('stands even while the date layer is withheld');
    expect(item.status).toBe('insufficient_data');
  });

  it('keeps the clock trusted while the device is inside the tolerance', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, {
      samples: steady(10),
      items: [itemDaysAgo(1)],
      deviceEpoch: (at) => at + 60, // one minute adrift
    });

    const body = await getFreshness(stack);
    expect(body.clock_trusted).toBe(true);
    expect(body.clock.reasons).toEqual([]);
    expect(body.clock.skew_seconds).toBe(60);
    expect(body.clock.untrustworthy_layers).toEqual([]);
    expect(onlyItem(body).status).toBe('fresh');
  });
});

// ---------------------------------------------------------------------------

describe('thresholds', () => {
  const ADMIN = 'freshguard-admin-token-for-tests';
  const putProfile = (stack, body) =>
    stack.send('put')(`/api/v1/devices/${DEV}/thresholds`)
      .set('Authorization', `Bearer ${ADMIN}`)
      .send(body)
      .expect(200);

  const PROFILE = {
    temperature_min_c: 0,
    temperature_max_c: MAX_C,
    humidity_min_pct: 30,
    humidity_max_pct: 85,
    gas_delta_abnormal_mv: GAS_ABNORMAL_MV,
    gas_delta_clear_mv: 40,
    use_soon_percent: 75,
    source: 'authoritative',
    reference: 'test citation',
  };

  it('changes the verdict, and changes what thresholds.source says about it', async () => {
    const stack = makeTestStack({ config: { FG_ADMIN_TOKEN: ADMIN } });
    // 9.0 C against the built-in 8.0 maximum: a warning, so use_soon.
    await seedHistory(stack, { samples: steady(10, { temperature_c: 9 }), items: [itemDaysAgo(1)] });

    const before = await getFreshness(stack);
    expect(before.cabinet.condition).toBe('warning');
    expect(onlyItem(before).status).toBe('use_soon');
    expect(before.thresholds.source).toBe('built_in_assumption');
    expect(before.thresholds.basis).toBe('built_in_default');
    expect(before.thresholds.revision).toBeNull();

    // The same readings against a tighter configured maximum: 4.0 over, past
    // the margin, so critical.
    await putProfile(stack, { ...PROFILE, temperature_max_c: 5 });

    const after = await getFreshness(stack);
    expect(after.cabinet.condition).toBe('critical');
    expect(after.cabinet.evidence.per_measurement.temperature_c.limits.max).toBe(5);
    expect(onlyItem(after).status).toBe('check_food');
    expect(onlyItem(after).forced_by).toBe('cabinet_derived');

    // Requirement 4: the source is carried through so a cited limit stays
    // distinguishable from a prototype assumption.
    expect(after.thresholds.source).toBe('authoritative');
    expect(after.thresholds.basis).toBe('configured_zone_profile');
    expect(after.thresholds.revision).toBe(1);
    expect(after.thresholds.reference).toBe('test citation');
  });

  it('widens back to in_range when the limit is raised above the readings', async () => {
    const stack = makeTestStack({ config: { FG_ADMIN_TOKEN: ADMIN } });
    await seedHistory(stack, { samples: steady(10, { temperature_c: 9 }), items: [itemDaysAgo(1)] });
    await putProfile(stack, { ...PROFILE, temperature_max_c: 5 });
    expect(onlyItem(await getFreshness(stack)).status).toBe('check_food');

    await putProfile(stack, { temperature_max_c: 20, source: 'authoritative' });
    const relaxed = await getFreshness(stack);
    expect(relaxed.cabinet.condition).toBe('in_range');
    expect(onlyItem(relaxed).status).toBe('fresh');
    // A partial update keeps the limits it did not mention.
    expect(relaxed.thresholds.values.gas_delta_abnormal_mv).toBe(GAS_ABNORMAL_MV);
    expect(relaxed.thresholds.revision).toBe(2);
  });

  it('measures against its own limits and never against the ones the device reports', async () => {
    const stack = makeTestStack({ config: { FG_ADMIN_TOKEN: ADMIN } });
    await seedHistory(stack, { samples: steady(10, { temperature_c: 9 }), items: [itemDaysAgo(1)] });
    await putProfile(stack, { ...PROFILE, temperature_max_c: 5 });

    const { thresholds } = await getFreshness(stack);
    // What the backend judged against.
    expect(thresholds.values.temperature_max_c).toBe(5);
    // What the device says it is applying - reported beside it, never used.
    expect(thresholds.device_applied.values.temperature_max_c).toBe(MAX_C);
    expect(thresholds.device_applied.revision).toBeNull();
    // The device has not fetched a revision, so agreement is unknown, not false.
    expect(thresholds.device_in_sync).toBeNull();
  });

  it('treats a cleared limit as a channel nobody asked about, not a missing input', async () => {
    const stack = makeTestStack({ config: { FG_ADMIN_TOKEN: ADMIN } });
    // Humidity and gas explicitly null: the operator is not asking about them.
    await putProfile(stack, {
      temperature_min_c: 0,
      temperature_max_c: MAX_C,
      humidity_min_pct: null,
      humidity_max_pct: null,
      gas_delta_abnormal_mv: null,
      gas_delta_clear_mv: null,
      use_soon_percent: 75,
      source: 'authoritative',
    });
    await seedHistory(stack, { samples: steady(10, { temperature_c: 9 }), items: [itemDaysAgo(1)] });

    const { cabinet } = await getFreshness(stack);
    expect(cabinet.evidence.active_channels).toEqual(['temperature_c']);
    expect(cabinet.evidence.inactive_channels).toEqual([
      { channel: 'humidity_pct', reason: 'no_configured_limit' },
      { channel: 'gas_delta_mv', reason: 'no_configured_limit' },
    ]);
    expect(cabinet.evidence.missing_inputs).toEqual([]);
    expect(cabinet.condition).toBe('warning');
  });
});

// ---------------------------------------------------------------------------

describe('recompute on ingest, pushed over the existing stream', () => {
  /** The ingest handler pushes after answering; give it a moment to land. */
  const lastPush = async (hub) => {
    for (let attempt = 0; attempt < 50 && hub.published.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return hub.published.at(-1);
  };

  it('re-judges on a new snapshot and pushes the changed verdict', async () => {
    const hub = recordingHub();
    const stack = makeTestStack({ hub });

    await seedHistory(stack, { samples: steady(4), items: [itemDaysAgo(1)] });
    const first = await lastPush(hub);
    expect(first.dev).toBe(DEV);
    expect(first.data.freshness.items[0].status).toBe('fresh');
    expect(first.data.freshness.cabinet.condition).toBe('in_range');

    // A new snapshot inside the same window, with the cabinet out of limits.
    stack.clock.set(new Date(EVAL * 1000).toISOString());
    await stack.post(DEV, snapshotFixture({
      seq: 99,
      uptime: 5000,
      epoch: EVAL,
      full: false,
      readings: { temperature_c: 13.5 },
    })).expect(200);

    const second = await lastPush(hub);
    expect(second.data.device.seq).toBe(99);
    expect(second.data.freshness.cabinet.condition).toBe('critical');
    expect(second.data.freshness.items[0].status).toBe('check_food');
    expect(second.data.freshness.items[0].forced_by).toBe('cabinet_derived');
    // The pushed frame is the whole state, freshness included - no separate
    // request and no polling on the client.
    expect(second.data.freshness.computed_at).toBeTruthy();
    expect(second.data.freshness.disclaimer).toContain('not a food-safety certification');
  });

  it('pushes nothing for a replayed snapshot', async () => {
    const hub = recordingHub();
    const stack = makeTestStack({ hub });
    await seedHistory(stack, { samples: steady(4), items: [itemDaysAgo(1)] });
    const pushed = hub.published.length;

    await stack.post(DEV, snapshotFixture({ seq: 2, uptime: 5000, epoch: EVAL, full: false })).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hub.published.length).toBe(pushed);
  });
});

// ---------------------------------------------------------------------------

describe('the device\'s own per-item status', () => {
  it('is surfaced, labelled non-authoritative, and not used to compute anything', async () => {
    const stack = makeTestStack();
    // The device says check_food for an item whose dates and cabinet are both
    // fine. The engine's own verdict is fresh, and the device's guess is reported
    // beside it rather than deleted or adopted.
    await seedHistory(stack, {
      samples: steady(10),
      items: [itemDaysAgo(1, { status: 2 })],
      state: { zone_status: 0, overall_status: 2 },
    });

    const item = onlyItem(await getFreshness(stack));
    expect(item.device_provisional).toMatchObject({
      status_code: 2,
      label: 'check_food',
      source: 'device',
      authoritative: false,
    });
    expect(item.device_provisional.note).toContain('not authoritative');
    expect(item.device_provisional.basis).toContain('cabinet air');

    // The computed status is the engine's, and disagrees on purpose.
    expect(item.status).toBe('fresh');

    // And the device's verdict is still where it always was, unchanged.
    const inventory = (await stack.get(`/api/v1/devices/${DEV}/inventory`).expect(200)).body;
    expect(inventory.items[0].status).toEqual({ code: 2, label: 'check_food' });
  });

  it('reports a null device status as null rather than inventing a code', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(4), items: [itemDaysAgo(1)] });
    stack.db.prepare('UPDATE inventory_item SET status_code = NULL WHERE uid = ?').run('A1B2C3D4');

    const item = onlyItem(await getFreshness(stack));
    expect(item.device_provisional.status_code).toBeNull();
    expect(item.device_provisional.label).toBeNull();
  });
});

// ---------------------------------------------------------------------------

/** Every (path, key, value) and every string leaf, for the leak scan below. */
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

/**
 * Strip explicit denials so the "was a temperature measured" scan does not
 * fire on the sentences that exist precisely to say it was not.
 *
 * Without this the check would be worthless in the other direction: the honest
 * phrasing ("its own temperature was never measured") contains the same words as
 * the dishonest one, and a test that cannot tell them apart tests nothing.
 */
const unnegated = (text) => text.replace(
  /\b(?:not|never|no|cannot|can't|without|nor)\s+(?:be\s+|been\s+|being\s+)?(?:measured|determined|known|inferred|derived|established|available|captured)\b/gi,
  ' ',
);

/**
 * The per-item verdicts, wherever this particular endpoint puts them.
 *
 * Three shapes by design, and a test that only looked at one would miss a whole
 * endpoint: `/freshness` has them at the root, `/current` carries the whole
 * document under `freshness`, and `/inventory` attaches each verdict to its own
 * item and deliberately does NOT repeat them in the top-level block.
 */
const freshnessItemsOf = (document) => {
  // /current carries the whole document under `freshness`.
  if (Array.isArray(document.freshness?.items)) return document.freshness.items;
  // /inventory attaches each verdict to its own item, and its top-level
  // freshness block is the cabinet summary with no `items` of its own.
  if (Array.isArray(document.items) && document.items[0]?.freshness) {
    return document.items.map((item) => item.freshness);
  }
  // /freshness: the verdicts are the document.
  return Array.isArray(document.items) ? document.items : [];
};

describe('no item temperature claim can leak into the response', () => {
  /**
   * Every scenario that produces a status, so the scan sees a `fresh`, a
   * `use_soon`, a `check_food`, an `insufficient_data`, a good clock and a bad
   * one. A scan of one happy path proves very little.
   */
  const bodies = async () => {
    const documents = [];

    const inRange = makeTestStack();
    await seedHistory(inRange, { samples: steady(10), items: [itemDaysAgo(1)] });
    documents.push(await getFreshness(inRange));
    documents.push((await inRange.get(`/api/v1/devices/${DEV}/current`).expect(200)).body);
    documents.push((await inRange.get(`/api/v1/devices/${DEV}/inventory`).expect(200)).body);

    const hot = makeTestStack();
    await seedHistory(hot, { samples: steady(10, { temperature_c: 13.5 }), items: [itemDaysAgo(1, { status: 2 })] });
    documents.push(await getFreshness(hot));

    const soon = makeTestStack();
    await seedHistory(soon, { samples: steady(10, { temperature_c: 9 }), items: [itemDaysAgo(8)] });
    documents.push(await getFreshness(soon));

    const expired = makeTestStack();
    await seedHistory(expired, {
      samples: steady(10),
      items: [itemFixture({ store_date_epoch: EVAL - 10 * DAY, expiry_epoch: EVAL - 3 * DAY, duration_limit_days: 0 })],
    });
    documents.push(await getFreshness(expired));

    const blind = makeTestStack();
    await seedHistory(blind, { samples: steady(10, { temperature_c: null }), items: [itemDaysAgo(1)] });
    documents.push(await getFreshness(blind));

    const skewed = makeTestStack();
    await seedHistory(skewed, { samples: steady(10), items: [itemDaysAgo(1)], deviceEpoch: () => EVAL + 400 * DAY });
    documents.push(await getFreshness(skewed));

    return documents;
  };

  it('never marks an item temperature as measured, anywhere, in any document', async () => {
    for (const document of await bodies()) {
      const { entries } = walk(document);
      const flags = entries.filter((entry) => entry.key === 'item_temperature_measured');
      // The flag exists on every item, and is false on every one of them.
      expect(flags.length).toBeGreaterThan(0);
      for (const flag of flags) expect(flag.value).toBe(false);

      // No other key pairs an item with a temperature. `item_temperature_c`,
      // `item_temp_measured`, `measured_item_temperature` - any of those would be
      // the leak, whatever the value underneath.
      const suspicious = entries.filter(
        (entry) => entry.key !== 'item_temperature_measured'
          && /item/i.test(entry.key)
          && /temp/i.test(entry.key),
      );
      expect(suspicious.map((entry) => entry.path)).toEqual([]);
    }
  });

  it('never pairs an item with a temperature number in any string', async () => {
    for (const document of await bodies()) {
      const { strings } = walk(document);
      for (const { path, value } of strings) {
        // "this item is at 7 degrees C", "Tomatoes: 4.2 degC", "item temperature 12 C".
        expect(value, `item temperature claim at ${path}`).not.toMatch(
          /\bitem\b[^.]{0,60}?-?\d+(?:\.\d+)?\s*(?:°|deg\b|degrees?\s*c\b|celsius)/i,
        );
        // A claim that an item's temperature WAS measured. Tested against the
        // text with negations removed, so the honest "was never measured" and
        // "is not measured" sentences pass and only a real assertion fails.
        expect(unnegated(value), `item measurement claim at ${path}`).not.toMatch(
          /item[^.]{0,60}?\btemperature\b[^.]{0,30}?\b(?:is|was|are|were)\s+(?:measured|known|read|determined|at)\b/i,
        );
      }
    }
  });

  it('reports gas only as millivolts, with no concentration field anywhere', async () => {
    for (const document of await bodies()) {
      const { entries } = walk(document);
      const concentrationKeys = entries.filter((entry) => /ppm|parts_per_million|concentration|co2|vol_?frac/i.test(entry.key));
      expect(concentrationKeys.map((entry) => entry.path)).toEqual([]);
      const { strings } = walk(document);
      for (const { path, value } of strings) {
        expect(value, `gas concentration at ${path}`).not.toMatch(/\d+(?:\.\d+)?\s*(?:ppm|ppb)\b/i);
      }
    }
  });

  it('carries both evidence blocks, and the attribution, on every item', async () => {
    for (const document of await bodies()) {
      const items = freshnessItemsOf(document);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.item_temperature_measured).toBe(false);
        expect(item.evidence).toHaveProperty('date_derived');
        expect(item.evidence).toHaveProperty('cabinet_derived');

        // Layer 1 attributes itself as the date layer and names its field.
        expect(item.evidence.date_derived).toHaveProperty('driving_field');
        expect(item.evidence.date_derived).toHaveProperty('driving_rule');
        expect(item.evidence.date_derived.reason).toBeTruthy();

        // Layer 2 says what it measured, that it applies, and why it is not an
        // item measurement.
        expect(item.evidence.cabinet_derived.applies).toBe(true);
        expect(item.evidence.cabinet_derived.measured).toBe('cabinet_air');
        expect(item.evidence.cabinet_derived.reason).toBeTruthy();
        expect(item.evidence.cabinet_derived.attribution).toContain('Inferred from cabinet air');
        expect(item.evidence.cabinet_derived.attribution).toContain('own temperature was never measured');
        expect(item.evidence.cabinet_derived.attribution).toContain('mass, packaging, position and airflow');

        // The device's own guess is always present, even when it is null.
        expect(item).toHaveProperty('device_provisional');
        expect(item.device_provisional.authoritative).toBe(false);
      }
    }
  });

  it('disclaims certification on the document itself', async () => {
    for (const document of await bodies()) {
      // `/freshness` carries it at the root; `/current` and `/inventory` carry it
      // inside the additive freshness block. Either way it travels with the
      // verdict - it is not something a consumer has to go and look up.
      expect(document.disclaimer ?? document.freshness.disclaimer).toContain('not a food-safety certification');
      expect(document.disclaimer ?? document.freshness.disclaimer).toContain('does not determine food safety');
    }
  });
});

// ---------------------------------------------------------------------------

describe('additive, not breaking', () => {
  it('adds freshness to /inventory without altering the fields that were already there', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(10), items: [itemDaysAgo(1, { status: 0 })] });

    const body = (await stack.get(`/api/v1/devices/${DEV}/inventory`).expect(200)).body;
    const item = body.items[0];

    // The exact pre-existing item key set, plus the one addition. Anything else
    // appearing here is a change a consumer could trip over.
    expect(Object.keys(item).sort()).toEqual([
      'category', 'derived', 'duration_limit_days', 'expiry', 'expiry_epoch', 'freshness',
      'location', 'manufacture', 'manufacture_epoch', 'name', 'quantity', 'revisions',
      'status', 'store_date', 'store_date_epoch', 'uid',
    ]);

    // Untouched values.
    expect(item.status).toEqual({ code: 0, label: 'fresh' });
    expect(item.derived.deadline_source).toBe('duration');
    expect(item.derived.progress_percent).toBe(10);
    expect(item.revisions).toEqual({ first: 1, last: 1, retired: false, retired_at_revision: null });

    // The addition.
    expect(item.freshness.status).toBe('fresh');
    expect(item.freshness.item_temperature_measured).toBe(false);

    // And the cabinet-level half at the top of the response.
    expect(body.freshness.cabinet.condition).toBe('in_range');
    expect(body.freshness.counts).toEqual({ fresh: 1, use_soon: 0, check_food: 0, insufficient_data: 0 });
    expect(body.freshness.thresholds.source).toBe('built_in_assumption');
  });

  it('adds freshness to /current without altering the fields that were already there', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(10), items: [itemDaysAgo(1)] });

    const body = (await stack.get(`/api/v1/devices/${DEV}/current`).expect(200)).body;
    expect(Object.keys(body).sort()).toEqual(['alerts', 'counts', 'device', 'freshness', 'inventory', 'readings', 'transport']);
    expect(body.device.dev).toBe(DEV);
    expect(body.readings.temperature_c).toBe(4.2);
    expect(body.inventory[0].uid).toBe('A1B2C3D4');
    expect(body.counts.inventory_active).toBe(1);
    expect(body.freshness.cabinet.condition).toBe('in_range');
  });

  it('adds the two layers to the CSV export alongside the existing columns', async () => {
    const stack = makeTestStack();
    await seedHistory(stack, { samples: steady(10), items: [itemDaysAgo(1, { status: 1 })] });

    const response = await stack.get(`/api/v1/devices/${DEV}/inventory/export.csv`).expect(200);
    const [header, row] = response.text.trim().split('\n');
    expect(header).toContain('deadline_source');
    expect(header).toContain('progress_percent');
    expect(header).toContain('freshness_status');
    expect(header).toContain('date_status');
    expect(header).toContain('cabinet_condition');
    expect(header).toContain('item_temperature_measured');
    expect(row).toContain('fresh');
    // The device's own status column is still there and still says what it said.
    expect(header).toContain('status_code,status,');
  });
});
