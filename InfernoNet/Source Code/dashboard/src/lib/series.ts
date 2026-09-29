/**
 * Statistics over a fetched readings window.
 *
 * Everything here is arithmetic on rows the service already returned. Nothing
 * extrapolates, smooths, interpolates or fills: a bucket with no value
 * contributes to the gap counters and to `unknownSeconds`, and never to the
 * average, because an average that quietly includes "no data" as zero is worse
 * than no average.
 *
 * WHY "TIME OUTSIDE THRESHOLD" IS ESTIMATED, AND SAYS SO
 * -----------------------------------------------------------------------------
 * The service buckets samples (`1m`, `5m`, `1h`) and each point is an average
 * of whatever fell in it. A temperature that crossed the limit for forty
 * seconds inside a one-hour bucket is therefore invisible here, and the figure
 * below is a lower bound on the true excursion time, not a measurement of it.
 * The component that renders it prints the bucket width next to the number for
 * exactly that reason. Guide §26 forbids charts presenting fake data as real;
 * a duration quoted without its resolution is the same defect in prose.
 */
import type { ReadingField, SeriesPoint } from '../api/types';
import type { MetricBand } from './metrics';

export interface Extremum {
  readonly value: number;
  /** Service receipt time of the point, ISO-8601. */
  readonly at: string;
}

export interface SeriesStats {
  /** Points the service returned for the window. */
  readonly total: number;
  /** Points that carry a value for this field. */
  readonly present: number;
  /** Points with no value. `total - present`. */
  readonly missing: number;
  /** Continuous runs of consecutive present points. 1 for a complete series. */
  readonly runs: number;
  readonly min: Extremum | null;
  readonly max: Extremum | null;
  readonly last: Extremum | null;
  /** Mean of the present points, or null when there are none. */
  readonly average: number | null;
  /** Seconds of the window whose bucket mean was below the band minimum. */
  readonly belowSeconds: number;
  /** Seconds of the window whose bucket mean was above the band maximum. */
  readonly aboveSeconds: number;
  /** Seconds of the window carrying no value at all. */
  readonly unknownSeconds: number;
  /** True when the band lies entirely outside the values seen, so it is off-scale. */
  readonly bandOffScale: boolean;
  /** Value range seen, before the chart pads it. */
  readonly span: { lo: number; hi: number } | null;
}

const EMPTY: SeriesStats = {
  total: 0,
  present: 0,
  missing: 0,
  runs: 0,
  min: null,
  max: null,
  last: null,
  average: null,
  belowSeconds: 0,
  aboveSeconds: 0,
  unknownSeconds: 0,
  bandOffScale: false,
  span: null,
};

function at(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function summariseSeries(
  field: ReadingField,
  points: readonly SeriesPoint[],
  from: number,
  to: number,
  band: MetricBand | null,
): SeriesStats {
  if (points.length === 0) return { ...EMPTY, total: 0, missing: 0 };

  const nominalStep = points.length > 1 ? (to - from) / points.length : to - from;
  // A hole in time is a gap even when both ends carry a value, so a power cut
  // does not become a straight line. Matches LineChart's own gap rule.
  const gapLimit = Math.max(nominalStep * 2.5, 1);

  // The time a point covers is the bucket width, which is `nominalStep`. It is
  // NOT `point.samples * nominalStep`: `samples` is how many raw readings the
  // service averaged INTO the bucket, not how long the bucket is, and
  // multiplying by both counted every span in the window about fifty-four times
  // over.
  //
  // The unit matters as much as the factor. `from` and `to` arrive as epoch
  // MILLISECONDS and the gap comparison below is in milliseconds, but every
  // duration this module reports is in seconds — so the width is converted once,
  // here, rather than at each of the four places that add it up. Getting that
  // wrong printed "6000 h" for a six-hour window.
  const width = Math.max(0, nominalStep / 1000);

  let present = 0;
  let runs = 0;
  let sum = 0;
  let min: Extremum | null = null;
  let max: Extremum | null = null;
  let last: Extremum | null = null;
  let belowSeconds = 0;
  let aboveSeconds = 0;
  let unknownSeconds = 0;
  let previousAt: number | null = null;

  for (const point of points) {
    const time = at(point.t);
    const value = point[field];

    if (value === null || !Number.isFinite(value)) {
      unknownSeconds += width;
      previousAt = time;
      continue;
    }

    present += 1;
    sum += value;
    if (previousAt === null || time - previousAt > gapLimit) runs += 1;
    previousAt = time;

    const extremum: Extremum = { value, at: point.t };
    if (min === null || value < min.value) min = extremum;
    if (max === null || value > max.value) max = extremum;
    last = extremum;

    if (band !== null) {
      if (value < band.min) belowSeconds += width;
      else if (value > band.max) aboveSeconds += width;
    }
  }

  // No clamp, and none is needed: `points.length * nominalStep` is exactly
  // `to - from` by construction, so below, above and unknown partition the
  // window without overlapping. An earlier version clamped one of them against
  // the other two, which could only ever produce a negative — and a negative
  // duration renders as "0 s", which is a number that looks like a measurement.
  const bandOffScale = band !== null && (min === null || max === null || (band.max < min.value && band.min < min.value) || (band.min > max.value && band.max > max.value));

  return {
    total: points.length,
    present,
    missing: points.length - present,
    runs,
    min,
    max,
    last,
    average: present === 0 ? null : sum / present,
    belowSeconds,
    aboveSeconds,
    unknownSeconds,
    bandOffScale,
    span: min === null || max === null ? null : { lo: min.value, hi: max.value },
  };
}

/** Seconds of the window spent outside the band on either side. */
export function outsideSeconds(stats: SeriesStats): number {
  return stats.belowSeconds + stats.aboveSeconds;
}

/** A whole-minute rendering of a duration, or an explicit reason it is unknown. */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return secs > 0 ? `${minutes} min ${secs} s` : `${minutes} min`;
  return `${secs} s`;
}
