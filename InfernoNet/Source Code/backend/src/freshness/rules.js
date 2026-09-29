/**
 * Freshness engine, part 1 of 2: the RULES.
 *
 * Pure. No database, no clock of its own, no config, no process. Every value
 * below is a function of the arguments handed in, so the copy of the rule and
 * the copy of the data that was judged by it cannot drift apart, and each rule
 * can be tested on its own.
 *
 * `service.js` is the only thing that talks to the datastore; it does the
 * reading and calls in here to decide.
 *
 * ===========================================================================
 * THE CONSTRAINT THAT SHAPES THIS ENTIRE FILE
 * ===========================================================================
 *
 * FreshGuard has ONE temperature sensor, ONE humidity sensor, ONE MQ-135 and
 * ONE door reed, and every one of them measures CABINET AIR - the air inside
 * the storage zone. None of them can measure an individual item.
 *
 * An item's own temperature is a function of its mass, its packaging, where it
 * sits in the cabinet and the airflow past it. A 2 kg block of frozen fish and
 * a thin tray of the same food in the same cabinet, one metre apart, can differ
 * by many degrees at the same instant. "This item is at 7 degrees C" is
 * therefore not a measurable claim with this hardware, and no function in this
 * file produces one. There is no per-item exposure verdict here, and there must
 * never be one: that model was considered and rejected.
 *
 * What the hardware CAN support is a CABINET metric that every item in the
 * cabinet references. That is what layer 2 is. An item never contributes a
 * measurement to it and never receives one as its own.
 *
 * SRS grounding:
 *   1.6 (ii)  the temperature/humidity sensor measures "within the monitored
 *             storage area" - the area, not the item.
 *   1.5       "accuracy depends on sensor calibration, placement, food type,
 *             and proper food handling" - i.e. the item-level variables above.
 *
 * ===========================================================================
 * THE TWO LAYERS, AND WHY THEY ARE NEVER MIXED
 * ===========================================================================
 *
 *   Layer 1, `date_derived`    CERTAIN.  Arithmetic on the item's own
 *                              store_date_epoch / expiry_epoch /
 *                              duration_limit_days. No sensor is involved, so
 *                              no sensor can be wrong about it. It is
 *                              independent of the cabinet entirely.
 *
 *   Layer 2, `cabinet_derived` MEASURED.  Readings from the cabinet, judged
 *                              against the configured threshold_profile for
 *                              scope 'zone'. It is true OF THE CABINET and is
 *                              only ever presented as an inference about an
 *                              item, with that inference spelled out.
 *
 * They are computed independently and reported in separate blocks. Neither is
 * allowed to overwrite the other, and the blended status at the end names which
 * layer forced it.
 *
 * ===========================================================================
 * SRS CITATION CONVENTION
 * ===========================================================================
 *
 * Citations below are `SRS <section> p<page>` plus the quoted phrase, because a
 * bare line number into a PDF is not verifiable by anyone reading this file six
 * months from now. Where the product owner cites a line number, it is kept
 * verbatim alongside the section reference.
 *
 *   SRS 1.4   p8  (owner-cited L273) "FreshGuard does not determine food safety
 *                 or certify whether food is safe for consumption."
 *   SRS 1.5   p9  "accuracy depends on sensor calibration, placement, food
 *                 type, and proper food handling"
 *   SRS 1.6 (ii) p9  sensor measures "within the monitored storage area"
 *   SRS 1.6 (iv) p9  "Gas readings alone should not be used to confirm food
 *                      spoilage"; abnormal readings "beyond configured
 *                      thresholds should generate an alert"
 *   SRS 1.6 (v)  p10 "Teams should not report calibrated gas concentration or
 *                      ppm values unless suitable calibration has been
 *                      performed"; the MQ-135 must warm up and stabilise
 *                      "before baseline readings are recorded"
 *   SRS 1.6 (vii) p10 "should not display a misleading Fresh or Normal status
 *                      when a sensor or input fault is detected"; "continue
 *                      safe operation using the remaining valid inputs where
 *                      possible"
 *   SRS 1.6 (x)  p11 "Where one MQ-135 sensor monitors a shared storage zone,
 *                      the gas reading should not be attributed to any
 *                      specific food item"; unsourced values must be identified
 *                      as "controlled prototype/demo assumptions" and
 *                      "should not [be] presented as certified food-safety
 *                      standards"
 *   SRS 1.6 (xi) p11 Fresh/Normal, Use Soon, Check Food
 *   SRS 1.6 (xvi) p12 "Sensor Fault/Data Unavailable" instead of "a misleading
 *                      Fresh/Normal indication"
 */

const DAY_SECONDS = 86_400;

/** The four cabinet conditions the engine can report. */
export const CABINET_CONDITIONS = Object.freeze(['in_range', 'warning', 'critical', 'insufficient_data']);

/** Layer 1 outcomes. `expired` has no blended counterpart - it becomes check_food. */
export const DATE_STATUSES = Object.freeze(['fresh', 'use_soon', 'expired', 'insufficient_data']);

/** The four blended per-item statuses the owner specified. */
export const ITEM_STATUSES = Object.freeze(['fresh', 'use_soon', 'check_food', 'insufficient_data']);

/**
 * Severity ladder. `no_data` is ranked below `in_range` on purpose: a sample
 * that carries no value must never make a channel look worse than one that
 * carried a good value. Absence of evidence is not evidence of a breach, and
 * it is handled as `insufficient_data` rather than escalated to a breach.
 */
const SEVERITY_RANK = { no_data: -1, in_range: 0, warning: 1, critical: 2 };

const worst = (...severities) =>
  severities.reduce(
    (worstSoFar, severity) => (SEVERITY_RANK[severity] > SEVERITY_RANK[worstSoFar] ? severity : worstSoFar),
    'in_range',
  );

const round = (value, places) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * The limits the backend falls back to when no zone profile is configured.
 *
 * These are NOT cited food-safety limits and are never presented as such: they
 * are the same prototype band the firmware compiles in, and they are labelled
 * `built_in_assumption` in the response so a dashboard can keep telling a cited
 * limit from a bench default. SRS 1.6 (x) p11 requires exactly that
 * distinction, and migration 002's `source` column exists to carry it.
 */
export const BUILT_IN_THRESHOLDS = Object.freeze({
  temperature_min_c: 0,
  temperature_max_c: 8,
  humidity_min_pct: 30,
  humidity_max_pct: 85,
  gas_delta_abnormal_mv: 50,
  gas_delta_clear_mv: 40,
  use_soon_percent: 75,
});

/**
 * How far past a configured limit a reading may sit before the cabinet is
 * `critical` rather than `warning`.
 *
 * A configured band has exactly two edges, so it can only distinguish "inside"
 * from "outside". `warning` is a THIRD state, and it needs a magnitude to exist
 * at all, so the engine states that magnitude here rather than burying it in an
 * arithmetic expression. It is surfaced verbatim in
 * `cabinet.evidence.severity_rules` with its own `source`, so a reader can see
 * that these are the backend's assumptions and not operator-cited numbers.
 *
 * Gas is deliberately absent. `gas_delta_abnormal_mv` is not a band edge, it is
 * the level at which the operator declared gas abnormal - crossing it is
 * already the configured alarm crossing, so downgrading it to a warning would
 * soften a limit somebody deliberately set. It goes straight to `critical`.
 */
export const SEVERITY_MARGINS = Object.freeze({
  temperature_c: 2.0,
  humidity_pct: 10.0,
});

/**
 * The plain-words attribution carried on every single item result. SRS 1.6 (x)
 * p11 forbids attributing the reading to a specific item; this sentence is where
 * that prohibition becomes visible in the API rather than living only in a
 * comment.
 */
export const CABINET_ATTRIBUTION =
  'Inferred from cabinet air, not measured on this item. The temperature, humidity and gas sensors sit '
  + 'inside the storage cabinet and measure its air. This item shares that air with everything else in '
  + 'the cabinet, but its own temperature was never measured and cannot be with this hardware - it depends '
  + "on the item's mass, packaging, position and airflow. Treat this as the cabinet the item is in, not as "
  + 'a measurement of the item.';

/** The gas-specific note. SRS 1.6 (x) p11, in full. */
export const GAS_ATTRIBUTION =
  'The MQ-135 is a single sensor reading the air of the whole storage zone. This is a cabinet-air aggregate '
  + 'and cannot be attributed to any specific food item. It is reported in millivolts only: the sensor has '
  + 'not been calibrated against a reference gas, so no concentration in ppm (or any other gas quantity) is '
  + 'derived or reported, and gas readings alone do not confirm spoilage.';

/** SRS 1.4 p8 (owner-cited L273). Carried on every response. */
export const DISCLAIMER =
  "This is a storage-condition estimate derived from cabinet air sensors and the item's own dates. It is "
  + 'not a food-safety certification and does not determine whether food is safe to consume. FreshGuard '
  + 'does not determine food safety or certify whether food is safe for consumption (SRS 1.4). Follow '
  + 'applicable storage guidance, product labels and normal food-safety practice alongside it, and inspect '
  + 'food before use.';

/**
 * The channels the engine reads, and how each one is bounded.
 *
 * `outside(value, limits)` is a predicate rather than a comparison so the
 * inclusive/exclusive choice is made once, here, and is obvious:
 *
 *   - `temperature_min_c` / `temperature_max_c` / `humidity_*` are named as the
 *     LIMITS of an acceptable range, so the band is closed: exactly 8.0 °C is
 *     inside a 0..8 band. Breaching requires going past it.
 *   - `gas_delta_abnormal_mv` is named ABNORMAL, not "maximum". Reaching the
 *     configured abnormal level IS the abnormal condition, so the comparison is
 *     inclusive.
 *
 * `margin: null` means "this channel has no warning tier" - see SEVERITY_MARGINS.
 */
export const CHANNELS = Object.freeze([
  {
    key: 'temperature_c',
    label: 'cabinet air temperature',
    unit: 'degC',
    margin: SEVERITY_MARGINS.temperature_c,
    limits: (t) => ({ min: t.temperature_min_c ?? null, max: t.temperature_max_c ?? null }),
    outside: (value, limits) => (limits.max !== null && value > limits.max) || (limits.min !== null && value < limits.min),
  },
  {
    key: 'humidity_pct',
    label: 'cabinet air humidity',
    unit: 'pct_rh',
    margin: SEVERITY_MARGINS.humidity_pct,
    limits: (t) => ({ min: t.humidity_min_pct ?? null, max: t.humidity_max_pct ?? null }),
    outside: (value, limits) => (limits.max !== null && value > limits.max) || (limits.min !== null && value < limits.min),
  },
  {
    key: 'gas_delta_mv',
    label: 'MQ-135 gas delta',
    unit: 'mV',
    margin: null,
    limits: (t) => ({ min: null, max: t.gas_delta_abnormal_mv ?? null }),
    outside: (value, limits) => limits.max !== null && value >= limits.max,
  },
]);

/** Reported, aggregated, and explicitly NOT judged: no configured limit exists for these. */
export const OBSERVED_ONLY = Object.freeze([
  { key: 'gas_input_mv', label: 'MQ-135 raw input', unit: 'mV' },
  { key: 'pressure_hpa', label: 'cabinet air pressure', unit: 'hPa' },
]);

// ---------------------------------------------------------------------------
// Layer 2: the cabinet
// ---------------------------------------------------------------------------

/**
 * Grade one sample against one channel. Pure.
 *
 * Returns the edge that was crossed as well as the severity, so the reason
 * string can name "above the configured maximum" rather than guessing which
 * side of the band was responsible.
 */
function gradeSample(channel, value, limits) {
  if (value === null || value === undefined) return { severity: 'no_data', deviation: null, edge: null };

  if (limits.max !== null && channel.outside(value, { ...limits, min: null })) {
    return { severity: gradeDeviation(channel, value - limits.max), deviation: value - limits.max, edge: 'max' };
  }
  if (limits.min !== null && channel.outside(value, { ...limits, max: null })) {
    return { severity: gradeDeviation(channel, limits.min - value), deviation: limits.min - value, edge: 'min' };
  }
  return { severity: 'in_range', deviation: 0, edge: null };
}

const gradeDeviation = (channel, deviation) =>
  (channel.margin === null || deviation > channel.margin ? 'critical' : 'warning');

/**
 * Minutes a channel spent outside its band, over the observed intervals only.
 *
 * Zero-order hold: the interval between two consecutive samples is attributed to
 * the earlier one. This is the only accounting that invents nothing - every
 * second counted is bracketed by two real measurements.
 *
 * The interval from the newest sample to now is deliberately NOT added. No
 * measurement brackets it, so counting it would turn "the last thing we knew was
 * out of range" into "N further minutes were out of range", which is the
 * confidently-wrong shape this engine exists to avoid. The unobserved gap is
 * reported separately as `unobserved_after_seconds` so a caller can see it
 * without it being laundered into exposure.
 */
function exposureSeconds(samples, outOfBand) {
  let seconds = 0;
  for (let index = 0; index < samples.length - 1; index += 1) {
    if (outOfBand[index]) seconds += Math.max(0, samples[index + 1].t - samples[index].t);
  }
  return seconds;
}

/**
 * One channel's verdict: statistics, severity, exposure, and the reason in
 * words. Pure.
 *
 * `samples` is `[{ t: epochSeconds, v: number|null }]` in ascending time order.
 */
function evaluateChannel({ channel, samples, limits, unobservedAfterSeconds }) {
  const values = samples.filter((sample) => sample.v !== null && sample.v !== undefined).map((sample) => sample.v);

  if (values.length === 0) {
    return {
      channel: channel.key,
      label: channel.label,
      unit: channel.unit,
      limits,
      measured: false,
      severity: 'no_data',
      samples: 0,
      min: null,
      max: null,
      avg: null,
      out_of_band_samples: 0,
      worst_deviation: null,
      minutes_out_of_range: 0,
      exposure_basis: 'no_samples',
      last_sample_at: null,
      unobserved_after_seconds: null,
      reason: `no ${channel.label} sample was recorded in the window`,
    };
  }

  const graded = samples.map((sample) => gradeSample(channel, sample.v, limits));
  const outOfBand = graded.map((entry) => entry.severity === 'warning' || entry.severity === 'critical');
  const worstEntry = graded.reduce(
    (peak, entry) => ((entry.deviation ?? 0) > (peak?.deviation ?? -1) ? entry : peak),
    null,
  );
  const lastSample = samples[samples.length - 1].t;

  return {
    channel: channel.key,
    label: channel.label,
    unit: channel.unit,
    limits,
    measured: true,
    severity: worst(...graded.map((entry) => entry.severity)),
    samples: values.length,
    min: round(Math.min(...values), 3),
    max: round(Math.max(...values), 3),
    avg: round(values.reduce((total, value) => total + value, 0) / values.length, 3),
    out_of_band_samples: outOfBand.filter(Boolean).length,
    worst_deviation: round(worstEntry?.deviation ?? 0, 3),
    minutes_out_of_range: round(exposureSeconds(samples, outOfBand) / 60, 1),
    exposure_basis: 'observed_intervals',
    last_sample_at: new Date(lastSample * 1000).toISOString(),
    unobserved_after_seconds: unobservedAfterSeconds,
    reason: channelReason({ channel, limits, entry: worstEntry }),
  };
}

function channelReason({ channel, limits, entry }) {
  if (entry === null || entry.severity === 'in_range') {
    const edges = [
      limits.min !== null ? `at or above ${limits.min}` : null,
      limits.max !== null ? `at or below ${limits.max}` : null,
    ].filter(Boolean);
    return `${channel.label} stayed within its configured limit(s) (${edges.join(' and ')} ${channel.unit})`;
  }
  const edge = entry.edge === 'max'
    ? `above the configured maximum of ${limits.max} ${channel.unit}`
    : `below the configured minimum of ${limits.min} ${channel.unit}`;
  return `${channel.label} reached ${entry.deviation} ${channel.unit} ${edge}`;
}

/** Statistics only, for a channel that is reported but never judged. */
function observedStats(samples) {
  const values = samples.filter((sample) => sample.v !== null && sample.v !== undefined).map((sample) => sample.v);
  if (values.length === 0) return { samples: 0, min: null, max: null, avg: null };
  return {
    samples: values.length,
    min: round(Math.min(...values), 3),
    max: round(Math.max(...values), 3),
    avg: round(values.reduce((total, value) => total + value, 0) / values.length, 3),
  };
}

/**
 * Layer 2: the cabinet condition over the window.
 *
 * Pure. `readings` is `[{ t, temperature_c, humidity_pct, pressure_hpa,
 * gas_input_mv, gas_delta_mv }]` in ascending time order, with `t` in epoch
 * seconds taken from `reading.recorded_at` - SERVER RECEIPT TIME.
 *
 * That choice is load-bearing. The exposure window is built from when this
 * service received the sample, not from the device's own clock, so a cabinet
 * whose device RTC is wrong still gets a measured, trustworthy exposure figure.
 * The two layers degrade independently for exactly this reason.
 *
 * `gasUsable: false` excludes the MQ-135 channel from severity. It is set when
 * the device reports the gas path as still warming up or baselining, which SRS
 * 1.6 (v) p10 requires before any baseline is recorded. A sample from a sensor
 * the device itself says is not ready is not a valid cabinet measurement, and
 * grading it anyway would be exactly the confidently-wrong failure. This is the
 * ONE piece of device state the engine reads, and it is a statement about the
 * validity of the measurement rather than a verdict. The excluded channel is
 * still reported, with its samples, under `missing_inputs`.
 */
export function evaluateCabinet({ readings, thresholds, nowEpoch, windowMinutes, gasUsable = true, gasState = null, door = null }) {
  const first = readings.length > 0 ? readings[0].t : nowEpoch;
  const last = readings.length > 0 ? readings[readings.length - 1].t : nowEpoch;
  // Only a gap that is itself inside the window is meaningful to report; a
  // reading older than the window cannot happen (the caller filters), but a
  // device that has gone quiet inside the window is exactly the case a caller
  // needs to see.
  const unobservedAfterSeconds = readings.length > 0 ? Math.max(0, nowEpoch - last) : null;

  const perMeasurement = {};
  /** Channels the operator cleared: reported, not judged, and not blocking. */
  const inactiveChannels = [];
  /** Channels that should have been judged and could not be. Blocks `in_range`. */
  const missingInputs = [];
  const activeChannels = [];
  const severities = [];
  let minutesOutOfRange = 0;

  for (const channel of CHANNELS) {
    const limits = channel.limits(thresholds);
    const samples = readings.map((reading) => ({ t: reading.t, v: reading[channel.key] }));
    const configured = limits.min !== null || limits.max !== null;

    if (!configured) {
      // A null limit means the operator explicitly cleared it. That is not a
      // missing input - it is a channel nobody asked about - so it is reported
      // separately and never blocks a verdict.
      perMeasurement[channel.key] = {
        channel: channel.key,
        label: channel.label,
        unit: channel.unit,
        limits,
        measured: samples.some((sample) => sample.v !== null && sample.v !== undefined),
        severity: 'not_evaluated',
        reason: `no ${channel.label} limit is configured; observed and reported, not judged`,
      };
      inactiveChannels.push({ channel: channel.key, reason: 'no_configured_limit' });
      continue;
    }

    // Counted as active BEFORE the gas exclusion below, because it is. A
    // configured channel that produced no usable measurement is exactly the
    // situation in which the engine must not claim the cabinet is in range, so
    // it has to appear in the denominator of `coverage`.
    activeChannels.push(channel.key);

    if (channel.key === 'gas_delta_mv' && !gasUsable) {
      perMeasurement[channel.key] = {
        channel: channel.key,
        label: channel.label,
        unit: channel.unit,
        limits,
        measured: false,
        severity: 'excluded',
        ...observedStats(samples),
        reason: `the MQ-135 was reported as '${gasState}' and has not produced a valid baseline yet `
          + '(SRS 1.6 (v)); its samples are reported but not judged',
      };
      missingInputs.push({ channel: channel.key, reason: 'mq135_not_ready' });
      continue;
    }

    const result = evaluateChannel({ channel, samples, limits, unobservedAfterSeconds });
    perMeasurement[channel.key] = result;
    if (!result.measured) missingInputs.push({ channel: channel.key, reason: 'no_samples_in_window' });
    else {
      severities.push(result.severity);
      minutesOutOfRange += result.minutes_out_of_range;
    }
  }

  // Reported, aggregated, never judged: no configured limit exists for these.
  const observed = {};
  for (const entry of OBSERVED_ONLY) {
    observed[entry.key] = {
      label: entry.label,
      unit: entry.unit,
      ...observedStats(readings.map((reading) => ({ t: reading.t, v: reading[entry.key] }))),
    };
  }

  const judged = severities.length;
  const coverage = judged === 0 ? 'none' : judged === activeChannels.length ? 'complete' : 'partial';

  let condition;
  let reason;
  if (judged === 0) {
    condition = 'insufficient_data';
    reason = activeChannels.length === 0
      ? 'no cabinet limit is configured, so the cabinet condition cannot be computed'
      : 'no cabinet measurement was recorded in the window, so the cabinet condition cannot be computed';
  } else if (coverage !== 'complete') {
    // "In range" is a claim that EVERYTHING is fine. If a channel that would
    // have been needed to support that claim produced nothing, the engine cannot
    // make it, and says so. The reverse never happens: a channel that DID report
    // out-of-band still escalates below, because missing data must not be able
    // to hide a detected problem.
    condition = 'insufficient_data';
    reason = 'the cabinet was only partially measured in the window, so it cannot be reported as within limits';
  } else {
    condition = worst(...severities);
    reason = cabinetReason({ condition, perMeasurement });
  }

  return {
    condition,
    reason,
    source: 'cabinet_measured',
    evidence: {
      window: {
        // `to` is the instant the judgement was made, `requested_to` the same
        // thing as an explicit bound. `from`/`to` below are the first and last
        // readings actually seen, which is what a reader wants when the sample
        // count is smaller than the window implies.
        minutes: windowMinutes ?? null,
        from_epoch: first,
        to_epoch: last,
        from: new Date(first * 1000).toISOString(),
        to: new Date(last * 1000).toISOString(),
        requested_to: new Date(nowEpoch * 1000).toISOString(),
        samples: readings.length,
        time_base: 'server receipt time (reading.recorded_at), not the device clock',
      },
      per_measurement: perMeasurement,
      observed_only: observed,
      minutes_out_of_range: round(minutesOutOfRange, 1),
      coverage,
      active_channels: activeChannels,
      missing_inputs: missingInputs,
      inactive_channels: inactiveChannels,
      unobserved_after_seconds: unobservedAfterSeconds,
      last_sample_at: readings.length > 0 ? new Date(last * 1000).toISOString() : null,
      door: doorEvidence(door),
      gas: {
        unit: 'mV',
        state: gasState,
        judged: gasUsable,
        abnormal_threshold_mv: thresholds.gas_delta_abnormal_mv ?? null,
        clear_below_mv: thresholds.gas_delta_clear_mv ?? null,
        at_or_above_abnormal: atOrAboveAbnormal(readings, thresholds),
        note: GAS_ATTRIBUTION,
      },
      severity_rules: {
        source: 'built_in_assumption',
        note:
          'a configured band has two edges, so a third "warning" state needs a stated magnitude. A reading '
          + 'further than the margin past a limit is `critical`; at or inside the margin it is `warning`. '
          + 'The MQ-135 has no warning tier: reaching the configured abnormal threshold is already the '
          + "configured alarm, so it goes straight to `critical`. These margins are the backend's own "
          + 'assumptions, not operator-cited limits (SRS 1.6 (x)).',
        margins: { ...SEVERITY_MARGINS },
        gas_crossing: 'critical at or above the configured abnormal threshold (inclusive)',
      },
    },
  };
}

function atOrAboveAbnormal(readings, thresholds) {
  const abnormal = thresholds.gas_delta_abnormal_mv;
  if (abnormal === null || abnormal === undefined) return false;
  return readings.some(
    (reading) => typeof reading.gas_delta_mv === 'number' && reading.gas_delta_mv >= abnormal,
  );
}

function cabinetReason({ condition, perMeasurement }) {
  if (condition === 'in_range') {
    return 'every judged cabinet channel stayed within its configured limit for the whole window';
  }
  const problems = CHANNELS
    .map((channel) => perMeasurement[channel.key])
    .filter((entry) => entry && (entry.severity === 'warning' || entry.severity === 'critical'));
  return `cabinet air left its configured limits: ${problems.map((entry) => entry.reason).join('; ')}`;
}

function doorEvidence(door) {
  if (!door) return { known: false, note: 'the door input was not evaluated' };
  return {
    known: Boolean(door.known),
    // A stale reed is an unknown door, never a closed-and-fine door. The null is
    // the point: `open: false` here would assert something the input cannot
    // support.
    open: door.stale ? null : Boolean(door.open),
    stale: Boolean(door.stale),
    timeout_ms: door.timeout_ms ?? null,
    measured: 'cabinet door (reed switch)',
    note: door.stale
      ? 'the reed switch is not reporting, so the door state is unknown; an unknown door is never reported as closed and fine'
      : 'the reed switch measures the cabinet door. An open door is reported as evidence but is not itself a cabinet condition: it changes the cabinet air, and the air readings already show that.',
  };
}

// ---------------------------------------------------------------------------
// Clock trust
// ---------------------------------------------------------------------------

/**
 * Is the device clock good enough to judge dates against?
 *
 * This is the single most likely way a feature like this produces a confident
 * wrong answer. The device owns item timestamps, so a device RTC sitting at a
 * test epoch while the server is at real time will confidently report that a
 * jar of jam stored three years ago was stored an hour ago. Nothing about that
 * output looks wrong, which is what makes it dangerous.
 *
 * So the clock is judged against the server, and a bad one degrades the DATE
 * layer only. The cabinet layer is untouched, because its window is built from
 * server receipt time. A response therefore never says "untrustworthy" without
 * also saying which half of itself is still good.
 *
 * Pure. `maxSkewSeconds` is the tolerance; 0 means "any disagreement at all".
 */
export function evaluateClock({ timeValid, reportedAtEpoch, nowEpoch, maxSkewSeconds }) {
  const reasons = [];
  if (!timeValid) reasons.push('device_time_invalid');
  if (reportedAtEpoch === null || reportedAtEpoch === undefined) reasons.push('device_reported_at_absent');

  const skewSeconds = reportedAtEpoch === null || reportedAtEpoch === undefined
    ? null
    : Math.abs(reportedAtEpoch - nowEpoch);
  if (skewSeconds !== null && skewSeconds > maxSkewSeconds) reasons.push('device_clock_skew_exceeds_max');

  const trusted = reasons.length === 0;
  return {
    trusted,
    device_time_valid: Boolean(timeValid),
    device_reported_at: reportedAtEpoch === null || reportedAtEpoch === undefined
      ? null
      : new Date(reportedAtEpoch * 1000).toISOString(),
    server_time: new Date(nowEpoch * 1000).toISOString(),
    skew_seconds: skewSeconds,
    max_skew_seconds: maxSkewSeconds,
    reasons,
    untrustworthy_layers: trusted ? [] : ['date_derived'],
    trustworthy_layers: trusted ? ['date_derived', 'cabinet_derived'] : ['cabinet_derived'],
    note: trusted
      ? 'the device clock is within tolerance of server time, so item dates are evaluated against it'
      : `the device clock is not trusted (${reasons.join(', ')}), so every day count and duration verdict is `
        + 'withheld. The cabinet layer is unaffected: it is measured from server receipt times, not from the '
        + 'device clock.',
  };
}

// ---------------------------------------------------------------------------
// Layer 1: the item's own dates
// ---------------------------------------------------------------------------

/**
 * Layer 1: `fresh` / `use_soon` / `expired` from the item's own fields.
 *
 * Certain and sensor-free. The only inputs are the three values the device
 * registered, so there is nothing here for a misbehaving sensor to corrupt -
 * which is exactly why a date verdict is still reported when the cabinet layer
 * is unavailable.
 *
 * Precedence matches the firmware: a non-zero `expiry_epoch` outranks
 * `duration_limit_days`. The evidence names which field decided it, because
 * "use soon" means something different for a dated item than for a
 * duration-limited one, and an operator reading a flag needs to know which.
 *
 * Pure.
 */
export function evaluateItemDates({ item, nowEpoch, clockTrusted, useSoonPercent }) {
  const storeDate = item.store_date_epoch ?? 0;
  const expiry = item.expiry_epoch ?? 0;
  const durationDays = item.duration_limit_days ?? 0;

  const drivingField = expiry > 0 ? 'expiry_epoch' : durationDays > 0 ? 'duration_limit_days' : null;
  const windowSeconds = drivingField === 'expiry_epoch'
    ? expiry - storeDate
    : drivingField === 'duration_limit_days'
      ? durationDays * DAY_SECONDS
      : 0;
  const deadlineEpoch = drivingField === 'expiry_epoch'
    ? expiry
    : drivingField === 'duration_limit_days'
      ? storeDate + windowSeconds
      : null;

  const base = {
    driving_field: drivingField,
    driving_rule: drivingField === 'expiry_epoch'
      ? 'expiry_epoch outranks duration_limit_days, as on the device'
      : drivingField === 'duration_limit_days'
        ? 'no expiry epoch was registered, so the configured duration limit applies'
        : 'neither an expiry epoch nor a duration limit was registered',
    store_date_epoch: storeDate,
    store_date: storeDate > 0 ? new Date(storeDate * 1000).toISOString() : null,
    expiry_epoch: expiry > 0 ? expiry : null,
    duration_limit_days: durationDays > 0 ? durationDays : null,
    deadline_epoch: deadlineEpoch,
    deadline: deadlineEpoch === null ? null : new Date(deadlineEpoch * 1000).toISOString(),
    window_seconds: Math.max(0, windowSeconds),
    use_soon_percent: useSoonPercent,
    clock_trusted: Boolean(clockTrusted),
  };

  const withheld = (reason, note) => ({
    ...base,
    status: 'insufficient_data',
    progress_percent: null,
    days_remaining: null,
    days_overdue: null,
    reason,
    note,
  });

  if (drivingField === null || windowSeconds <= 0) {
    return withheld(
      drivingField === null
        ? 'the device registered neither an expiry epoch nor a duration limit, so there is no date to judge'
        : 'the registered storage window is zero-length, so there is no date to judge',
      'no date verdict is possible; this is a registration gap, not a freshness finding',
    );
  }

  if (!clockTrusted) {
    // The deadline is still shown: it is arithmetic on the item's own epochs and
    // depends on no clock. Everything that would need "now" is withheld, because
    // that is exactly the part a bad device RTC corrupts.
    return withheld(
      'the device clock is not trusted, so no day count can be produced',
      'the registered deadline is reported as stored; days remaining and days overdue are withheld rather than computed from a bad clock',
    );
  }

  if (storeDate > 0 && nowEpoch < storeDate) {
    return withheld(
      'the registered store date is later than the current time, so the elapsed period cannot be computed',
      'a store date in the future is a clock or registration problem; counting days from it would produce a confident and meaningless number',
    );
  }

  const remainingSeconds = deadlineEpoch - nowEpoch;
  const elapsedSeconds = Math.max(0, nowEpoch - storeDate);
  const progressPercent = round(Math.min(1, elapsedSeconds / windowSeconds) * 100, 1);

  let status;
  let reason;
  if (remainingSeconds <= 0) {
    status = 'expired';
    reason = `the registered deadline passed ${Math.abs(round(remainingSeconds / DAY_SECONDS, 1))} day(s) ago`;
  } else if (progressPercent >= useSoonPercent) {
    status = 'use_soon';
    reason = `${progressPercent}% of the registered storage window has elapsed, at or past the configured ${useSoonPercent}% use-soon point`;
  } else {
    status = 'fresh';
    reason = `${progressPercent}% of the registered storage window has elapsed, below the configured ${useSoonPercent}% use-soon point`;
  }

  return {
    ...base,
    status,
    progress_percent: progressPercent,
    days_remaining: remainingSeconds > 0 ? round(remainingSeconds / DAY_SECONDS, 1) : 0,
    days_overdue: remainingSeconds <= 0 ? round(Math.abs(remainingSeconds) / DAY_SECONDS, 1) : 0,
    reason,
    note: null,
  };
}

// ---------------------------------------------------------------------------
// The blend
// ---------------------------------------------------------------------------

/**
 * Blend the two layers into the one status the owner specified.
 *
 *   fresh             date fresh      AND cabinet in_range
 *   use_soon          date use_soon   OR  cabinet warning
 *   check_food        date expired    OR  cabinet critical
 *   insufficient_data when none of the above can be reached honestly
 *
 * THE ORDER IS THE SAFETY ARGUMENT, and it is deliberate.
 *
 * A definite negative is evaluated BEFORE insufficiency. If the date layer says
 * the item is three days past a registered expiry, that is true whether or not
 * the cabinet produced a single reading this window, and reporting it as
 * `insufficient_data` would bury a certain problem under a missing sensor.
 * Symmetrically, a critical cabinet is a detected condition, not an absence of
 * one, so it survives a missing date layer too.
 *
 * What insufficiency can never do is manufacture a clean answer. `fresh` needs
 * BOTH layers to be positively good, so any missing input blocks it and lands
 * on `insufficient_data`. That is the whole point of the ordering: missing data
 * can only ever reduce the confidence of a GOOD result, never suppress a BAD
 * one.
 *
 * `forced_by` names the layer that decided, so a reader is never left guessing
 * why an item is flagged.
 *
 * Pure.
 */
export function blendStatus({ date, cabinet }) {
  if (date.status === 'expired' || cabinet.condition === 'critical') {
    const byDate = date.status === 'expired';
    return {
      status: 'check_food',
      forced_by: byDate ? 'date_derived' : 'cabinet_derived',
      reason: byDate
        ? `the item is past its registered deadline on its own dates: ${date.reason}`
        : `the cabinet this item shares is in a critical condition: ${cabinet.reason}`,
    };
  }
  if (date.status === 'use_soon' || cabinet.condition === 'warning') {
    const byDate = date.status === 'use_soon';
    return {
      status: 'use_soon',
      forced_by: byDate ? 'date_derived' : 'cabinet_derived',
      reason: byDate
        ? `the item is approaching its registered deadline on its own dates: ${date.reason}`
        : `the cabinet this item shares is in a warning condition: ${cabinet.reason}`,
    };
  }
  if (date.status === 'fresh' && cabinet.condition === 'in_range') {
    return {
      status: 'fresh',
      forced_by: null,
      reason: 'the item is early in its registered storage window and the cabinet it shares is within every configured limit',
    };
  }
  const gaps = [];
  if (date.status === 'insufficient_data') gaps.push(`date layer: ${date.reason}`);
  if (cabinet.condition === 'insufficient_data') gaps.push(`cabinet layer: ${cabinet.reason}`);
  return {
    status: 'insufficient_data',
    forced_by: null,
    reason: gaps.join('; ') || 'neither layer produced a condition that can be reported',
  };
}
