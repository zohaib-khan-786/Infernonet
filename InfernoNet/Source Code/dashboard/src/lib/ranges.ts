/**
 * Time ranges, in one place.
 *
 * Guide §9 asks for `1H 6H 24H 7D 30D` and a custom range. `RANGE_BUCKET` in
 * `api/endpoints.ts` already maps the first four to the buckets the service
 * implements, and that is the only source of truth for which bucket a range
 * costs; this file owns the human labels and the window arithmetic so the
 * trends chart, the metric detail and the sparklines cannot disagree about what
 * "6 h" means.
 *
 * 30D IS NOT OFFERED, and the reason is in the service, not here.
 * `RANGE_BUCKET` has no entry for it because at the device's ~5 s reporting
 * interval a month is roughly half a million samples, and the service caps a
 * response at `max_points` (500 by default) and answers `range_too_wide` above
 * that. Offering a button the service will refuse would be offering a control
 * that cannot do what it says. The bucket ceiling would turn it into a
 * six-month-resolution plot, which is a different chart wearing the same
 * label. When retention grows, this list grows with it and nothing else moves.
 */
import { RANGE_BUCKET } from '../api/endpoints';
import type { Bucket } from '../api/types';

export const RANGES = [
  { id: '1h', label: '1 h', full: 'last hour', seconds: 3_600 },
  { id: '6h', label: '6 h', full: 'last 6 hours', seconds: 6 * 3_600 },
  { id: '24h', label: '24 h', full: 'last 24 hours', seconds: 24 * 3_600 },
  { id: '7d', label: '7 d', full: 'last 7 days', seconds: 7 * 86_400 },
] as const;

export type RangeId = (typeof RANGES)[number]['id'];

export function isRangeId(value: string | null | undefined): value is RangeId {
  return value !== null && value !== undefined && RANGES.some((entry) => entry.id === value);
}

/**
 * A range as a phrase, with NO leading article.
 *
 * `last 6 hours`, not `the last 6 hours`, because `LineChart` builds its own
 * sentences around this string — "over the {label}", "No {title} values in the
 * {label}", "{title} summary for the {label}" — and an article here produces
 * "for the the last 6 hours" in three places at once, including a hidden table
 * caption a screen-reader user would read verbatim. Callers that want the
 * article write it.
 */
export function rangeFull(range: RangeId): string {
  return RANGES.find((entry) => entry.id === range)?.full ?? 'selected window';
}

/** The bucket the service is asked for. Sourced from the endpoint, not re-declared. */
export function bucketFor(range: RangeId): Bucket {
  return RANGE_BUCKET[range];
}

/**
 * The window for a range, ending now.
 *
 * One function, called on the first render and on every choice, because a
 * control whose initial window and chosen window can disagree is worse than
 * either. See the same note in `TrendsPanel`.
 */
export function windowFor(range: RangeId): { from: number; to: number } {
  const seconds = RANGES.find((entry) => entry.id === range)?.seconds ?? 6 * 3_600;
  const to = Date.now();
  return { from: to - seconds * 1000, to };
}

/** A `datetime-local` string for a `<input type="date">` bound, in local time. */
export function toDateInput(iso: string | number): string {
  const at = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
