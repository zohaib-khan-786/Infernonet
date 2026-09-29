/**
 * Freshness engine, part 2 of 2: the SERVICE.
 *
 * Interface:
 *   createFreshnessService({ db, now, windowMinutes, clockMaxSkewSeconds })
 *     -> { evaluate(dev, { inventory }) }
 *
 * This module's whole job is to gather evidence and hand it to `rules.js`, which
 * does every decision. It resolves which limits apply, reads the `reading` rows
 * for the window, and assembles the document. It computes no verdict of its own
 * - if a rule is wrong, the fix belongs in `rules.js` where it can be tested
 * without a database.
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT PERSISTED, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 *
 * A computed freshness verdict is derived state: it is a pure function of
 * `reading` rows, `inventory_item` rows, `threshold_profile` rows and the
 * device's clock. Storing it would create a fourth copy of the truth that has
 * to be invalidated whenever any of those change - and the failure mode of a
 * stale derived column is a confidently wrong `fresh` nobody remembers checking.
 *
 * So it is recomputed. On every read, and - because `read.current(dev)` is what
 * the ingest path publishes - on every accepted snapshot as well. A new reading
 * can therefore change a verdict, and the change reaches an open dashboard over
 * the existing SSE stream with no polling anywhere.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE LIMITS COME FROM
 * ---------------------------------------------------------------------------
 *
 * `threshold_profile` at scope `zone`, falling back to `BUILT_IN_THRESHOLDS`.
 * The fallback is reported as `built_in_assumption` with its own note, because
 * SRS 1.6 (x) p11 forbids presenting an unsourced value as a food-safety limit
 * and the UI has to be able to tell the two apart at a glance.
 *
 * What this module deliberately does NOT do is second-guess the device. The
 * limits the device says it is applying are reported beside the ones that were
 * used, and whether they agree, but they never feed a verdict here. The
 * configured profile and the built-in defaults describe what the BACKEND
 * measured against; the device applies its own logic to the same numbers. Two
 * answers can differ, and the response shows both rather than picking one.
 */
import { statusLabel, WARMING_GAS_STATES } from '../domain.js';
import {
  BUILT_IN_THRESHOLDS,
  CABINET_ATTRIBUTION,
  DISCLAIMER,
  evaluateCabinet,
  evaluateClock,
  evaluateItemDates,
  blendStatus,
} from './rules.js';

const toEpoch = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);

const SCOPE = 'zone';

/** The columns a zone profile can set, and therefore the keys the engine reads. */
const THRESHOLD_KEYS = Object.freeze(Object.keys(BUILT_IN_THRESHOLDS));

export function createFreshnessService({
  db,
  now = () => new Date(),
  windowMinutes = 360,
  clockMaxSkewSeconds = 900,
}) {
  const q = {
    device: db.prepare('SELECT * FROM device WHERE dev = ?'),
    profile: db.prepare('SELECT * FROM threshold_profile WHERE dev = ? AND scope = ?'),
    deviceThresholds: db.prepare('SELECT thresholds_json, thresholds_rev FROM device WHERE dev = ?'),
    readings: db.prepare(`
      SELECT recorded_at, temperature_c, humidity_pct, pressure_hpa, gas_input_mv, gas_delta_mv
        FROM reading
       WHERE device_id = @device_id AND recorded_at >= @from AND recorded_at <= @to
       ORDER BY recorded_at, id
    `),
  };

  /**
   * Resolve the limits the engine measures against.
   *
   * A configured zone profile is authoritative IN FULL, including its nulls.
   * An explicitly cleared limit means "stop using this limit" - the same meaning
   * `thresholds.set` gives it - so it leaves the channel unjudged rather than
   * quietly reinstating the built-in default for that one field. Reinstating it
   * would be the worst possible behaviour here: an operator who deliberately
   * cleared a limit would get it back, and the response would report a number
   * they had asked the system to stop using.
   *
   * The built-in defaults apply only when there is no profile at all, and that
   * case is reported as `built_in_assumption` rather than as a configured limit.
   */
  function resolveThresholds(dev) {
    const profile = q.profile.get(dev, SCOPE);
    const values = profile
      ? Object.fromEntries(THRESHOLD_KEYS.map((key) => [key, profile[key] ?? null]))
      : { ...BUILT_IN_THRESHOLDS };
    return {
      revision: profile ? profile.revision : null,
      // Carried through verbatim so the UI keeps telling a cited limit from a
      // prototype assumption. This is the single field requirement (4) exists
      // for, and it is deliberately never normalised away.
      source: profile ? profile.source : 'built_in_assumption',
      basis: profile ? 'configured_zone_profile' : 'built_in_default',
      scope: SCOPE,
      reference: profile ? profile.reference : null,
      note: profile
        ? profile.note
        : 'no zone threshold profile is configured, so the backend is measuring against its own prototype '
          + 'defaults. These are NOT cited food-safety limits and must not be presented as such '
          + '(SRS 1.6 (x)); configure a zone profile to replace them.',
      values,
    };
  }

  /** What the device says it is applying. Reported, never used to judge. */
  function deviceAppliedThresholds(dev) {
    const row = q.deviceThresholds.get(dev);
    if (!row) return null;
    let values = null;
    try {
      values = row.thresholds_json ? JSON.parse(row.thresholds_json) : null;
    } catch {
      values = null;
    }
    return { values, revision: row.thresholds_rev ?? null };
  }

  function readWindow(device, fromEpoch, untilEpoch) {
    return q.readings
      .all({
        device_id: device.id,
        from: new Date(fromEpoch * 1000).toISOString(),
        to: new Date(untilEpoch * 1000).toISOString(),
      })
      .map((row) => ({
        t: toEpoch(row.recorded_at),
        temperature_c: row.temperature_c,
        humidity_pct: row.humidity_pct,
        pressure_hpa: row.pressure_hpa,
        gas_input_mv: row.gas_input_mv,
        gas_delta_mv: row.gas_delta_mv,
      }));
  }

  return {
    /**
     * The whole document. `inventory` is the raw `inventory_item` rows, active
     * and retired both, because the caller decides which subset to report and
     * this function must not silently disagree with it.
     */
    evaluate(dev, { inventory = [] } = {}) {
      const device = q.device.get(dev);
      if (!device) return null;

      const nowEpoch = Math.floor(now().getTime() / 1000);
      const windowSeconds = windowMinutes * 60;
      const fromEpoch = nowEpoch - windowSeconds;
      const readings = readWindow(device, fromEpoch, nowEpoch);

      const thresholds = resolveThresholds(dev);
      const deviceThresholds = deviceAppliedThresholds(dev);

      const clock = evaluateClock({
        timeValid: Boolean(device.time_valid),
        reportedAtEpoch: toEpoch(device.reported_at),
        nowEpoch,
        maxSkewSeconds: clockMaxSkewSeconds,
      });

      const gasState = device.gas_state ?? null;
      const cabinet = evaluateCabinet({
        readings,
        thresholds: thresholds.values,
        nowEpoch,
        windowMinutes,
        // The one device-state input the engine reads. `warming_up` and
        // `capturing_baseline` mean the MQ-135 has no valid baseline yet, and a
        // reading from a sensor in that state is not a cabinet measurement.
        gasUsable: !WARMING_GAS_STATES.has(gasState),
        gasState,
        door: {
          known: !device.door_stale,
          open: device.door_open,
          stale: Boolean(device.door_stale),
          timeout_ms: device.door_timeout_ms,
        },
      });

      const items = inventory.map((item) => {
        const date = evaluateItemDates({
          item,
          nowEpoch,
          clockTrusted: clock.trusted,
          useSoonPercent: thresholds.values.use_soon_percent,
        });
        const blend = blendStatus({ date, cabinet });
        return buildItem({ item, date, cabinet, blend, cabinetClockNote: clock.trusted });
      });

      return {
        dev: device.dev,
        computed_at: new Date(nowEpoch * 1000).toISOString(),
        // Kept at the top level as well as inside `clock`, because it is the one
        // flag a consumer must not read past.
        clock_trusted: clock.trusted,
        clock,
        thresholds: {
          revision: thresholds.revision,
          source: thresholds.source,
          basis: thresholds.basis,
          scope: thresholds.scope,
          reference: thresholds.reference,
          note: thresholds.note,
          values: thresholds.values,
          device_applied: deviceThresholds,
          device_in_sync: deviceThresholds === null || thresholds.revision === null || deviceThresholds.revision === null
            ? null
            : deviceThresholds.revision === thresholds.revision,
        },
        cabinet,
        items,
        disclaimer: DISCLAIMER,
        engine: {
          window_minutes: windowMinutes,
          clock_max_skew_seconds: clockMaxSkewSeconds,
          rule: 'cabinet exposure is a cabinet measurement that items reference; it is never an item measurement',
        },
      };
    },

    windowMinutes,
    clockMaxSkewSeconds,
  };
}

/**
 * One item's result.
 *
 * `item_temperature_measured: false` is a hard constant, not a computed value.
 * There is no code path that could set it to true, and there is no sensor that
 * could support it: the cabinet probes measure air. Emitting it from a literal
 * means a future edit cannot accidentally start claiming it.
 */
function buildItem({ item, date, cabinet, blend, cabinetClockNote }) {
  const cabinetUsed = blend.forced_by === 'cabinet_derived';
  return {
    uid: item.uid,
    name: item.name,
    status: blend.status,
    item_temperature_measured: false,
    forced_by: blend.forced_by,
    reason: blend.reason,
    evidence: {
      date_derived: date,
      cabinet_derived: {
        applies: true,
        condition: cabinet.condition,
        reason: cabinet.reason,
        used_in_status: cabinetUsed,
        measured: 'cabinet_air',
        attribution: CABINET_ATTRIBUTION,
        // Restated per item rather than once at the top, so a single item card
        // lifted out of this response still cannot be read as a per-item
        // temperature claim.
        note: cabinetClockNote
          ? 'the item references the cabinet condition; the item\'s own temperature is not measured'
          : 'the cabinet condition does not depend on the device clock, so it stands even while the date layer is withheld',
      },
    },
    device_provisional: {
      status_code: item.status_code ?? null,
      label: item.status_code === null || item.status_code === undefined ? null : statusLabel(item.status_code),
      source: 'device',
      authoritative: false,
      basis: 'the device\'s own per-item status_code, inferred from the same cabinet air this engine reads',
      note: 'reported for traceability, not deleted and not used. It is inferred the same way this engine\'s '
        + 'cabinet layer is - from cabinet air - so it cannot distinguish one item from another in the same '
        + 'cabinet. It is not authoritative: the backend\'s `status` above is the one computed here, and this '
        + 'field never contributes to it.',
    },
  };
}
