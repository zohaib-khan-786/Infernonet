/**
 * The per-item freshness verdict, with its two evidence layers side by side.
 *
 * ===========================================================================
 * THE ONE RULE THIS FILE EXISTS TO KEEP
 * ===========================================================================
 *
 * There is one thermometer, one humidity sensor, one MQ-135 and one door reed in
 * this product, and every one of them measures CABINET AIR. The system cannot
 * measure an individual item's temperature, and the backend says so per item:
 * `item_temperature_measured` is emitted as a hard `false` from a literal, and
 * `evidence.cabinet_derived.attribution` spells out why in plain words.
 *
 * So this file renders NO SENSOR NUMBER AT ALL inside an item card. Not a
 * temperature, not a humidity, not a gas figure, not a "±2 °C" reassurance. The
 * measured numbers live in `CabinetConditionPanel.tsx`, where every one of them
 * is labelled as cabinet air. The reason is not squeamishness: a card is a thing
 * that gets screenshotted, pasted into a chat, cropped and forwarded. A card
 * that said "Milk — 7.2 °C" would survive that trip as a claim about a jug of
 * milk, and nothing in the crop would be left to correct it. A card that says
 * what the cabinet was like, and states in full that the item was never measured,
 * survives the same trip intact.
 *
 * Three structural consequences, each of them load-bearing:
 *
 *   1. `ItemVerdictCard` refuses to render at all if
 *      `item_temperature_measured` is anything other than `false`. The type says
 *      it cannot happen; this says it must not happen anyway, because a type is
 *      a promise and a runtime check is a gate.
 *   2. The attribution sentence is a plain `<p>` in the DOM, unconditionally, in
 *      the same block as the condition it qualifies. Not a tooltip, not a
 *      `title=`, not a `<details>` someone can collapse, not a page-level
 *      disclaimer, not a footnote under a list. There is no affordance anywhere
 *      in this feature that hides it, and no state — loading, error, empty,
 *      untrusted clock — that renders a verdict without it.
 *   3. The two layers are never interleaved. They are sibling blocks, separated
 *      by a seam and given different edge treatments, so "certain" and "inferred"
 *      are separable at a glance, in greyscale, and in forced colors.
 */
import { memo, useId, type ReactNode } from 'react';
import type { EvidenceLayerId, FreshnessItemVerdict } from '../../api/types';
import { dateTime, number, span } from '../../lib/format';
import { Mark } from '../../components/Mark';
import {
  cabinetConditionPresentation,
  dateLayerPresentation,
  verdictPresentation,
  type LayerPresentation,
} from './verdictPresentation';

/* --- The verdict chip -------------------------------------------------------- */

/**
 * The backend's verdict word, with a shape and a tone.
 *
 * Structurally the same treatment `StatusChip` gives the device's own code —
 * `.chip` plus a `Mark`, with the raw token available — because in this design
 * system a colour that is not accompanied by a shape is not a status.
 */
export const VerdictChip = memo(function VerdictChip({ status }: { readonly status: string }) {
  const presentation = verdictPresentation(status);
  return (
    <span
      className="chip"
      data-tone={presentation.tone}
      title={`Service verdict: ${presentation.token}`}
    >
      <Mark shape={presentation.shape} className="mark--sm" />
      {presentation.label}
    </span>
  );
});

/** The status word the backend actually used, always visible beside the readable one. */
function Token({ token }: { readonly token: string }) {
  return <span className="chip chip--plain">{token}</span>;
}

/* --- The two layers --------------------------------------------------------- */

/** The block shell. `data-layer` is what the stylesheet keys the two treatments off. */
function Layer({
  id,
  kind,
  layerId,
  forcedBy,
  presentation,
  eyebrow,
  title,
  children,
}: {
  readonly id: string;
  readonly kind: 'date' | 'cabinet';
  /** This block's own layer id, compared against `forcedBy` to decide the marker. */
  readonly layerId: EvidenceLayerId;
  /** The layer that forced the blended status, or null when neither did. */
  readonly forcedBy: EvidenceLayerId | null;
  readonly presentation: LayerPresentation;
  readonly eyebrow: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const forced = forcedBy === layerId;
  return (
    <section className="layer" data-layer={kind} data-tone={presentation.tone} aria-labelledby={`${id}-${kind}-title`}>
      <div className="layer__head">
        <p className="layer__eyebrow">
          <Mark shape={presentation.shape} className="mark--sm" />
          {eyebrow}
        </p>
        <h5 className="layer__title" id={`${id}-${kind}-title`}>
          {title}
        </h5>
        <p className="layer__verdict">
          <Token token={presentation.token} />
          <span className="layer__verdict-label">{presentation.label}</span>
        </p>
        {forced ? (
          <p className="layer__forced">
            This is the layer that forced the verdict: <code className="num">{layerId}</code>
          </p>
        ) : null}
      </div>
      <div className="layer__body">{children}</div>
    </section>
  );
}

/**
 * LAYER 1 — the certain half.
 *
 * Arithmetic on the item's own registered epochs. No sensor is involved, so no
 * sensor can be wrong about it, and it is independent of the cabinet entirely —
 * which is why it is still reported when the cabinet half is unavailable.
 *
 * Everything here is a fact the device registered, echoed back. Nothing is
 * recomputed from the browser clock: `days_remaining` and `days_overdue` are the
 * engine's arithmetic, and the browser's clock never enters this file.
 *
 * A withheld number renders as the word "withheld" and the backend's own `note`,
 * never as a zero and never as an empty bar — a withheld "days remaining" shown
 * as `0` reads as "expired now", which is the exact opposite of what was said.
 */
const DateLayer = memo(function DateLayer({
  entry,
  id,
}: {
  readonly entry: FreshnessItemVerdict;
  readonly id: string;
}) {
  const date = entry.evidence.date_derived;
  const presentation = dateLayerPresentation(date);
  const useSoon = date.use_soon_percent;
  const percent = date.progress_percent;

  return (
    <Layer
      id={id}
      kind="date"
      layerId="date_derived"
      forcedBy={entry.forced_by}
      presentation={presentation}
      eyebrow="Layer 1 of 2 · certain"
      title="From the item's own dates"
    >
      <p className="layer__note">
        No sensor is involved in this block. It is arithmetic on values the device registered for this item, and it
        holds whatever the cabinet is doing.
      </p>

      <dl className="layer__facts">
        <div className="layer__fact">
          <dt>Decided by</dt>
          <dd>
            <code className="num">{date.driving_field ?? 'no driving field'}</code>
          </dd>
        </div>
        <div className="layer__fact">
          <dt>Rule applied</dt>
          <dd>{date.driving_rule}</dd>
        </div>
        <div className="layer__fact">
          <dt>Registered deadline</dt>
          <dd>
            {date.deadline === null ? (
              <span className="withheld__value">none registered</span>
            ) : (
              <span className="num">{dateTime(date.deadline)}</span>
            )}
          </dd>
        </div>
        <div className="layer__fact">
          <dt>Days remaining</dt>
          <dd>
            {date.days_remaining === null ? (
              <span className="withheld__value">withheld</span>
            ) : (
              <>
                <span className="num">{number(date.days_remaining, 1)}</span> days
              </>
            )}
          </dd>
        </div>
        <div className="layer__fact">
          <dt>Days overdue</dt>
          <dd>
            {date.days_overdue === null ? (
              <span className="withheld__value">withheld</span>
            ) : date.days_overdue > 0 ? (
              <>
                <span className="num">{number(date.days_overdue, 1)}</span> days overdue
              </>
            ) : (
              'not overdue'
            )}
          </dd>
        </div>
        <div className="layer__fact">
          <dt>Registered window</dt>
          <dd>{span(date.window_seconds)}</dd>
        </div>
      </dl>

      {/* The meter is the existing vocabulary. Its fill width is the engine's own
          `progress_percent` and its notch is positioned from the engine's own
          `use_soon_percent` rather than from the 75% the stylesheet defaults to —
          a notch at a threshold the backend did not send would be a number this
          page invented. */}
      {percent === null ? (
        <div className="meter meter--withheld">
          <div className="meter__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuetext="not computed">
            {useSoon === null ? null : <span className="meter__notch" style={{ insetInlineStart: `${useSoon}%` }} aria-hidden="true" />}
          </div>
          <p className="meter__scale">
            <span className="withheld__value">elapsed share not computed</span>
          </p>
        </div>
      ) : (
        <div className="meter">
          <div
            className="meter__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-valuetext={`${number(percent, 1)}% of the registered storage window has elapsed${
              useSoon === null ? '' : `; the use-soon point is ${number(useSoon, 0)}%`
            }.`}
          >
            <span className="meter__fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
            {useSoon === null ? null : <span className="meter__notch" style={{ insetInlineStart: `${useSoon}%` }} aria-hidden="true" />}
          </div>
          <p className="meter__scale">
            <span className="meter__value">{number(percent, 1)}%</span>
            <span>{useSoon === null ? 'of the window elapsed' : `use-soon at ${number(useSoon, 0)}%`}</span>
          </p>
        </div>
      )}

      <p className="layer__reason">{date.reason}</p>
      {date.note === null ? null : <p className="layer__caveat">{date.note}</p>}
    </Layer>
  );
});

/**
 * LAYER 2 — the inferred half.
 *
 * This is where the honesty work happens, and it happens unconditionally.
 *
 *   - The condition is a fact about the CABINET, and the block says so in its
 *     eyebrow, its title and its `measured` field.
 *   - The attribution sentence is rendered in full, here, on this item, on every
 *     render. It is not behind a toggle, not a tooltip, not a footnote, and not
 *     shared once at the page level. `attribution` is a required field on the
 *     type, so this paragraph cannot be conditionally omitted.
 *   - The backend's own `reason` for the condition is quoted verbatim rather than
 *     summarised, because that sentence's subject is "cabinet air" and a
 *     paraphrase is exactly where a per-item claim creeps back in.
 */
const CabinetLayer = memo(function CabinetLayer({
  entry,
  id,
}: {
  readonly entry: FreshnessItemVerdict;
  readonly id: string;
}) {
  const cabinet = entry.evidence.cabinet_derived;
  const presentation = cabinetConditionPresentation(cabinet.condition);

  return (
    <Layer
      id={id}
      kind="cabinet"
      layerId="cabinet_derived"
      forcedBy={entry.forced_by}
      presentation={presentation}
      eyebrow="Layer 2 of 2 · inferred"
      title="From the cabinet this item shares"
    >
      <p className="layer__note">
        Measured of <strong>cabinet air</strong> — the air inside the storage cabinet, shared by everything in it.
        It is an inference about this item, never a measurement of it.
      </p>

      <dl className="layer__facts">
        <div className="layer__fact">
          <dt>Cabinet condition</dt>
          <dd>
            <Token token={cabinet.condition} />
          </dd>
        </div>
        <div className="layer__fact">
          <dt>What the sensors measured</dt>
          <dd>
            <code className="num">{cabinet.measured}</code>
          </dd>
        </div>
        <div className="layer__fact">
          <dt>Carried the verdict</dt>
          <dd>{cabinet.used_in_status ? 'yes — this layer forced the verdict' : 'no — the verdict came from the other layer or was not reached'}</dd>
        </div>
      </dl>

      <p className="layer__reason">{cabinet.reason}</p>

      {/*
        THE ATTRIBUTION SENTENCE.

        Unconditional. No disclosure element, no `title`, no tooltip, no "show
        details" affordance, no `useState`, no `hidden`, no `aria-expanded`. If
        this element were ever given a way to stop rendering, the whole feature
        would be broken, so there is deliberately no code path here that could.
      */}
      <p className="layer__attribution">{cabinet.attribution}</p>

      <p className="layer__caveat">{cabinet.note}</p>
    </Layer>
  );
});

/* --- The device's own guess ------------------------------------------------- */

/**
 * `device_provisional`, and it is not the verdict.
 *
 * The backend keeps this field for traceability and states that it is inferred
 * from the same cabinet air this engine reads, which is why it cannot tell one
 * item from another in the same cabinet. It is shown in its own block, below the
 * two evidence layers, wearing the plain diamond no verdict uses and the blue
 * administrative slate — because a device's guess is not a finding about food
 * and must not borrow the shape of one.
 */
const DeviceProvisionalBlock = memo(function DeviceProvisionalBlock({ entry }: { readonly entry: FreshnessItemVerdict }) {
  const provisional = entry.device_provisional;
  return (
    <aside className="provisional" data-tone="admin" aria-label={`Device's own status for ${entry.name}, not authoritative`}>
      <p className="provisional__kind">
        <Mark shape="diamond" className="mark--sm" />
        Reported by the device · not authoritative
      </p>
      <p className="provisional__value">
        {provisional.label === null ? (
          <span className="withheld__value">the device reported no status for this item</span>
        ) : (
          <>
            <span className="provisional__label">{provisional.label}</span>
            <span className="chip chip--plain">
              status_code {provisional.status_code === null ? 'none' : provisional.status_code}
            </span>
          </>
        )}
      </p>
      <p className="provisional__note">{provisional.basis}</p>
      <p className="provisional__note">{provisional.note}</p>
    </aside>
  );
});

/* --- The card --------------------------------------------------------------- */

/**
 * One item's verdict.
 *
 * Reads top to bottom as: what the service decided, then the certain half, then
 * the inferred half, then the device's own non-authoritative guess. The two
 * evidence blocks are siblings separated by a seam — never a tab, never a
 * toggle, because a reader who only ever opens the first tab would be reading
 * one layer and believing it was both.
 */
export const ItemVerdictCard = memo(function ItemVerdictCard({ entry }: { readonly entry: FreshnessItemVerdict }) {
  const id = useId();
  const presentation = verdictPresentation(entry.status);

  // The gate. The wire type says this field is the literal `false` and the
  // backend emits it from a literal, so a `true` is a service this dashboard was
  // not written against. It is checked anyway: if it ever arrives, the item's
  // evidence is not rendered at all rather than rendered under a card that
  // implies it was measured.
  const claimsMeasurement = (entry.item_temperature_measured as boolean) === true;

  return (
    <article className="verdict-card" data-tone={presentation.tone} aria-labelledby={`${id}-name`}>
      <header className="verdict-card__head">
        <div className="verdict-card__id">
          <h4 className="verdict-card__name" id={`${id}-name`}>
            {entry.name}
          </h4>
          <p className="verdict-card__uid">
            UID <span className="num" translate="no">{entry.uid}</span>
          </p>
        </div>
        <div className="verdict-card__status">
          <VerdictChip status={entry.status} />
          <Token token={entry.status} />
        </div>
      </header>

      <p className="verdict-card__meaning">{presentation.meaning}</p>
      <p className="verdict-card__reason">{entry.reason}</p>

      {/*
        `forced_by` is stated ONCE, and it is stated on the layer that did the
        forcing — `layer__forced` inside each block. Putting it here as well
        would be the same sentence twice, and a reader who saw it here would still
        have to look at the two blocks to find out which one it referred to. When
        neither layer forced it, nothing is claimed, which is the honest reading of
        `forced_by: null`.
      */}

      {/*
        `insufficient_data`, stated as its own thing rather than left to the chip
        to carry. Two requirements meet here and neither is a styling problem:

          it must NEVER read as fresh  — so the hatched diamond (the same mark the
            device uses for "could not evaluate"), the cold sensor-fault slate, and
            a sentence that says in words that this is the absence of a finding.
            `fresh` is a different word, a different shape and a different tone,
            and the two never share a row.

          it must NAME the missing input — so `entry.reason` is quoted, which is the
            service's own blend reason and which names the absent layer and why
            ("date layer: …; cabinet layer: …"). The page does not decide which
            input was missing, because that is the engine's call and it already
            made it in words.
      */}
      {entry.status === 'insufficient_data' ? (
        <p className="verdict-card__insufficient" data-tone="unknown">
          <Mark shape="hatched-diamond" className="mark--sm" />
          <span>
            <strong>Not enough input to judge this item.</strong> It is reported as <code className="num">insufficient_data</code>{' '}
            and never as fresh, because a missing input must only ever reduce the confidence of a good result — it must
            never manufacture a clean one. What is missing, in the service&apos;s words: {entry.reason}
          </span>
        </p>
      ) : null}

      {claimsMeasurement ? (
        <div className="notice" data-kind="service" role="group" aria-label="Unexpected freshness evidence">
          <Mark shape="diamond" className="mark--lg" />
          <div>
            <p className="notice__title">This service claims it measured this item&apos;s temperature</p>
            <div className="notice__body">
              <p>
                FreshGuard has one thermometer, and it is inside the cabinet measuring the air. The dashboard is written
                against a service that states <code className="num">item_temperature_measured: false</code> on every
                item, so no evidence is shown for {entry.name} rather than shown under a claim the hardware cannot
                support.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="verdict-card__layers">
          <DateLayer entry={entry} id={id} />
          <CabinetLayer entry={entry} id={id} />
        </div>
      )}

      <DeviceProvisionalBlock entry={entry} />
    </article>
  );
});
