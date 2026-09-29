/**
 * How a server-computed freshness verdict becomes something a person can read.
 *
 * The same discipline `lib/status.ts` keeps for the DEVICE's status code, and for
 * the same three reasons.
 *
 *   - A verdict is never derived here. These functions take the word the backend
 *     sent and pick a *treatment* for it. There is no arithmetic, no threshold
 *     and no "probably means" anywhere in this file, because the one component
 *     that could disagree with the engine is the one that must not.
 *   - Colour is never alone. Each verdict carries a shape, and the raw token is
 *     printed beside the readable spelling so the exact word the service used is
 *     always on screen.
 *   - `insufficient_data` is emphatically not `fresh`. It takes the cold slate
 *     and the hatched diamond — the same treatment the device uses for "could not
 *     evaluate" — because "I cannot tell" and "it is fine" are the two sentences
 *     a volunteer must never confuse, and they sit one row apart.
 *   - A word this build has never seen is reported as unrecognised and is NOT
 *     mapped onto anything reassuring.
 *
 * WHY IT IS A SEPARATE MODULE AND NOT PART OF THE COMPONENT
 * -----------------------------------------------------------------------------
 * Every rule above is a statement about a mapping, and a mapping is the easiest
 * thing in a codebase to get quietly wrong by hand-editing a JSX ternary. Kept
 * pure and separate, the whole decision surface is one screen, it has no React in
 * it, and it can be reasoned about without rendering anything.
 */
import type {
  CabinetCondition,
  DateEvidence,
  DateEvidenceStatus,
  FreshnessItemStatus,
  FreshnessThresholdSource,
} from '../../api/types';
import type { Shape, Tone } from '../../lib/status';
import { humaniseLabel } from '../../lib/format';

// ---------------------------------------------------------------------------
// The blended verdict
// ---------------------------------------------------------------------------

export interface VerdictPresentation {
  readonly tone: Tone;
  readonly shape: Shape;
  /** The backend's own word, unaltered. */
  readonly token: string;
  /** A readable spelling of `token`. Same verdict, fewer underscores. */
  readonly label: string;
  /** True when the backend sent a word this build does not know. */
  readonly unrecognised: boolean;
  /**
   * One line saying what this verdict means, and — for `insufficient_data` —
   * that it is the ABSENCE of a finding, never a good one.
   */
  readonly meaning: string;
}

const VERDICT: Readonly<Record<FreshnessItemStatus, { tone: Tone; shape: Shape; meaning: string }>> = {
  fresh: {
    tone: 'ok',
    shape: 'circle',
    meaning: 'Both layers came back positive: the item is early in its registered storage window, and the cabinet it shares is within every configured limit.',
  },
  use_soon: {
    tone: 'warn',
    shape: 'triangle',
    meaning: 'One of the two layers raised it. Not a statement that the food is bad — a statement that it is approaching the point where somebody should look at it.',
  },
  check_food: {
    tone: 'crit',
    shape: 'square',
    meaning: 'A definite problem was detected: a registered deadline passed, or the cabinet left its configured limits. Look at this food.',
  },
  insufficient_data: {
    tone: 'unknown',
    shape: 'hatched-diamond',
    meaning:
      'The service could not reach a verdict. This is the ABSENCE of a finding, not a good one, and it is never shown as Fresh. The reason is named on the item.',
  },
};

/** An unfamiliar word is never mapped to anything, least of all to `fresh`. */
const UNRECOGNISED: Omit<VerdictPresentation, 'token' | 'label'> = {
  tone: 'neutral',
  shape: 'slashed-circle',
  unrecognised: true,
  meaning:
    'The service sent a verdict word this dashboard does not know. It is shown exactly as received and is not being interpreted as good.',
};

export function verdictPresentation(status: string): VerdictPresentation {
  const known = VERDICT[status as FreshnessItemStatus];
  if (!known) return { ...UNRECOGNISED, token: status, label: 'Unrecognised verdict' };
  return { ...known, token: status, label: humaniseLabel(status), unrecognised: false };
}

// ---------------------------------------------------------------------------
// The two layers
// ---------------------------------------------------------------------------

const DATE_STATUS: Readonly<Record<DateEvidenceStatus, { tone: Tone; shape: Shape; label: string }>> = {
  fresh: { tone: 'ok', shape: 'circle', label: 'Early in its window' },
  use_soon: { tone: 'warn', shape: 'triangle', label: 'Approaching its deadline' },
  expired: { tone: 'crit', shape: 'square', label: 'Past its deadline' },
  insufficient_data: { tone: 'unknown', shape: 'hatched-diamond', label: 'Not judged' },
};

export interface LayerPresentation {
  readonly tone: Tone;
  readonly shape: Shape;
  readonly label: string;
  readonly token: DateEvidenceStatus;
}

/**
 * Layer 1's own word.
 *
 * `expired` gets `crit`/`square` here, which is the same treatment the blended
 * `check_food` gets and is the only tone in the two-layer stack that a reader
 * sees twice for one item. That is correct: `expired` IS the certain half of a
 * `check_food`, and a block that quietly said "not good" instead would break the
 * one rule the two-layer split exists to keep — that a definite negative survives
 * a missing sensor.
 */
export function dateLayerPresentation(date: DateEvidence): LayerPresentation {
  const known = DATE_STATUS[date.status];
  if (!known) {
    return { tone: 'neutral', shape: 'slashed-circle', label: 'Not judged', token: date.status };
  }
  return { ...known, token: date.status };
}

const CABINET_CONDITION: Readonly<Record<CabinetCondition, { tone: Tone; shape: Shape; label: string }>> = {
  in_range: { tone: 'ok', shape: 'circle', label: 'Within every configured limit' },
  warning: { tone: 'warn', shape: 'triangle', label: 'Outside a limit, inside the warning margin' },
  critical: { tone: 'crit', shape: 'square', label: 'Outside a limit by more than the warning margin' },
  insufficient_data: { tone: 'unknown', shape: 'hatched-diamond', label: 'Not measured well enough to judge' },
};

/**
 * Layer 2's condition — a fact about CABINET AIR.
 *
 * `neutral` rather than a status colour is available for an unrecognised word and
 * is the reason the label reads as an absence rather than as reassurance.
 */
export function cabinetConditionPresentation(condition: string): LayerPresentation {
  const known = CABINET_CONDITION[condition as CabinetCondition];
  if (!known) return { tone: 'neutral', shape: 'slashed-circle', label: 'Not judged', token: condition as DateEvidenceStatus };
  return { ...known, token: condition as DateEvidenceStatus };
}

// ---------------------------------------------------------------------------
// Blend honesty
// ---------------------------------------------------------------------------

/**
 * Is the limit the engine measured against a cited one, or a prototype default?
 *
 * This is a two-way question and both answers have to be visible. SRS 1.6 (x)
 * forbids presenting an unsourced value as a food-safety standard, and a
 * dashboard that only ever shouted about `built_in_assumption` would train a
 * reader to ignore the badge entirely — so a configured profile has to be
 * distinguishable too, and `prototype_assumption` is a configured profile whose
 * own author recorded that it is still a guess.
 */
export interface ThresholdHonesty {
  /** The raw `source`, so the backend's word is on screen. */
  readonly source: FreshnessThresholdSource;
  readonly builtIn: boolean;
  /** Short, for a chip. Never the only place the distinction is made. */
  readonly chip: string;
  /** One sentence naming the basis, for the place the band is shown. */
  readonly statement: string;
}

export function thresholdHonesty(source: FreshnessThresholdSource, basis: string): ThresholdHonesty {
  if (source === 'built_in_assumption') {
    return {
      source,
      builtIn: true,
      chip: 'Built-in assumption — not a cited limit',
      statement:
        'The backend is measuring against its own prototype defaults because no zone threshold profile is configured. ' +
        'These are NOT cited food-safety limits and must not be read as such. Configure a zone profile to replace them.',
    };
  }
  if (source === 'prototype_assumption') {
    return {
      source,
      builtIn: false,
      chip: 'Configured, but recorded as a prototype assumption',
      statement: `A zone threshold profile is configured (${basis}) and its own author recorded the values as a prototype assumption rather than a cited standard.`,
    };
  }
  return {
    source,
    builtIn: false,
    chip: `Cited limit — source: ${source}`,
    statement: `A zone threshold profile is configured (${basis}) and its source is recorded as ${source}.`,
  };
}

/**
 * The warning band, in words.
 *
 * `severity_rules` is a `built_in_assumption` and is typed as that literal, so
 * this function cannot be called on anything else without a type error. The
 * returned string always leads with that word: a reader must not be able to look
 * at a warning band and not learn that its width is the backend's own choice.
 */
export function severityRuleLabel(margins: Readonly<Record<string, number>>): string {
  const parts = Object.entries(margins).map(([channel, value]) => `${channel.replace(/_/g, ' ')} ${value}`);
  return `Warning band is a built-in assumption (${parts.join(' · ')})`;
}
