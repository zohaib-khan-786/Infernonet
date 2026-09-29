/**
 * What a condition is about, as far as its key honestly admits.
 *
 * Guide §14 asks each alert row to carry a current value, a threshold, a start
 * time and a device, and guide §15 asks the detail for a duration and a sensor.
 * The service's `Alert` has six content fields — `condition_key`, `kind`,
 * `severity`, `title`, `detail`, and the acknowledgement triple — and none of
 * the four numbers is among them.
 *
 * So this module answers the question in four different ways rather than
 * inventing four values:
 *
 *   subject metric   recoverable for the conditions whose key names a sensor.
 *                    `unavailable:3:mq135` is about the gas path, and that is
 *                    not a guess: the key is `<kind>:<bit>:<name>` and the name
 *                    comes from the firmware's own fault map.
 *   current value    read from the live snapshot for that metric. For a sensor
 *                    condition it is usually absent — that is what the condition
 *                    says — and the absence is shown with the reason.
 *   threshold        the device's own configured band for that metric, quoted
 *                    with its source. Never a band invented here.
 *   started /        never derivable. The service stores no onset time for a
 *   duration         condition, and the backend says so in its own words for
 *                    `zone_check_food`: "which specific threshold raised it is
 *                    not transmitted". The UI repeats that rather than
 *                    substituting the acknowledgement time, the last snapshot
 *                    time, or this browser's first sight of the condition —
 *                    all three are things the dashboard knows and the food does
 *                    not.
 */
import type { Alert, ReadingBlock, ReadingField, Thresholds } from '../api/types';
import { bandFor, metricById, METRICS, type MetricId, type MetricSpec } from './metrics';

export interface ConditionFacts {
  /** The metric this condition is about, or null when its subject is not transmitted. */
  readonly metric: MetricSpec | null;
  /** The live reading for that metric, or null with a reason it is absent. */
  readonly value: { readonly value: number; readonly at: string } | null;
  /** Why the value is absent, when it is. */
  readonly valueAbsence: string | null;
  /** The device's configured band for that metric, if it configures one. */
  readonly band: ReturnType<typeof bandFor>;
  /** The firmware's name of the part, when the key names one. */
  readonly sensor: string | null;
  /** Always present, always an explanation. There is no onset field. */
  readonly startedNote: string;
}

/** The fault-bit name embedded in a condition key, when there is one. */
function namedSensor(alert: Alert): string | null {
  const parts = alert.condition_key.split(':');
  if (parts.length < 3) return null;
  const name = parts[2];
  return name !== undefined && name !== '' ? name : null;
}

/**
 * Fault-bit name to metric.
 *
 * `bme280` is one bit covering the chip, and the chip measures both temperature
 * and pressure, so this maps to temperature — the headline of the two. The
 * pressure metric's own `provenance` already says it shares the bit, and
 * choosing between the two halves on a reader's behalf would be a guess about
 * which one failed.
 */
const METRIC_FOR_BIT: Readonly<Record<string, MetricId>> = {
  bme280: 'temperature',
  bme280_humidity: 'humidity',
  mq135: 'gas',
};

/** The readings field a metric is made of. Mirrors `MetricSpec.field`, narrowed. */
const FIELD_FOR_METRIC: Readonly<Partial<Record<MetricId, ReadingField>>> = Object.fromEntries(
  METRICS.flatMap((metric) => (metric.field === null ? [] : [[metric.id, metric.field] as const])),
);

const STARTED_NOTE =
  'The service does not record when a condition began. A condition is a latched state in the latest snapshot, not a record, so there is no onset time to show and no duration to compute.';

export function conditionFacts(alert: Alert, readings: ReadingBlock | null, thresholds: Thresholds | null): ConditionFacts {
  const sensor = namedSensor(alert);
  const id = sensor === null ? null : (METRIC_FOR_BIT[sensor] ?? null);

  if (id === null) {
    return { metric: null, value: null, valueAbsence: null, band: null, sensor, startedNote: STARTED_NOTE };
  }

  const field = FIELD_FOR_METRIC[id] ?? null;
  const value = readings === null || field === null ? null : readings[field];
  const recordedAt = readings?.recorded_at ?? null;

  const valueAbsence =
    value === null || value === undefined
      ? alert.kind === 'sensor_unavailable' || alert.kind === 'sensor_fault'
        ? 'No value — that absence is what this condition is reporting.'
        : 'The device did not include this reading in the latest snapshot.'
      : null;

  return {
    metric: metricById(id),
    value: value === null || value === undefined || recordedAt === null ? null : { value, at: recordedAt },
    valueAbsence,
    band: bandFor(id, thresholds),
    sensor,
    startedNote: STARTED_NOTE,
  };
}
