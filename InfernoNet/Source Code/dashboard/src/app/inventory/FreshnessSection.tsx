/**
 * The freshness verdict, as a whole.
 *
 * ===========================================================================
 * WHERE THIS RENDERS AND WHY
 * ===========================================================================
 *
 * On the existing Food & Inventory page, between the summary and the item table.
 * Not a new route: this build's route table, sidebar and navigation list are one
 * set of names kept in step across three files, and adding a destination to two
 * of them and not the third is how a dashboard grows a link that goes nowhere.
 * The verdict also belongs next to the thing it is about — a volunteer asking "is
 * this milk fine" is on this page, not hunting for a second one — and beside the
 * inventory table, which carries the device's own record of the same items.
 *
 * So the page now answers two questions in order: what did the SERVICE conclude
 * (this section, two evidence layers per item) and what did the DEVICE report
 * (the existing table, unchanged). The two are never merged into one column,
 * because they are different authorities and the difference is the point.
 *
 * ===========================================================================
 * THE FIVE STATES, DESIGNED RATHER THAN IMPROVISED
 * ===========================================================================
 *
 * Offline and stale are the shell's business — `DeviceGate` already renders the
 * link banner and the announcer for every page — so this component handles the
 * four that are its own, each one designed:
 *
 *   loading  one line, and it says what is being loaded and from where.
 *   error    `ErrorNotice`, which is a statement about the service and wears the
 *            instrument-caution treatment. It never wears a food verdict, because
 *            a failed request is not a finding about food.
 *   empty    an invitation that says the list is empty BECAUSE nothing is
 *            registered, and that the cabinet half is still shown above.
 *   stale    the `computed_at` stamp the service sent, plus the measured link
 *            state, so the reader knows this is the last verdict and when it was
 *            made. Never a re-timed one.
 *
 * ===========================================================================
 * clock_trusted: false
 * ===========================================================================
 *
 * This is the state where a UI is most likely to say something it was not told.
 * The engine withholds the whole date layer when the device clock is bad, and a
 * view that "helpfully" computed a day count anyway would produce exactly the
 * confident wrong answer the withholding exists to prevent — a jam stored three
 * years ago reading as stored an hour ago, with nothing about the output looking
 * wrong.
 *
 * So this file does not compute a date verdict, does not fall back to the device's
 * own `derived` block, and does not quietly omit the reason. The notice names
 * `untrustworthy_layers`, names the measured `skew_seconds` against the
 * `max_skew_seconds` tolerance, lists the backend's own `reasons`, quotes its
 * `note`, and says which layers ARE still good — because a response that says
 * "untrustworthy" without also saying what remains is a dead end.
 */
import { memo, useMemo } from 'react';
import type { ApiError } from '../../api/client';
import type { FreshnessItemStatus, FreshnessResponse, Transport } from '../../api/types';
import { dateTime, number, span } from '../../lib/format';
import { Mark } from '../../components/Mark';
import { ErrorNotice, EmptyState, LoadingLine } from '../../components/Notices';
import { useFreshness } from '../../lib/freshness';
import { CabinetConditionPanel } from './CabinetConditionPanel';
import { ItemVerdictCard } from './FreshnessVerdict';
import { thresholdHonesty, severityRuleLabel } from './verdictPresentation';

/* --- The clock notice -------------------------------------------------------- */

/**
 * `clock_trusted: false`, designed as its own state.
 *
 * It is a `banner` rather than a `notice` because it is the most misleading state
 * in the product and it is not dismissible: the food may be fine, the cabinet may
 * be perfect, and every timing on the page is missing. `data-kind="device"` gives
 * it the 6px DOUBLE caution rule, which is a shape and survives greyscale and
 * forced colors — and which no food verdict uses, so it cannot be read as one.
 */
const ClockWithheldBanner = memo(function ClockWithheldBanner({ document }: { readonly document: FreshnessResponse }) {
  const clock = document.clock;
  return (
    <section className="banner" data-tone="warn" data-kind="device" aria-labelledby="fresh-clock-title">
      <p className="banner__mark">
        <Mark shape="triangle" className="mark--lg" />
      </p>
      <div>
        <p className="banner__kind">
          Device fault. This is about the monitor&apos;s clock, not about the food.
        </p>
        <h3 className="banner__title" id="fresh-clock-title">
          The date half of every verdict below is withheld
        </h3>
        <div className="banner__body">
          <p>
            The service computed this document with <code className="num">clock_trusted: false</code> and named the
            layers it would not compute:{' '}
            <strong>{clock.untrustworthy_layers.length === 0 ? 'none named' : clock.untrustworthy_layers.join(', ')}</strong>.
            Nothing on this page shows a day count, a days-remaining figure or a date verdict for an item, because the
            service did not send one. This dashboard does not compute a substitute.
          </p>
          <p>
            Measured disagreement between the device clock and the server:{' '}
            <strong>
              {clock.skew_seconds === null ? 'could not be measured' : `${number(clock.skew_seconds, 0)} s`}
            </strong>
            {clock.skew_seconds === null
              ? ' — the device reported no timestamp to compare against.'
              : `, against a tolerance of ${number(clock.max_skew_seconds, 0)} s. `}
            {clock.reasons.length === 0
              ? 'The service did not name a reason.'
              : `Reason: ${clock.reasons.join(', ')}.`}
          </p>
          <p>
            <strong>Still good:</strong> {clock.trustworthy_layers.join(', ')}. The cabinet layer is measured from server
            receipt times rather than from the device clock, so it is unaffected — which is why each item card below
            shows an inferred cabinet block and a withheld date block rather than nothing at all.
          </p>
          <p>{clock.note}</p>
        </div>
      </div>
    </section>
  );
});

/* --- The disclaimer ---------------------------------------------------------- */

/**
 * `disclaimer`, in the flow of the verdict it is about.
 *
 * Not a footer. The sentence says this verdict is not a food-safety
 * certification, and a disclaimer about the verdict you are currently reading,
 * parked at the bottom of a page behind four panels, is not read. It sits above
 * the item cards, in the neutral administrative slate with the plain diamond, so
 * it is unmistakably a statement about the SCOPE of the claim rather than a
 * finding about the food — `data-kind="scope"` gives it the same double caution
 * rule the service-error notice wears, for the same reason.
 */
const DisclaimerNotice = memo(function DisclaimerNotice({ text }: { readonly text: string }) {
  return (
    <div className="notice" data-kind="scope" data-tone="neutral" role="note" aria-label="What this verdict is not">
      <Mark shape="diamond" className="mark--lg" />
      <div>
        <p className="notice__kind">What this verdict is, and is not. Read this before the items below.</p>
        <div className="notice__body">
          <p>{text}</p>
        </div>
      </div>
    </div>
  );
});

/* --- Blend honesty ----------------------------------------------------------- */

/**
 * Where the limits came from, and what the warning band is.
 *
 * Two claims, both of which look identical on a screen if you only draw the
 * number:
 *
 *   the limit itself     `thresholds.source` is either a configured zone profile
 *                        or `built_in_assumption`. The built-in case is the
 *                        backend's own prototype defaults and is never a cited
 *                        food-safety limit, so it is named as such, in a chip
 *                        that leads with the word, plus the basis and the
 *                        backend's own note.
 *
 *   the warning band     `cabinet.evidence.severity_rules` is a
 *                        `built_in_assumption` BY CONSTRUCTION: a configured
 *                        band has two edges, so a third "warning" state needs a
 *                        stated magnitude, and the backend states its own. It is
 *                        labelled here and again beside the figures it produces
 *                        in the cabinet panel, because a reader who meets the
 *                        margin for the first time in a minutes-out-of-range
 *                        number would otherwise take it for a configured limit.
 */
const BlendHonesty = memo(function BlendHonesty({ document }: { readonly document: FreshnessResponse }) {
  const honesty = thresholdHonesty(document.thresholds.source, document.thresholds.basis);
  const device = document.thresholds.device_applied;
  const rules = document.cabinet.evidence.severity_rules;
  return (
    <>
      <div className="cabinet-stats cabinet-stats--honesty">
        <div className="status-band__stat">
          <span className={`chip${honesty.builtIn ? '' : ' chip--plain'}`} data-tone={honesty.builtIn ? 'admin' : undefined}>
            {honesty.chip}
          </span>
        </div>
        <div className="status-band__stat">
          <span className="status-band__stat-value">{document.thresholds.basis}</span>
          <span className="label">basis</span>
        </div>
        <div className="status-band__stat">
          <span className="status-band__stat-value">
            {document.thresholds.revision === null ? 'no revision' : `r${document.thresholds.revision}`}
          </span>
          <span className="label">profile revision</span>
        </div>
        <div className="status-band__stat">
          <span className="status-band__stat-value">
            {document.thresholds.reference === null ? 'none cited' : document.thresholds.reference}
          </span>
          <span className="label">reference</span>
        </div>
        <div className="status-band__stat">
          <span className="status-band__stat-value">
            {device === null
              ? 'the device reports no thresholds'
              : document.thresholds.device_in_sync === null
                ? 'unknown'
                : document.thresholds.device_in_sync
                  ? 'in sync'
                  : 'out of sync'}
          </span>
          <span className="label">what the device is applying</span>
        </div>
        {/* The warning band, named here as well as in the cabinet panel, because
            this strip is where an operator reads what the numbers were judged
            against and a bare margin would be the one value on it with no source. */}
        <div className="status-band__stat">
          <span className="chip chip--plain" data-tone="admin">
            {severityRuleLabel(rules.margins)}
          </span>
        </div>
      </div>
      <p className="hint">{honesty.statement}</p>
      {document.thresholds.note === null ? null : <p className="hint">{document.thresholds.note}</p>}
      <p className="hint">{document.engine.rule}</p>
    </>
  );
});

/* --- The count strip --------------------------------------------------------- */

const ORDER: readonly FreshnessItemStatus[] = ['check_food', 'use_soon', 'fresh', 'insufficient_data'];

const CountStrip = memo(function CountStrip({ counts }: { readonly counts: Readonly<Record<FreshnessItemStatus, number>> }) {
  return (
    <div className="cabinet-stats">
      {ORDER.map((status) => (
        <div className="status-band__stat" key={status}>
          <span className="status-band__stat-value">{number(counts[status], 0)}</span>
          <span className="label">
            <code className="num">{status}</code>
          </span>
        </div>
      ))}
    </div>
  );
});

/* --- The section ------------------------------------------------------------- */

export interface FreshnessSectionProps {
  readonly document: FreshnessResponse | null;
  readonly transport: Transport | null;
  readonly loading: boolean;
  readonly error: ApiError | null;
  readonly onRetry: () => void;
}

/**
 * Counting what the service sent, and nothing else.
 *
 * A tally over `items` is a rendering concern — how many rows a list has — and it
 * is not a second verdict. The backend computes the same tally in
 * `summarise()` for the inventory endpoint. What must never happen here is a
 * count being used to infer a status: an absent item is not a `fresh` one, and
 * `insufficient_data` is counted in its own right rather than folded away.
 */
function tally(items: FreshnessResponse['items']): Record<FreshnessItemStatus, number> {
  const counts: Record<FreshnessItemStatus, number> = { fresh: 0, use_soon: 0, check_food: 0, insufficient_data: 0 };
  for (const entry of items) {
    if (entry.status in counts) counts[entry.status] += 1;
  }
  return counts;
}

/**
 * Reading order: the same ladder `byUrgency` uses for the device's table, with
 * `insufficient_data` placed between `use_soon` and `fresh`.
 *
 * That position is deliberate and it is the whole point of the ordering. A card
 * that says "could not judge" sorts BELOW a warning and ABOVE a clean bill of
 * health, so a reader working down the page meets every unknown before they meet
 * anything reassuring — and nothing on the screen can be read as "everything
 * below this is fine" while unknowns are still waiting further down.
 *
 * This is ordering, not judgement: the rank comes from the word the service sent
 * and the order it produces is stated on screen. An unrecognised word sorts last
 * and is shown as unrecognised rather than being folded into a rank.
 */
const RANK: Readonly<Record<string, number>> = { check_food: 0, use_soon: 1, insufficient_data: 2, fresh: 3 };

function inReadingOrder(items: FreshnessResponse['items']): FreshnessResponse['items'] {
  return items.toSorted((a, b) => (RANK[a.status] ?? 4) - (RANK[b.status] ?? 4) || a.name.localeCompare(b.name));
}

export function FreshnessSection({ document, transport, loading, error, onRetry }: FreshnessSectionProps) {
  /*
   * The staleness predicate is MEASURED, from the same `measure()` the header lamp
   * and the page-level link banner use — never from `transport.stale`, which is a
   * photograph the service took when it built the frame and which does not move
   * when the device stops. One hook for the whole page, passed in as a boolean,
   * which is the discipline `lib/freshness.ts` asks for.
   */
  const link = useFreshness(transport);
  const counts = useMemo(() => (document === null ? null : tally(document.items)), [document]);

  return (
    <section className="panel" aria-labelledby="freshness-title">
      <div className="panel__head">
        <h2 className="panel__title" id="freshness-title">
          Freshness verdict
        </h2>
        <p className="panel__sub">
          {document === null
            ? 'Computed by the service, from the item’s own dates and from the cabinet’s air'
            : `Computed ${dateTime(document.computed_at)} · ${number(document.items.length, 0)} item${
                document.items.length === 1 ? '' : 's'
              } · window ${document.engine.window_minutes === null ? 'not set' : span(document.engine.window_minutes * 60)}`}
        </p>
        <div className="panel__tools">
          <button type="button" className="btn btn--quiet" onClick={onRetry} disabled={loading}>
            {loading ? 'Re-reading…' : 'Re-read from the service'}
          </button>
        </div>
      </div>

      {error !== null ? (
        <div className="panel__body">
          <ErrorNotice what={`Reading the freshness verdict for ${document?.dev ?? 'this device'}`} error={error} onRetry={onRetry}>
            <p>
              Nothing about the food is implied by this failure. The inventory table further down still shows the
              device&apos;s own record.
            </p>
          </ErrorNotice>
        </div>
      ) : null}

      {error === null && document === null ? (
        loading ? (
          <div className="panel__body">
            <LoadingLine>Reading the freshness verdict from the service…</LoadingLine>
          </div>
        ) : null
      ) : null}

      {document === null ? null : (
        <>
          {document.clock_trusted ? null : (
            <div className="panel__body">
              <ClockWithheldBanner document={document} />
            </div>
          )}

          {/*
            The staleness line. `computed_at` is the service's own stamp, printed
            verbatim; the age beside it is the MEASURED link age, and it is only
            drawn when the link has actually gone quiet. A verdict is recomputed on
            every accepted snapshot, so its age is bounded by the link age — and
            when the link is live this line disappears rather than counting
            upwards, because a number that ticks on its own next to a verdict
            invites a reader to distrust a verdict that is in fact current.
          */}
          {link.stale ? (
            <div className="panel__body">
              <p className="note">
                <strong>Last verdict received.</strong> It was computed by the service at{' '}
                {dateTime(document.computed_at)}
                {transport === null ? '' : ` and no device snapshot has arrived since (${span(link.ageSeconds)} ago).`} No
                new verdict is being computed, and nothing below has been re-timed, smoothed or carried forward.
              </p>
            </div>
          ) : null}

          <div className="panel__body">
            <DisclaimerNotice text={document.disclaimer} />
          </div>

          <div className="panel__body">
            <BlendHonesty document={document} />
            {counts === null ? null : <CountStrip counts={counts} />}
          </div>

          <div className="panel__body">
            <p className="note">
              <strong>Two evidence layers per item, kept apart.</strong> Layer 1 is the item&apos;s own registered dates:
              certain, and no sensor can be wrong about it. Layer 2 is an inference from the cabinet air this item
              shares with everything else in the cabinet. The service blends them into the one verdict above and names
              which layer forced it. The second layer is not a measurement of the item, and each card says so in full.
            </p>
          </div>

          {document.items.length === 0 ? (
            <div className="panel__body">
              <EmptyState title="No items to give a verdict on">
                <p>
                  This device has no active items registered, so the service computed a cabinet condition and nothing
                  else. The cabinet panel below still shows what was measured.
                </p>
                <p>
                  An empty list is not a good result. It means the service had no item to judge — register an item and the
                  verdict appears here on the next snapshot, with no request from this page.
                </p>
              </EmptyState>
            </div>
          ) : (
            <div className="panel__body">
              <div className="verdict-list">
                {inReadingOrder(document.items).map((entry) => (
                  <ItemVerdictCard key={entry.uid} entry={entry} />
                ))}
              </div>
              <p className="hint">
                Ordered for reading, by the service&apos;s own verdict: check_food, then use_soon, then anything it could
                not judge, then fresh. The verdict itself is the service&apos;s; this page only decided which card to
                show first.
              </p>
            </div>
          )}

          <div className="panel__body panel__body--flush">
            <div className="cabinet-conditions">
              <h3 className="cabinet-conditions__title">The measured half: cabinet air, over the exposure window</h3>
              <p className="panel__note-strip">
                Every figure in this section is a measurement of the air inside ONE storage cabinet, shared by every
                item in it. None of them belongs to an individual item, and none of them is a measurement of one. This
                is the only place on the page where a sensor reading is shown at all.
              </p>
              <CabinetConditionPanel cabinet={document.cabinet} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
