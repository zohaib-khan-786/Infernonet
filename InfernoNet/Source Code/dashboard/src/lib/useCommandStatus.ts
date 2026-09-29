/**
 * Polling for one registration command's fate.
 *
 * WHY THIS IS NOT `useResource`. `useResource` clears its data the instant a
 * load starts, which is right for "these are different rows" and badly wrong for
 * "is this still in flight": the whole point of the notice below is that it keeps
 * reading `dispatched` while it waits, and a resource hook would blank the
 * sentence out every couple of seconds and put it back. So this hook keeps the
 * last good read on screen across every reload and reports movement as movement.
 *
 * WHAT IT IS WATCHING. `registerItem` can only ever answer `dispatched` — that
 * is the broker's word, not the device's, and a command the device never
 * received looks identical to one in flight forever. `getCommandStatus` is the
 * read that ends that, and this hook is what turns it from a one-shot read into
 * a watch. It stops on the first terminal state, because continuing to ask
 * "did this arrive?" about a command that has already been answered is a request
 * loop with no other purpose.
 *
 * THE CADENCE, AND WHY IT BENDS. A device that is online reports on its own
 * schedule, so a registration that will be applied is usually applied within a
 * few seconds — often by the very next snapshot. Early reads are therefore
 * frequent enough to catch that, and they are bounded in number rather than in
 * time. Then the reads back off, because a command nobody applied is not going
 * to be applied by asking twice as often, and at 5 minutes the answer is
 * "probably not coming" whether or not it is still being asked. What the budget
 * buys is not a conclusion — it is the absence of an indefinite one, and the
 * persisted command means the answer is picked up again on the next visit.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCommandStatus } from '../api/endpoints';
import type { ApiError } from '../api/client';
import { isTerminalCommandState, type CommandStatusResponse } from '../api/types';
import { toApiError } from './useResource';

/**
 * Reads get less frequent as the wait gets longer, and then stop.
 *
 * `untilMs` is measured from when the poll STARTED, not from the last response,
 * so a slow response cannot stretch the schedule past the budget — the budget is
 * a promise about how long an operator waits, not about how many requests fit in
 * a five-minute window.
 */
const CADENCE: readonly { readonly untilMs: number; readonly everyMs: number }[] = [
  // The common case: the device reports within a snapshot or two, and the
  // operator is still watching. Frequent, and short, so it costs ~10 reads.
  { untilMs: 20_000, everyMs: 2_000 },
  // Probably not going to happen, but not yet knowable. ~14 reads.
  { untilMs: 90_000, everyMs: 5_000 },
  // Not going to happen. Confirmation arriving now would be a surprise, so the
  // reads are a courtesy rather than an expectation. ~11 reads.
  { untilMs: 300_000, everyMs: 20_000 },
];

/** The whole watch, in wall-clock terms. Past this the answer is "not yet". */
export const COMMAND_POLL_BUDGET_MS = CADENCE[CADENCE.length - 1].untilMs;

/**
 * Consecutive failures before the watch gives up.
 *
 * Not a rate limit, and not a retry policy: a service that is down is failing
 * for reasons polling cannot fix, and three in a row is enough to say so. Stopping
 * early is the safer error here — an unreachable service is a claim about the
 * cabinet, and the last good read is a better thing to keep on screen than an
 * empty space that keeps flickering.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/** The read interval for a poll that has been running `elapsedMs`. Null once past the budget. */
function intervalFor(elapsedMs: number): number | null {
  for (const step of CADENCE) {
    if (elapsedMs < step.untilMs) return step.everyMs;
  }
  return null;
}

interface PollState {
  /** `dev/uid`, so a state can never be shown under a different command's key. */
  readonly key: string;
  readonly data: CommandStatusResponse | null;
  readonly error: ApiError | null;
  readonly failures: number;
  readonly attempts: number;
  /** True when no further request will be made by this poll. */
  readonly stopped: boolean;
}

const IDLE: PollState = { key: '', data: null, error: null, failures: 0, attempts: 0, stopped: true };

export interface CommandPoll {
  /** The last read that succeeded. Held across reloads, so the notice does not flicker. */
  readonly data: CommandStatusResponse | null;
  /** The last failure, kept beside the data rather than replacing it. */
  readonly error: ApiError | null;
  readonly attempts: number;
  /** True while the watch is running: a request is in flight or one is scheduled. */
  readonly polling: boolean;
  /** True when the watch has stopped for a reason other than an answer. */
  readonly gaveUp: boolean;
  /** Re-reads once, then resumes watching if the answer is still not in. */
  readonly reload: () => void;
}

/**
 * Watch the command for `uid` on `dev`. `uid` of `null` watches nothing, which is
 * how the caller says there is no command to follow.
 */
export function useCommandStatus(dev: string, uid: string | null): CommandPoll {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<PollState>(IDLE);

  const key = uid === null ? '' : `${dev}/${uid}`;

  useEffect(() => {
    if (uid === null) {
      setState(IDLE);
      return;
    }
    // Narrowed into a const so the nested `read` below can close over it. A
    // parameter keeps its declared `string | null` inside a function expression
    // even after the guard above, because the callee could be reached again.
    const commandUid = uid;

    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let attempts = 0;
    let stopped = false;
    const startedAt = Date.now();
    // One controller for the whole watch rather than one per request: aborting on
    // cleanup should cancel the request in flight too, and a `setTimeout` chain
    // has no request to cancel between reads.
    const controller = new AbortController();

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const schedule = (): void => {
      const elapsed = Date.now() - startedAt;
      const interval = intervalFor(elapsed);
      if (interval === null) {
        stopped = true;
        setState((prev) => ({ ...prev, stopped: true }));
        return;
      }
      // Clamp to what is left of the budget. Without this the read at 4:55 is
      // scheduled 20s out and lands at 5:15, so a "stops after 5 minutes" watch
      // quietly runs for 5:15 — and on the next schedule the budget looks spent,
      // which is how an overrun hides itself. Clamping puts the final read
      // exactly on the boundary and ends the watch there.
      timer = setTimeout(read, Math.min(interval, COMMAND_POLL_BUDGET_MS - elapsed));
    };

    function read(): void {
      if (!live || stopped) return;
      attempts += 1;
      getCommandStatus(dev, commandUid, { signal: controller.signal }).then(
        (data) => {
          if (!live) return;
          failures = 0;
          // A terminal state, or no history at all, is an answer. Continuing past
          // either would be asking a settled question repeatedly.
          stopped = isTerminalCommandState(data.state) || data.state === null;
          setState({ key, data, error: null, failures: 0, attempts, stopped });
          if (!stopped) schedule();
        },
        (cause: unknown) => {
          if (!live) return;
          const error = toApiError(cause);
          // Our own cancellation: the component unmounted or the command changed.
          // Counting it as a failure would stop the NEXT watch for something that
          // was never actually asked.
          if (error.code === 'aborted') return;
          failures += 1;
          if (failures >= MAX_CONSECUTIVE_FAILURES) stopped = true;
          // The previous read stays on screen: "still dispatched, and the last
          // check did not get through" is both true and more useful than either
          // half alone.
          setState((prev) => ({
            key,
            data: prev.key === key ? prev.data : null,
            error,
            failures,
            attempts,
            stopped,
          }));
          if (!stopped) schedule();
        },
      );
    }

    read();

    return () => {
      live = false;
      clearTimer();
      controller.abort();
    };
    // `key` rather than `dev` and `uid` separately: it changes exactly when the
    // command being watched changes, and it is the value the state is filed
    // under, so the two cannot drift apart.
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return useMemo(() => {
    // Never show one command's answer under another's. On a key change the
    // previous state is unreachable until the first read for the new one lands.
    const current = state.key === key ? state : IDLE;
    return {
      data: current.data,
      error: current.error,
      attempts: current.attempts,
      polling: current.key === key && !current.stopped,
      gaveUp: current.key === key && current.stopped && current.error !== null,
      reload,
    };
  }, [state, key, reload]);
}

/**
 * Whether the last read settled the question, and how.
 *
 * The three ways a watch can be over that are not an error, kept apart because
 * they are three different things to tell an operator:
 *
 *   - `confirmed` / `expired` / `failed` — the service answered.
 *   - `no-history` — answered `state: null`: nothing was ever dispatched here.
 *     That is a real answer, and rendering it as "in flight" would be inventing
 *     a command that does not exist.
 *   - `watching` — genuinely still unknown, and the only state that may be
 *     described as in flight.
 */
export type CommandPhase =
  | { readonly kind: 'watching'; readonly data: CommandStatusResponse }
  | { readonly kind: 'resolved'; readonly data: CommandStatusResponse }
  | { readonly kind: 'no-history'; readonly data: CommandStatusResponse }
  | { readonly kind: 'unread' }
  /**
   * A read did not get through. `data` is the last read that did — kept rather
   * than dropped, because "the service says it is still dispatched, and the
   * check I just made failed to arrive" is both true and more useful than either
   * half alone, and blanking the first half on the second would be a flicker
   * caused by a problem the notice is meant to be explaining.
   */
  | { readonly kind: 'gave-up'; readonly data: CommandStatusResponse | null; readonly error: ApiError };

export function commandPhase(poll: CommandPoll): CommandPhase {
  const { data, error } = poll;
  if (error !== null) return { kind: 'gave-up', data, error };
  if (data === null) return { kind: 'unread' };
  if (isTerminalCommandState(data.state)) return { kind: 'resolved', data };
  if (data.state === null) return { kind: 'no-history', data };
  // The read got through and the answer is "not yet". Carries the data, because
  // the notice has something to show even while the answer is still pending: the
  // command's own record, and the wording for a state this build may not know.
  return { kind: 'watching', data };
}
