/**
 * How old the data on screen is, measured rather than believed.
 *
 * WHY THIS EXISTS
 * -----------------------------------------------------------------------------
 * `transport.stale` and `transport.age_seconds` are numbers the SERVICE computed
 * at the instant it built the frame. They are correct for that instant and they
 * do not move afterwards: they are a photograph of the age, not a clock. The
 * connection indicator in the shell has always measured the age itself for
 * exactly this reason, and its file says so at length.
 *
 * Nothing else did. So a KPI card could — and did — read the photograph: it
 * printed "Last accepted snapshot 4 s ago" with no stale marker while the header
 * beside it said Offline, and it kept saying it, because the field is frozen at
 * the value the service computed and the next frame only arrives if the device
 * reports, which is precisely the case where it does not. That is guide §5's
 * last line — "never imply that a stale reading is live" — and guide §46.7, both
 * of which are about exactly this.
 *
 * So the predicate lives in one place and every surface that prints an age uses
 * it. It is the SAME arithmetic the service applies, re-run against the browser's
 * own clock, so there is no second threshold to keep in step: `stale_after_seconds`
 * is the service's own limit, sent in every frame, and this file never invents
 * one.
 *
 * ONE TICK PER SURFACE, NOT PER CARD
 * -----------------------------------------------------------------------------
 * The hook owns a one-second interval because the age has to move on its own —
 * a reading that is 4 s old becomes 60 s old without anything happening. It is
 * called once by the component that owns a group of readouts, and the boolean is
 * passed down, so the dashboard runs three of them (card row, environment grid,
 * quick stats) rather than five plus the rest.
 */
import { useNow } from '../hooks/useNow';
import type { Transport } from '../api/types';
import { ago } from './format';

export interface Freshness {
  /** Seconds since the service last received an accepted snapshot. */
  readonly ageSeconds: number;
  /** The service's own staleness limit, in seconds. Never chosen here. */
  readonly staleAfterSeconds: number;
  /** True once the measured age passes that limit. */
  readonly stale: boolean;
  /** `null` when there is no frame to measure, which is its own state. */
  readonly since: string | null;
  /** The service's verbatim note, so the wording is never ours. */
  readonly note: string | null;
}

const UNKNOWN: Freshness = { ageSeconds: 0, staleAfterSeconds: 0, stale: false, since: null, note: null };

/**
 * The predicate, as a pure function, so it can be reasoned about and tested
 * without React. `now` is the browser's clock in epoch milliseconds.
 */
export function measure(transport: Transport | null, now: number): Freshness {
  if (transport === null) return UNKNOWN;
  const received = Date.parse(transport.last_received_at);
  if (Number.isNaN(received)) return { ...UNKNOWN, staleAfterSeconds: transport.stale_after_seconds, note: transport.note };
  const ageSeconds = Math.max(0, (now - received) / 1000);
  return {
    ageSeconds,
    staleAfterSeconds: transport.stale_after_seconds,
    // The service's own limit, applied to a live measurement. Not `transport.stale`,
    // which is that same comparison performed once and frozen.
    stale: ageSeconds >= transport.stale_after_seconds,
    since: ago(ageSeconds),
    note: transport.note,
  };
}

export function useFreshness(transport: Transport | null): Freshness {
  const now = useNow();
  return measure(transport, now);
}
