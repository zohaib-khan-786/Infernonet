/**
 * Status presentation.
 *
 * The one place where a device verdict becomes something a person can read.
 *
 * Rules that must not be broken here or anywhere downstream:
 *
 *   - A verdict is never derived. `statusPresentation` takes the block the
 *     backend sent and picks a *treatment* for it. It does not compute an
 *     outcome, and it does not soften one. A code outside 0-3 is surfaced as
 *     unrecognised rather than being mapped to anything reassuring.
 *   - Colour is never alone. Every tone ships with a distinct shape, and the
 *     raw backend label is printed next to the readable one so the exact word
 *     the service used is always visible.
 *   - `sensor_fault` is deliberately *not* red. The verdict is unknown, not
 *     bad, and colouring it like `check_food` would tell a volunteer their
 *     food is unsafe when the device said it could not tell. It gets its own
 *     slate tone and a hatched diamond.
 */
import type { Alert, AlertSeverity, StatusBlock } from '../api/types';
import { humaniseLabel } from './format';

/** Semantic tones. Only these carry colour; everything else is neutral surface. */
export type Tone = 'ok' | 'warn' | 'crit' | 'unknown' | 'admin' | 'neutral';

/** Shape tokens. Drawn as SVG so they stay crisp at 1x and 2x. */
export type Shape = 'circle' | 'triangle' | 'square' | 'diamond' | 'hatched-diamond' | 'slashed-circle';

export interface StatusPresentation {
  readonly tone: Tone;
  readonly shape: Shape;
  /** The backend's own label, unaltered. */
  readonly token: string;
  /** A readable spelling of `token`. Same verdict, fewer underscores. */
  readonly label: string;
  /** True when the code is outside the documented 0-3 range. */
  readonly unrecognised: boolean;
  /** One line, in the interface's voice, saying what this verdict means here. */
  readonly meaning: string;
}

const MEANING: Readonly<Record<number, string>> = {
  0: 'Inside every monitored range, and no stored item is past its limit.',
  1: 'A stored item has passed 75% of its storage window. Not unsafe; plan for it.',
  2: 'A confirmed threshold breach or an item at its limit. Needs a human look at the food.',
  3: 'The device could not evaluate this. The verdict is unknown, not good.',
};

const PRESENTATION: Readonly<Record<number, { tone: Tone; shape: Shape }>> = {
  0: { tone: 'ok', shape: 'circle' },
  1: { tone: 'warn', shape: 'triangle' },
  2: { tone: 'crit', shape: 'square' },
  3: { tone: 'unknown', shape: 'hatched-diamond' },
};

export function statusPresentation(status: StatusBlock): StatusPresentation {
  const base = PRESENTATION[status.code];
  if (!base) {
    return {
      tone: 'neutral',
      shape: 'slashed-circle',
      token: status.label,
      label: 'Unrecognised status',
      unrecognised: true,
      meaning: `The service sent status code ${status.code}, which is outside the documented range 0-3. The dashboard will not guess what it means.`,
    };
  }
  return {
    tone: base.tone,
    shape: base.shape,
    token: status.label,
    label: humaniseLabel(status.label),
    unrecognised: false,
    meaning: MEANING[status.code] ?? '',
  };
}

export interface SeverityPresentation {
  readonly tone: Tone;
  readonly shape: Shape;
  readonly title: string;
}

/** Urgency wording. Says how loud this is, never what it is about. */
const SEVERITY: Readonly<Record<AlertSeverity, SeverityPresentation>> = {
  error: { tone: 'crit', shape: 'square', title: 'Needs action' },
  warning: { tone: 'warn', shape: 'triangle', title: 'Watch' },
  info: { tone: 'neutral', shape: 'circle', title: 'For information' },
};

export function severityPresentation(severity: AlertSeverity): SeverityPresentation {
  return SEVERITY[severity] ?? SEVERITY.info;
}

// ---------------------------------------------------------------------------
// Condition lanes
// ---------------------------------------------------------------------------

/**
 * Conditions are grouped by what they are *about*, before they are grouped by
 * how loud they are.
 *
 * The backend files a LittleFS fault at `severity: error`, the same level as an
 * item that reached its limit, and says in its detail text that freshness is
 * unaffected. Sorting purely by severity would therefore put a filing problem
 * in the same list as "throw this food out", which is the single most
 * misleading thing this screen could do. Lanes are the fix; severity orders
 * inside a lane.
 */
export type LaneId = 'food' | 'device' | 'admin';

export interface Lane {
  readonly id: LaneId;
  readonly title: string;
  /** One sentence on what this lane does and does not mean. */
  readonly blurb: string;
  readonly kinds: readonly Alert['kind'][];
}

export const LANES: readonly Lane[] = [
  {
    id: 'food',
    title: 'Food status',
    blurb:
      'The device’s own verdict about stored food. Act on the ones about a food; the ones that say it could not evaluate are marked as unknown, not bad.',
    kinds: ['item', 'status'],
  },
  {
    id: 'device',
    title: 'Device health',
    blurb: 'Something about the monitor itself. Food verdicts are not changed by anything in this lane.',
    kinds: ['sensor_unavailable', 'sensor_fault', 'door'],
  },
  {
    id: 'admin',
    title: 'Administration',
    blurb: 'Storage, configuration and optional-hardware problems. The service reports these as leaving freshness status unaffected.',
    kinds: ['storage_fault', 'optional_fault'],
  },
];

const LANE_BY_KIND = new Map<Alert['kind'], Lane>(LANES.flatMap((lane) => lane.kinds.map((kind) => [kind, lane] as const)));

export function laneFor(alert: Alert): Lane {
  return LANE_BY_KIND.get(alert.kind) ?? LANES[1];
}

/**
 * How a condition is *painted*, which is lane-first and severity-second.
 *
 * The bug this replaces: `severity` alone decided the treatment, so a LittleFS
 * fault, an untrusted clock and a dead sensor all rendered as `crit` + a filled
 * square - glyph, tint and ink identical to `check_food` - and two of them sit
 * inside the lane headed "These are the conditions to act on". A volunteer who
 * had correctly learned "red square means the food is a problem" would be taught
 * exactly the wrong lesson, on the screen they are most likely to act from.
 *
 * `severity` on the backend is an URGENCY field, not a verdict field. The
 * service files `storage_fault`, `sensor_fault`, `sensor_unavailable`,
 * `time_untrusted` and `item_unavailable` all at `error`, while its own detail
 * text for the storage class says freshness is unaffected. Those are not the
 * same claim, so they must not get the same glyph.
 *
 * Rule: only a condition that is genuinely a verdict about food may wear a
 * verdict glyph. `device` and `admin` conditions describe the monitor or its
 * administration, so they take the plain `diamond` - which no verdict uses - in
 * the cold `unknown` or `admin` slate. The verdict shapes stay reserved:
 *
 *   circle = fresh · triangle = use_soon · square = check_food
 *   hatched-diamond = sensor_fault (could not evaluate)
 *
 * The subtler half: even inside the food lane, `item_unavailable` and the
 * `*_sensor_fault` summary rows are NOT bad verdicts - they say the device could
 * not tell. Painting those with the check_food square would be the same lie one
 * lane over, so they take the `sensor_fault` treatment instead: the same cold
 * slate and hatched diamond the device itself uses for "could not evaluate".
 * A condition that means "I cannot judge this" and a verdict that means "I
 * cannot judge this" should look identical, and both must differ from "throw
 * this out".
 */
const LANE_TREATMENT: Readonly<Record<LaneId, Readonly<Record<AlertSeverity, { tone: Tone; shape: Shape }>>>> = {
  // A food-lane error really is a verdict about food, so the verdict treatment
  // is correct here and only here.
  food: {
    error: { tone: 'crit', shape: 'square' },
    warning: { tone: 'warn', shape: 'triangle' },
    info: { tone: 'neutral', shape: 'circle' },
  },
  device: {
    error: { tone: 'unknown', shape: 'diamond' },
    warning: { tone: 'admin', shape: 'diamond' },
    info: { tone: 'neutral', shape: 'circle' },
  },
  admin: {
    error: { tone: 'admin', shape: 'diamond' },
    warning: { tone: 'admin', shape: 'diamond' },
    info: { tone: 'neutral', shape: 'circle' },
  },
};

/** "The device could not determine this" — not a claim that anything is bad. */
const UNJUDGED_FOOD_KEY =
  /^(item_unavailable:|zone_sensor_fault$|overall_sensor_fault$|zone_check_food_unavailable$)/;

/**
 * The treatment for one condition row: lane decides the semantic class,
 * severity decides the urgency wording and the step within that class.
 */
export function conditionPresentation(alert: Alert): SeverityPresentation {
  const urgency = severityPresentation(alert.severity);
  const lane = laneFor(alert).id;
  const fallback = LANE_TREATMENT[lane].info;
  const treatment =
    lane === 'food' && UNJUDGED_FOOD_KEY.test(alert.condition_key)
      ? { tone: 'unknown' as Tone, shape: 'hatched-diamond' as Shape }
      : (LANE_TREATMENT[lane][alert.severity] ?? fallback);
  return { tone: treatment.tone, shape: treatment.shape, title: urgency.title };
}

const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = { error: 0, warning: 1, info: 2 };

/** Within a lane: errors first, then warnings, then information; then by key. */
export function compareAlerts(a: Alert, b: Alert): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.condition_key.localeCompare(b.condition_key)
  );
}

/** Group alerts into lanes, dropping empty lanes, ordering within each. */
export function groupAlerts(alerts: readonly Alert[]): { lane: Lane; items: Alert[] }[] {
  const buckets = new Map<LaneId, Alert[]>();
  for (const alert of alerts) {
    const lane = laneFor(alert);
    const existing = buckets.get(lane.id);
    if (existing) existing.push(alert);
    else buckets.set(lane.id, [alert]);
  }
  return LANES.filter((lane) => (buckets.get(lane.id)?.length ?? 0) > 0).map((lane) => ({
    lane,
    items: (buckets.get(lane.id) ?? []).sort(compareAlerts),
  }));
}

// ---------------------------------------------------------------------------
// Inventory ordering
// ---------------------------------------------------------------------------

/**
 * Urgency order for the stored-food table: check_food, use_soon, sensor_fault,
 * fresh. Within a rank, the item the device says needs attention soonest comes
 * first, then by name.
 *
 * `remaining_seconds` is used *only* for ordering, and only when the backend
 * provided it. A withheld duration leaves the item in its status rank and
 * falls back to name order, which is the honest thing to do rather than
 * inventing a sort key.
 */
export function compareItems(
  a: { status: StatusBlock; derived: { remaining_seconds: number | null }; name: string },
  b: { status: StatusBlock; derived: { remaining_seconds: number | null }; name: string },
): number {
  const rank = (item: typeof a): number => {
    if (item.status.code === 2) return 0;
    if (item.status.code === 1) return 1;
    if (item.status.code === 3) return 2;
    return 3;
  };
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  const aRemaining = a.derived.remaining_seconds;
  const bRemaining = b.derived.remaining_seconds;
  if (aRemaining !== null && bRemaining !== null && aRemaining !== bRemaining) return aRemaining - bRemaining;
  if (aRemaining !== null && bRemaining === null) return -1;
  if (aRemaining === null && bRemaining !== null) return 1;
  return a.name.localeCompare(b.name);
}

/** A sorted copy. `toSorted` keeps the caller's array untouched. */
export function byUrgency<T extends Parameters<typeof compareItems>[0]>(items: readonly T[]): T[] {
  return items.toSorted(compareItems);
}
