/**
 * Banners that outrank the panels.
 *
 * Two exist, and the reason each is loud is different:
 *
 *   ClockBanner  The device clock is not trusted, so the service withholds every
 *                duration and expiry judgement. This is the most misleading
 *                state in the product: the food may be fine, the device may
 *                even be reporting Check Food, and nothing about timing can be
 *                trusted. It is a device-health problem, so it is amber, not
 *                red — but it is not dismissible and it sits above everything.
 *
 *   LinkNotice   The ingest link dropped or went quiet. That is a fact about the
 *                network, never about the food, so it stays neutral, it carries
 *                the service's own `transport.note`, and it stays out of the
 *                food-status list entirely.
 *
 * WHY `data-kind` AND WHY A VISIBLE KIND LINE
 * -----------------------------------------------------------------------------
 * Both banners set `data-tone`, and `warn` is also the tone of a `use_soon`
 * verdict. Styling alone therefore cannot separate "I cannot judge this food"
 * from "this food is fine" — and that separation is the single most important
 * thing on the screen. Three signals carry it, and all three are needed:
 *
 *   1. `data-kind` drives the edge treatment, which is a *shape of rule* and
 *      not a hue: a verdict gets a 5px solid bar, the clock fault a 6px double
 *      rule, the link notice a 1px hairline. A double rule is how an instrument
 *      marks a caution lamp differently from an alarm lamp, and it survives
 *      greyscale and colour blindness intact.
 *   2. The `.banner__kind` line states the kind in plain words, so the edge is
 *      never the only thing carrying the distinction.
 *   3. The titles and bodies already say it in full sentences, and they are
 *      left as they are.
 *
 * The mark shape is deliberately unchanged: the clock fault keeps the triangle
 * and the amber tint the design system's wireframes specify (DESIGN_SYSTEM.md
 * §8.2), because the edge plus the words are what separate it from a verdict,
 * not the colour.
 *
 * WHY THESE ARE NOT LIVE REGIONS, AND WHAT IS INSTEAD
 * -----------------------------------------------------------------------------
 * Both banners were `role="note"` with no `aria-live`, and the only live region
 * in the product is the verdict announcer in StatusBand.tsx - which fires when
 * `overall.label` or `zone.label` changes. A dead ingest link changes neither.
 * So at the exact moment every number on the page became stale, the one thing
 * a screen-reader user was told was: nothing.
 *
 * The obvious repair - make the banner itself a live region - is wrong here,
 * and wrong for a specific reason rather than a general one. These states
 * PERSIST. A dead link is a banner on screen for as long as the link is down,
 * and the live feed flaps between live, reconnecting and down while it is.
 * Promoting the whole banner to a live region makes every re-render and every
 * title change an utterance, and the banner is three paragraphs long: a
 * volunteer would be read a hundred words about the network, repeatedly, while
 * trying to read a verdict about the food. That is worse than silence,
 * because it teaches people to switch live regions off.
 *
 * So the split is:
 *
 *   the visible banner   static prose in a labelled region. Still there to be
 *                        read, navigated to, and read again. It announces
 *                        nothing on its own.
 *   one short live
 *   region               MonitorAnnouncer, below. Carries one sentence, and
 *                        only writes when the state it describes actually
 *                        changes.
 *
 * POLITENESS, and why. `role="status"` + `aria-live="polite"`, so the message
 * queues behind whatever is being spoken instead of cutting it off.
 *
 * The case for `assertive` is real: a stale link means the numbers below are
 * out of date, and a volunteer acting on a stale "Fresh" is the worst outcome
 * this interface can produce. But urgency is an argument about *how often*, not
 * about *politeness*, and here the two come apart. Assertive is for a message
 * that must land before the current utterance finishes; this one is about a
 * condition that has no deadline, that is already on screen, that is already
 * in the sticky masthead as a lamp, and that the user will be told about the
 * instant they finish speaking. Interrupting a half-spoken verdict to say "the
 * connection is slow" is a worse failure than saying it four seconds later,
 * and the verdict is the thing that must not be interrupted. The discipline
 * that makes this safe is the trigger, not the politeness: `polite` with
 * once-per-transition cannot spam, and `assertive` with once-per-transition
 * would be defensible too. Polite is chosen because the message is never
 * time-critical and is always available elsewhere.
 */
import { memo, useEffect, useRef, useState } from 'react';
import type { StreamState, } from '../store/DashboardProvider';
import type { Transport } from '../api/types';
import { ago } from '../lib/format';
import { Mark } from './Mark';

export const DeviceClockBanner = memo(function DeviceClockBanner() {
  return (
    <section className="banner" data-tone="warn" data-kind="device" aria-labelledby="clock-banner-title">
      <p className="banner__mark">
        <Mark shape="triangle" className="mark--lg" />
      </p>
      <div>
        <p className="banner__kind">Device fault. This is about the monitor, not about the food.</p>
        <h2 className="banner__title" id="clock-banner-title">
          The device clock is not trusted, so storage times cannot be judged
        </h2>
        <div className="banner__body">
          <p>
            Until the device&apos;s clock is trusted, the service withholds how long each item has been stored, how long
            is left, and how much of its window has passed. Those figures appear as <em>withheld</em> rather than as
            zero, because a duration worked out from a bad clock is worse than no duration at all.
          </p>
          <p>
            This is a fault in the monitor, not a verdict about the food. The device is currently reporting its own
            status as <strong>Sensor Fault / Data Unavailable</strong> for that reason.
          </p>
          <p>
            To fix it: check the RTC backup battery and confirm the device can reach a time source. Times shown in this
            dashboard come from the service, not the device, so the log and the charts are still readable.
          </p>
        </div>
      </div>
    </section>
  );
});

export interface LinkNoticeProps {
  readonly transport: Transport | null;
  /**
   * Whether the newest frame this page holds is older than the service's own
   * staleness limit — MEASURED against the browser clock, not read from
   * `transport.stale`.
   *
   * That distinction is the whole reason this prop exists. `transport.stale` is
   * the service's comparison, performed at the instant it built the frame, and
   * it is a photograph: it does not move when the device stops, and the next
   * frame that would update it only arrives if the device reports, which is
   * exactly the case where it does not. So the banner and the sticky lamp
   * disagreed — the lamp said Offline because it measures, the banner said
   * nothing because it believed the photograph — and on a monitoring screen a
   * missing banner is a screen claiming the numbers below are live. See
   * `lib/freshness.ts`, which is the one place the measurement lives.
   */
  readonly stale: boolean;
  readonly streamState: StreamState;
  readonly streamNote: string | null;
}

/**
 * True when the link banner is on screen.
 *
 * One predicate, used by both the banner and the announcer, because the two
 * must never be able to describe different states: a live region that
 * announces "no new data" while the page shows nothing wrong is worse than
 * saying nothing at all.
 */
function linkDegraded(stale: boolean, streamState: StreamState): boolean {
  return !(streamState === 'live' && !stale);
}

export const LinkNotice = memo(function LinkNotice({ transport, stale, streamState, streamNote }: LinkNoticeProps) {
  if (!linkDegraded(stale, streamState)) return null;

  const title =
    streamState === 'failed'
      ? 'The live feed is not connected'
      : streamState === 'reconnecting'
        ? 'The dashboard is reconnecting to the live feed'
        : 'No new data is arriving from the device';

  return (
    <section className="banner" data-tone="neutral" data-kind="transport" aria-labelledby="link-banner-title">
      <p className="banner__mark">
        <Mark shape="circle" className="mark--lg" />
      </p>
      <div>
        <p className="banner__kind">Link status. This is about the connection, not about the food.</p>
        <h2 className="banner__title" id="link-banner-title">
          {title}
        </h2>
        <div className="banner__body">
          <p>
            {streamNote ?? 'Everything below is the last data the service received.'}
            {transport === null ? null : ` Last accepted snapshot ${ago(transport.age_seconds)}.`}
          </p>
          <p>
            <strong>This says nothing about the food.</strong> It is a statement about the connection between the
            device and this service, and it never changes the verdict the device reported.
          </p>
        </div>
      </div>
    </section>
  );
});

/* --- The announcement ------------------------------------------------------- */

/**
 * One sentence describing the combined state of the two banners, built from
 * the two booleans that drive them, so every combination has a wording and
 * none of them has to be re-derived at the call site.
 *
 * Both parts of the sentence that matters are in every branch: what changed,
 * and that it is not about the food. The last clause is the safety argument,
 * and it is not the one to abbreviate.
 */
function describe(clockTrusted: boolean, degraded: boolean): string {
  if (clockTrusted && !degraded) {
    return 'The monitor is live again: the device clock is trusted and new data is arriving, so the figures on this page are current.';
  }

  const what: string[] = [];
  if (!clockTrusted) {
    what.push('the device clock is not trusted, so storage times cannot be judged and every time remaining and progress figure is withheld');
  }
  if (degraded) {
    what.push('no new data is arriving from the device, so everything on this page is the last data the service received');
  }

  const notAboutFood =
    what.length > 1
      ? 'Neither says anything about the food or changes the verdict the device reported.'
      : clockTrusted
        ? 'It says nothing about the food and never changes the verdict the device reported.'
        : 'It is a fault in the monitor, not a verdict about the food.';

  return `New: ${what.join(', and ')}. ${notAboutFood}`;
}

export interface MonitorAnnouncerProps {
  /** The same predicate the clock banner is rendered on. */
  readonly clockTrusted: boolean;
  readonly transport: Transport | null;
  /** Measured, for the same reason as on `LinkNotice`. */
  readonly stale: boolean;
  readonly streamState: StreamState;
}

/**
 * Announces the arrival and the clearing of each of the two conditions. Once
 * per transition, never once per snapshot.
 *
 * The trigger discipline is the whole of it, and it is two rules:
 *
 *   1. The state is TWO BOOLEANS, not a string. `linkDegraded` deliberately
 *      collapses live / reconnecting / stale / failed into one bit, because
 *      those four flap while a link is down. Keying the announcement on
 *      `streamState` would mean re-announcing the same fact every time the
 *      browser retried an SSE connection, which is the "assertive region that
 *      fires on every snapshot" failure wearing a different hat.
 *
 *   2. The previous value is seeded on the FIRST run, so mounting the page
 *      says nothing. A live region populated at mount is not reliably
 *      announced by every screen reader anyway, and a cold load on an
 *      already-stale link does not need one: the banner is the second thing on
 *      the page and the masthead lamp says it. What needs announcing is the
 *      TRANSITION, and that is exactly what fires.
 *
 * `aria-atomic` so the whole sentence is read rather than the diff from
 * whatever was there before, which would be a fragment.
 */
export const MonitorAnnouncer = memo(function MonitorAnnouncer({ clockTrusted, transport, stale, streamState }: MonitorAnnouncerProps) {
  const [message, setMessage] = useState('');
  const previous = useRef<{ clockTrusted: boolean; degraded: boolean } | null>(null);

  useEffect(() => {
    const next = { clockTrusted, degraded: linkDegraded(stale, streamState) };
    const last = previous.current;
    previous.current = next;
    if (last === null) return;
    if (last.clockTrusted === next.clockTrusted && last.degraded === next.degraded) return;
    setMessage(describe(next.clockTrusted, next.degraded));
  }, [clockTrusted, transport, streamState]);

  return (
    <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
});
