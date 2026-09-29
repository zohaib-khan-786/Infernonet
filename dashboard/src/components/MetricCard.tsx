/**
 * A KPI card (guide §7).
 *
 * Two rules decide what this component is allowed to render, and both come from
 * the same place — the product's single-authority rule:
 *
 *   1. THE CARD NEVER INVENTS A STATUS.
 *      §7 wants `Optimal / Warning / Critical / No Data` on a temperature card.
 *      The device reports ONE status, for the whole cabinet, and it is the
 *      authoritative one. So the card shows two separate, separately-labelled
 *      facts and no third:
 *
 *        availability   "reported" or "not reported" — a fact about the payload,
 *                        checkable by looking at the field itself
 *        cabinet status the device's own `zone_status`, marked as the cabinet's
 *                        verdict and not as this measurement's
 *
 *      What is deliberately NOT here is a per-metric verdict computed by
 *      comparing the reading against the configured band. That number would look
 *      like the device's opinion and would not be it, and on the one screen
 *      where somebody is deciding about food, a second softer opinion
 *      disagreeing with the hardware is the specific failure the rest of this
 *      product is built to avoid. The thresholds are still shown — named, with
 *      their source, and never as colour alone — and a reading outside them says
 *      so in words, and then says that what it means for the food is the
 *      device's verdict at the top of the page.
 *
 *   2. A METRIC WITH NO SENSOR IS NOT A CARD WITH A BLANK IN IT.
 *      §7 card 5 is "Pi Temperature", and there is no Pi. The card is still
 *      rendered, in the same place, at the same size, saying what would be
 *      measured and why nothing is reported. It is not a dash, not a zero, and
 *      not a smaller quieter ghost of a card — a ghost reads as a card whose
 *      value failed to load.
 *
 * The whole card is a `<button>` when it opens something, because §8 makes the
 * card the affordance and a div with a click handler is not a control.
 */
import { memo, type ReactNode } from 'react';
import type { StatusBlock } from '../api/types';
import { dateTime, number } from '../lib/format';
import { statusPresentation } from '../lib/status';
import type { LabelledBound, MetricBand, MetricSpec } from '../lib/metrics';
import { Mark } from './Mark';

export interface MetricCardProps {
  readonly metric: MetricSpec;
  /** The reading, or null when the device did not report it. */
  readonly value: number | null;
  /** The secondary reading shown beneath, if the metric has one. */
  readonly secondary: { readonly value: number; readonly label: string; readonly unit: string; readonly digits: number } | null;
  /** The device's own cabinet verdict, shown as the cabinet's verdict. */
  readonly zoneStatus: StatusBlock;
  readonly band: MetricBand | null;
  readonly bounds: readonly LabelledBound[];
  /** Service receipt time of the reading, or null when there is no reading. */
  readonly recordedAt: string | null;
  /**
   * Whether the data on this card is older than the service's own staleness
   * limit. MEASURED against the browser clock, not read from
   * `transport.stale` — that field is the service's comparison performed once
   * and frozen, and it does not move when the device stops. See
   * `lib/freshness.ts`.
   */
  readonly stale: boolean;
  /** `20 min ago`, from the same measurement. */
  readonly lastAccepted: string;
  /** Sparkline body. Null while it loads or when the series has no values. */
  readonly spark: ReactNode;
  /** Conditions that name this metric. Drives the "n conditions" chip. */
  readonly conditionCount: number;
  /** Set when the card opens the metric detail. Omitted for an absent metric. */
  readonly onOpen?: (() => void) | undefined;
}

export const MetricCard = memo(function MetricCard({
  metric,
  value,
  secondary,
  zoneStatus,
  band,
  bounds,
  recordedAt,
  stale,
  lastAccepted,
  spark,
  conditionCount,
  onOpen,
}: MetricCardProps) {
  const zone = statusPresentation(zoneStatus);
  const reported = value !== null;

  // A reading outside the band is a fact about two numbers, so it is stated as
  // one. It is not promoted to a status: the device decides what it means.
  const outOfBand = reported && value !== null && band !== null && (value < band.min || value > band.max);

  const thresholds = (
    <div className="metric-card__thresholds">
      <p className="metric-card__thresholds-head">
        {bounds.length === 0 ? 'No limit is configured on the device for this measurement.' : 'Limits the device is applying'}
      </p>
      {bounds.length === 0 ? null : (
        <dl className="threshold-list">
          {bounds.map((bound) => (
            <div className="threshold-list__row" key={bound.label}>
              <dt className="threshold-list__label">{bound.label}</dt>
              <dd className="threshold-list__value">
                <span className="num">
                  {number(bound.value, metric.digits)} {metric.unit}
                </span>
                <span className="threshold-list__meaning">{bound.meaning}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {band === null ? null : <p className="metric-card__target-source">{band.source}</p>}
    </div>
  );

  const body = (
    <>
      <p className="metric-card__value">
        {reported ? (
          <>
            <span className="metric-card__number">{number(value, metric.digits)}</span>
            <span className="reading__unit">{metric.unit}</span>
          </>
        ) : (
          <span className="reading__number--absent">not reported</span>
        )}
      </p>

      {metric.qualification === null ? null : (
        <p className="metric-card__qualification">{metric.qualification}</p>
      )}

      {secondary === null ? null : (
        <p className="metric-card__secondary">
          <span className="num">
            {number(secondary.value, secondary.digits)} {secondary.unit}
          </span>{' '}
          {secondary.label}
        </p>
      )}

      {/*
        Two facts, two labels, neither of them a verdict about this
        measurement. The word is always present beside the mark, so the card
        survives greyscale, forced colours and a colourblind reader.
      */}
      <p className="metric-card__statuses">
        <span className="chip" data-tone={reported ? 'neutral' : 'unknown'}>
          <Mark shape={reported ? 'circle' : 'hatched-diamond'} className="mark--sm" />
          {reported ? 'Reported' : 'Not reported'}
        </span>
        <span className="chip" data-tone={zone.tone} title={`The device reported this verdict for the whole cabinet: ${zone.token}`}>
          <Mark shape={zone.shape} className="mark--sm" />
          Cabinet: {zone.label}
        </span>
      </p>

      {thresholds}

      {outOfBand ? (
        <p className="metric-card__out" role="note">
          This reading is outside the limits above. What that means for the stored food is the device&apos;s own verdict,
          at the top of this page — it is not recomputed here.
        </p>
      ) : null}

      {conditionCount > 0 ? (
        <p className="metric-card__conditions">
          <span className="chip chip--plain">
            {conditionCount} condition{conditionCount === 1 ? '' : 's'} name this measurement
          </span>
        </p>
      ) : null}

      {spark === null ? null : <div className="metric-card__spark">{spark}</div>}

      <p className="metric-card__foot">
        {recordedAt === null ? (
          <>
            No reading stored. {stale ? 'The last accepted snapshot is stale, so nothing below is live.' : ''}
            <span className="metric-card__foot-sep"> · </span>
          </>
        ) : (
          <>
            Reading received {dateTime(recordedAt)}.
            <span className="metric-card__foot-sep"> · </span>
          </>
        )}
        Last accepted snapshot {lastAccepted}
        {stale ? <span className="metric-card__foot-stale"> · stale</span> : null}
      </p>
    </>
  );

  if (metric.absence !== null) {
    return (
      <section className="panel metric-card metric-card--absent" aria-label={`${metric.title}: nothing reports this measurement`}>
        <div className="metric-card__body">
          <p className="metric-card__label">{metric.cardTitle}</p>
      <p className="metric-card__label">{metric.cardTitle}</p>

      <p className="metric-card__value">
            <span className="reading__number--absent">not installed</span>
          </p>
          <p className="metric-card__absence-kind">
            <Mark shape="hatched-diamond" className="mark--sm" /> Nothing is reporting this measurement
          </p>
          <p className="metric-card__target">No value, and none is being withheld.</p>
          <p className="metric-card__foot metric-card__foot--absent">
            <strong>Would be measured:</strong> {metric.absence.part}. {metric.absence.reason}
          </p>
        </div>
      </section>
    );
  }

  return (
    /*
     * §8 makes the whole card the affordance, and the whole card must NOT be the
     * button.
     *
     * It was, and that was a real defect. A button's accessible name replaces its
     * contents: with an `aria-label` on the card button, a screen reader read
     * "Temperature. Open the detail." and then had nothing else to say — the
     * 32.0 °C, the unit, the "Cabinet: Check food" chip, the configured limits
     * and the reading's timestamp were all inside the button and all invisible to
     * anyone not looking at the screen. The five most important numbers on the
     * page were the five a screen-reader user could not reach.
     *
     * The fix is the stretched-link pattern: the button wraps the card's TITLE
     * and its `::after` is positioned over the whole card, so a click anywhere
     * lands on the button while every number stays ordinary, readable content
     * outside it. The name stays short, the target stays big, and the card is
     * still one tab stop.
     */
    <section className="panel metric-card">
      <div className="metric-card__body">
        <p className="metric-card__label">
          <button type="button" className="metric-card__open" onClick={onOpen}>
            {metric.cardTitle}
            <span className="visually-hidden"> — open the detail</span>
          </button>
        </p>
        {body}
      </div>
    </section>
  );
});
