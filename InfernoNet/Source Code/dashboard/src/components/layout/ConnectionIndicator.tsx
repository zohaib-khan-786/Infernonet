/**
 * The connection indicator (guide 5).
 *
 * Three states, and the whole job of this component is to never let the fourth
 * one exist:
 *
 *     Online    new data is arriving, and what is on screen is current
 *     Delayed   the numbers are inside the service's own freshness window, but
 *               this page is not receiving, so it cannot promise they stay that way
 *     Offline   either the feed is down, or the newest frame this page holds is
 *               older than the service says staleness begins
 *
 * Plus one state the guide's three do not describe, which is not a fourth
 * verdict but the absence of any of them: `no-data`, before a snapshot has ever
 * arrived. §5 has nothing to say about a device that has never reported, and
 * rendering "Online" there would be the single worst lie in the product.
 *
 * WHY THE AGE IS COMPUTED HERE AND NOT READ FROM `transport.age_seconds`
 * -----------------------------------------------------------------------------
 * `transport.age_seconds` is a number the SERVICE computed at the instant it
 * built the frame. It is correct for that instant and it does not move
 * afterwards: it is a photograph of the age, not a clock. `transport.stale` is
 * the same fact as a boolean, frozen the same way.
 *
 * That matters because of how the failure actually arrives. The device stops
 * reporting. The browser's SSE connection to the service stays OPEN - the
 * service is perfectly healthy, it simply has nothing new to send - so
 * `streamState` stays `live`, no error event fires, and no further snapshot
 * frames arrive to update anything. A lamp reading its own state from those
 * fields would therefore sit on "Live" until the page was reloaded, on a link
 * that had been dead for hours, with the last reading on screen looking exactly
 * as fresh as the one before it. That is the failure guide 5's last line and
 * guide 46 rule 7 exist to prevent.
 *
 * So the shell measures the age itself, from `transport.last_received_at` - a
 * real timestamp the service sent - against the browser's own clock, and
 * compares it to `transport.stale_after_seconds`, which is the SERVICE's
 * staleness limit and not a number invented here. That predicate is the same one
 * the service applies to produce `transport.stale`; this copy of it keeps
 * running between frames, which the server's cannot. No threshold is chosen in
 * this file and no reading is adjusted.
 *
 * WHAT THIS COMPONENT DELIBERATELY DOES NOT SAY
 * -----------------------------------------------------------------------------
 * Nothing about the food. The device is the sole authority on freshness
 * verdicts and this is a fact about a socket. So the lamp takes the transport
 * colours - the data blue, a quiet amber, a plain grey - and never the status
 * palette, where green means the device said `fresh` about stored food and red
 * means `check_food`. A volunteer who has spent a week learning that a green
 * circle means the food is fine must never see one for a network.
 *
 * AND WHY IT IS NOT A LIVE REGION
 * -----------------------------------------------------------------------------
 * This element rewrites itself every second, because the age does. A live region
 * that updates once a second is a screen reader that talks over itself
 * continuously and cannot be interrupted, which is strictly worse than silence.
 * The transitions are announced once, politely, by `MonitorAnnouncer` in the
 * page, and the trigger discipline there is deliberate. This lamp is a
 * persistent readout that a sighted user glances at; it is not the thing that
 * tells a screen-reader user the link died, because Banners.tsx already is.
 */
import { memo } from 'react';
import type { StreamState } from '../../store/DashboardProvider';
import { useDashboard } from '../../store/DashboardProvider';
import type { Transport } from '../../api/types';
import { ago } from '../../lib/format';
import { useNow } from '../../hooks/useNow';

/** The three guide states, plus the one the guide does not describe. */
export type LinkVerdict = 'online' | 'delayed' | 'offline' | 'no-data';

interface LinkPresentation {
  readonly verdict: LinkVerdict;
  /** The `data-link` value the existing `.link-state` vocabulary understands. */
  readonly lamp: 'live' | 'waiting' | 'down';
  /** The word. Never omitted, and never the only thing absent. */
  readonly word: string;
  /** The age, in the guide's own phrasing: "8 sec ago". */
  readonly since: string | null;
  /** The reason, when the reason is not the age. */
  readonly why: string | null;
}

/** How long the newest frame we hold has been held, in seconds. */
function ageSeconds(transport: Transport, now: number): number | null {
  const received = Date.parse(transport.last_received_at);
  if (Number.isNaN(received)) return null;
  return Math.max(0, (now - received) / 1000);
}

/**
 * The whole rule, in one function, in precedence order.
 *
 * Note the order. A dead feed outranks a fresh-looking age, because "this page
 * is not receiving anything" is the more urgent of the two facts and a lamp that
 * preferred the age would say Online for as long as the service's last frame
 * happened to be recent - which for a link that dies cleanly is forever, since
 * nothing will ever replace that frame.
 */
function present(
  snapshotPresent: boolean,
  transport: Transport | null,
  streamState: StreamState,
  now: number,
): LinkPresentation {
  if (!snapshotPresent || transport === null) {
    return {
      verdict: 'no-data',
      lamp: 'down',
      word: 'No data yet',
      since: null,
      why: 'The service has not returned a snapshot for this device.',
    };
  }

  const age = ageSeconds(transport, now);
  const since = age === null ? null : ago(age);

  if (streamState === 'failed') {
    return {
      verdict: 'offline',
      lamp: 'down',
      word: 'Offline',
      since,
      why: 'The service will not stream to this page, so nothing below can be newer than the last frame it sent.',
    };
  }

  if (age !== null && age >= transport.stale_after_seconds) {
    return {
      verdict: 'offline',
      lamp: 'down',
      word: 'Offline',
      since,
      why: `No new data since. The service calls a device stale after ${thresholdText(transport.stale_after_seconds)}.`,
    };
  }

  if (transport.stale) {
    // Unreachable while the rule above holds - the service sets `stale` from the
    // same comparison - and kept anyway so that a disagreement between the
    // service's own word and this copy of its arithmetic surfaces as the
    // service's word rather than being quietly overridden.
    return {
      verdict: 'delayed',
      lamp: 'waiting',
      word: 'Delayed',
      since,
      why: 'The service reports this device as stale.',
    };
  }

  if (streamState === 'reconnecting') {
    return {
      verdict: 'delayed',
      lamp: 'waiting',
      word: 'Delayed',
      since,
      why: 'This page is reconnecting to the live feed, so nothing below will change until it does.',
    };
  }

  if (streamState === 'connecting') {
    return {
      verdict: 'delayed',
      lamp: 'waiting',
      word: 'Delayed',
      since,
      why: 'The live feed is still connecting. This is one direct read of the service, not a live stream.',
    };
  }

  return {
    verdict: 'online',
    lamp: 'live',
    word: 'Online',
    since,
    why: null,
  };
}

/** "90 s" for the threshold sentence, so it is a number and not a raw field. */
function thresholdText(seconds: number): string {
  return seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

export const ConnectionIndicator = memo(function ConnectionIndicator() {
  // The tick is local to this component, so the page below the header does not
  // re-render once a second to keep a lamp honest.
  const now = useNow();
  const { snapshot, streamState } = useDashboard();
  const p = present(snapshot !== null, snapshot?.transport ?? null, streamState, now);

  const title =
    p.why === null
      ? `New data is arriving. Last sync ${p.since ?? 'unknown'}.`
      : `Last sync ${p.since ?? 'unknown'}. ${p.why}`;

  return (
    <span className="link-state" data-link={p.lamp} data-verdict={p.verdict} title={title}>
      <span className="link-state__dot" aria-hidden="true" />
      <span className="link-state__word">{p.word}</span>
      {p.since === null ? null : (
        <span className="link-state__detail">
          {' '}
          &middot; last sync {p.since}
        </span>
      )}
      {p.why === null ? null : <span className="visually-hidden"> {p.why}</span>}
    </span>
  );
});
