/**
 * The trends explorer (guide §9, and the chart rules of §26).
 *
 * §9's chart requirements, and where each one is answered:
 *
 *   range control 1H 6H 24H 7D          segmented control, from `lib/ranges`
 *   threshold bands drawn                `LineChart` shades the device's band
 *   threshold LABELS, not colour alone   the limits list below the charts, and
 *                                        `LineChart`'s own footer
 *   missing-data indication              `LineChart` breaks the line, counts the
 *                                        gaps and repeats them in a hidden
 *                                        table; the coverage strip below adds
 *                                        the share of the window with no value
 *   legend toggle                       the series chips; a metric can be hidden
 *   door-open / alarm markers            the "events in this window" list, fed by
 *                                        the device's own event log
 *   empty / loading / error / no-data    all four, separately
 *   export CSV                           the rows on screen, generated here
 *   interactive tooltip / crosshair      NOT provided — see the note below
 *   zoom / pan, export chart image       NOT provided — see the note below
 *
 * WHY THERE IS NO TOOLTIP, NO CROSSHAIR, NO ZOOM
 * -----------------------------------------------------------------------------
 * The plots are small multiples, one measurement each, at most 500 points, and
 * `LineChart` gives every one of them a full non-visual equivalent: a
 * `role="img"` summary sentence naming the lowest, highest and latest values
 * with their times, plus a hidden table with the same figures and the point
 * count, the run count and the gap count. That is the accessible way to answer
 * "what was it at 14:21", and it is the one that works on a phone, with a
 * screen reader, and on paper.
 *
 * A hover tooltip would answer a question the hidden table already answers, and
 * it would answer it only for a pointer: it disappears on touch, it is
 * unreachable by keyboard, and it is the reason a chart is allowed to be
 * decorative. Adding one on top of the table would also mean forking or editing
 * `LineChart`, which is outside this pass's file ownership. Pan and zoom were
 * left out for the same reason, and because a fixed time axis is what lets a
 * reader line up three plots by eye without any interaction at all.
 *
 * WHY THE GAS SERIES IS NOT PLOTTED
 * -----------------------------------------------------------------------------
 * `LineChart`'s field union is temperature, humidity and pressure. Gas is shown
 * as figures under the charts, from the same fetched series, with the reason
 * printed. Forking a second chart engine to draw one more field would leave two
 * implementations of the same axes to keep honest.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { getReadings } from '../api/endpoints';
import type { DeviceEvent, ReadingsResponse, SeriesPoint, Thresholds } from '../api/types';
import { writeParams } from '../lib/url';
import { readParam } from '../lib/url';
import { bandFor, boundsFor, CHARTABLE, metricById } from '../lib/metrics';
import { RANGES, bucketFor, isRangeId, rangeFull, windowFor, type RangeId } from '../lib/ranges';
import { duration, summariseSeries } from '../lib/series';
import { downloadCsv } from '../lib/csv';
import { dateTime, number } from '../lib/format';
import { eventLabel } from '../lib/events';
import { useResource } from '../lib/useResource';
import { LineChart, type MetricSpec as ChartSpec } from './LineChart';
import { ErrorNotice, LoadingLine } from './Notices';

const CHART_FIELD: Readonly<Record<string, ChartSpec['field']>> = {
  temperature: 'temperature_c',
  humidity: 'humidity_pct',
  pressure: 'pressure_hpa',
};

const CHART_TITLE: Readonly<Record<string, string>> = {
  temperature: 'Cabinet temperature',
  humidity: 'Relative humidity',
  pressure: 'Barometric pressure',
};

function initialRange(): RangeId {
  const requested = readParam('range');
  return isRangeId(requested) ? requested : '6h';
}

export interface TrendsExplorerProps {
  readonly dev: string;
  readonly thresholds: Thresholds | null;
  /** The device clock is trusted; when it is not, the time axis is receipt time only. */
  readonly clockTrusted: boolean;
  /** Events already loaded by the store, used for the in-window marker list. */
  readonly events: readonly DeviceEvent[];
  /** Link targets, so the export buttons can be labelled per range. */
  readonly heading?: string;
  readonly subtitle?: string;
}

/** The share of the window that carries a value, as a bar a reader can see. */
function CoverageStrip({ present, total }: { readonly present: number; readonly total: number }) {
  if (total === 0) return null;
  const have = Math.round((present / total) * 100);
  return (
    <p className="coverage">
      <span className="coverage__track" role="img" aria-label={`${have} per cent of the ${total} points in this window carry a value.`}>
        <span className="coverage__have" style={{ width: `${have}%` }} />
        <span className="coverage__notch" style={{ insetInlineStart: `${have}%` }} aria-hidden="true" />
      </span>
      <span className="coverage__text">
        <span className="num">{number(present, 0)}</span> of <span className="num">{number(total, 0)}</span> points carry
        a value
        {have === 100 ? ' — no missing data in this window.' : ` — ${number(total - present, 0)} carry nothing and are shown as gaps, not as zero.`}
      </span>
    </p>
  );
}

export function TrendsExplorer({ dev, thresholds, clockTrusted, events, heading, subtitle }: TrendsExplorerProps) {
  const [range, setRange] = useState<RangeId>(initialRange);
  const [window_, setWindow] = useState(() => windowFor(initialRange()));
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const headingId = useId();

  useEffect(() => {
    writeParams({ range });
  }, [range]);

  const choose = useCallback((next: RangeId) => {
    setRange(next);
    setWindow(windowFor(next));
  }, []);

  const load = useCallback(
    () =>
      getReadings(dev, {
        from: Math.floor(window_.from / 1000),
        to: Math.floor(window_.to / 1000),
        bucket: bucketFor(range),
        fields: ['temperature_c', 'humidity_pct', 'pressure_hpa', 'gas_delta_mv', 'gas_input_mv'],
      }),
    [dev, window_, range],
  );

  const readings = useResource<ReadingsResponse>(load);
  const data = readings.data;
  const full = rangeFull(range);

  const toggle = useCallback((id: string) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const specs = useMemo(
    () =>
      CHARTABLE.map((id) => {
        const metric = metricById(id);
        const band = bandFor(id, thresholds);
        return {
          field: CHART_FIELD[id],
          title: CHART_TITLE[id] ?? metric.title,
          unit: metric.unit,
          digits: metric.digits,
          band: band === null ? null : { min: band.min, max: band.max, source: band.source },
          id,
        };
      }),
    [thresholds],
  );

  const visible = specs.filter((spec) => !hidden.has(spec.id));
  const gasStats = useMemo(
    () =>
      data === null ? null : summariseSeries('gas_delta_mv', data.series, Date.parse(data.from), Date.parse(data.to), null),
    [data],
  );

  const inWindow = useMemo(() => {
    if (data === null) return [];
    const from = Date.parse(data.from);
    const to = Date.parse(data.to);
    return events.filter((event) => {
      const at = Date.parse(event.received_at);
      return Number.isFinite(at) && at >= from && at <= to;
    });
  }, [data, events]);

  const exportCsv = useCallback(() => {
    if (data === null) return;
    const rows: (string | number | null)[][] = data.series.map((point: SeriesPoint) => [
      point.t,
      point.reported_at ?? null,
      point.time_valid ? 'trusted' : 'not trusted',
      point.samples,
      point.temperature_c,
      point.humidity_pct,
      point.pressure_hpa,
      point.gas_input_mv,
      point.gas_delta_mv,
    ]);
    downloadCsv(
      `freshguard-${dev}-readings-${range}.csv`,
      [
        'received_at',
        'device_reported_at',
        'device_time',
        'samples_in_bucket',
        'temperature_c',
        'humidity_pct',
        'pressure_hpa',
        'gas_input_mv',
        'gas_delta_mv',
      ],
      rows,
    );
  }, [data, dev, range]);

  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel__head">
        <h2 className="panel__title" id={headingId}>
          {heading ?? 'Trends'}
        </h2>
        <p className="panel__sub">
          {data === null
            ? 'Loading…'
            : `${number(data.points, 0)} points · bucket ${data.bucket} · ${dateTime(data.from)} to ${dateTime(data.to)}`}
        </p>
        <div className="panel__tools">
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="segmented__option"
                aria-pressed={range === entry.id}
                onClick={() => choose(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--quiet" onClick={readings.reload}>
            Refresh
          </button>
          <button type="button" className="btn btn--quiet" onClick={exportCsv} disabled={data === null || data.points === 0}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="panel__body">
        {subtitle === undefined ? null : <p className="note">{subtitle}</p>}

        {clockTrusted ? null : (
          <p className="panel__note-strip" style={{ marginBlockEnd: 'var(--space-3)' }}>
            The device clock is not trusted. Every horizontal position below is the time the service received the sample,
            so the plots are still usable; only the device&apos;s own timestamps are missing. Buckets with no value
            carry the line&apos;s device-time flag as not trusted.
          </p>
        )}

        {readings.loading ? <LoadingLine>Loading readings for {full}…</LoadingLine> : null}

        {readings.error !== null ? (
          <ErrorNotice what={`Loading readings for the ${full}`} error={readings.error} onRetry={readings.reload} />
        ) : null}

        {data !== null && data.downgraded ? (
          <p className="panel__note-strip panel__note-strip--spaced">
            The service could not return the requested <span className="num">{data.requested_bucket}</span> bucket
            within its {number(data.max_points, 0)}-point limit, so it used <span className="num">{data.bucket}</span>.
            Each point is an average over that much time, so fine detail has been smoothed away.
          </p>
        ) : null}

        {data !== null && data.points === 0 ? (
          <p className="note">
            The device has no readings in the {full}. Readings are retained for a limited window by the service, and a
            device that has only just started reporting has no history yet. Try a shorter range.
          </p>
        ) : null}

        {data !== null && data.points > 0 ? (
          <>
            {/* The legend, and a legend that is also the control: §9 asks for
                clickable series and §26 for legend toggles, and a legend you
                cannot click is a caption. `aria-pressed` is what carries the
                state to assistive technology, and the label says which metric it
                hides, so a screen reader user is not told "pressed" and left to
                work out what changed. */}
            <div className="chip-group trend-legend" role="group" aria-label="Show or hide a series">
              {specs.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  className="chip chip--plain trend-legend__toggle"
                  aria-pressed={!hidden.has(spec.id)}
                  onClick={() => toggle(spec.id)}
                >
                  <span className="chart-legend__swatch" aria-hidden="true" />
                  {hidden.has(spec.id) ? `Hide ${spec.title}` : `Showing ${spec.title}`}
                </button>
              ))}
              {gasStats === null ? null : (
                <span className="chip chip--plain" title="Not plottable: see the figures below the charts.">
                  Gas — figures only
                </span>
              )}
            </div>

            {visible.length === 0 ? (
              <p className="note">Every series is hidden. Turn one back on above to see it.</p>
            ) : (
              <div className="chart-stack">
                {visible.map((spec) => (
                  <LineChart
                    key={spec.id}
                    spec={{ field: spec.field, title: spec.title, unit: spec.unit, digits: spec.digits, band: spec.band }}
                    points={data.series}
                    from={Date.parse(data.from)}
                    to={Date.parse(data.to)}
                    rangeLabel={full}
                    legend={
                      spec.band === null ? (
                        <span className="chart-legend__key">No limit is configured for this measurement.</span>
                      ) : null
                    }
                  />
                ))}
              </div>
            )}

            {data.series.length > 0 ? (
              <CoverageStrip
                present={data.series.filter((point) => point.temperature_c !== null || point.humidity_pct !== null || point.pressure_hpa !== null).length}
                total={data.series.length}
              />
            ) : null}
          </>
        ) : null}
      </div>

      {data !== null && data.points > 0 ? (
        <div className="panel__body">
          <section className="trend-limits" aria-label="Thresholds in force for this window">
            <h3 className="chart__title">Thresholds in force</h3>
            <p className="note">
              Every boundary the device is applying, named, with its value. The shaded band on each plot is the same
              number, and the label is here so the band is never carried by colour alone (guide §9).
            </p>
            {CHARTABLE.map((id) => {
              const bounds = boundsFor(id, thresholds);
              if (bounds.length === 0) {
                return (
                  <p className="trend-limits__none" key={id}>
                    <strong>{CHART_TITLE[id]}:</strong> the device configures no limit for this measurement, so none is
                    drawn and none is applied. The illustrative ranges in the interface guide are wireframe examples and
                    are not used.
                  </p>
                );
              }
              const metric = metricById(id);
              return (
                <dl className="threshold-list" key={id}>
                  {bounds.map((bound) => (
                    <div className="threshold-list__row" key={bound.label}>
                      <dt className="threshold-list__label">
                        {CHART_TITLE[id]} · {bound.label}
                      </dt>
                      <dd className="threshold-list__value">
                        <span className="num">
                          {number(bound.value, metric.digits)} {metric.unit}
                        </span>
                        <span className="threshold-list__meaning">{bound.meaning}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              );
            })}
            <dl className="threshold-list">
              {boundsFor('gas', thresholds).map((bound) => (
                <div className="threshold-list__row" key={bound.label}>
                  <dt className="threshold-list__label">Gas · {bound.label}</dt>
                  <dd className="threshold-list__value">
                    <span className="num">
                      {number(bound.value, 1)} mV delta
                    </span>
                    <span className="threshold-list__meaning">{bound.meaning}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {gasStats === null ? null : (
            <section className="trend-gas" aria-label="Gas sensor figures for this window">
              <h3 className="chart__title">Gas sensor, as figures</h3>
              <p className="note">
                Millivolts, relative to a baseline the device captures after the heater settles. Not a concentration and
                not convertible to one (guide §46.14). This row is the whole gas picture for the {full}.
              </p>
              <div className="facts">
                <div className="fact">
                  <span className="fact__label">Lowest delta</span>
                  <span className="fact__value">
                    {gasStats.min === null ? '—' : `${number(gasStats.min.value, 1)} mV at ${dateTime(gasStats.min.at)}`}
                  </span>
                </div>
                <div className="fact">
                  <span className="fact__label">Average delta</span>
                  <span className="fact__value">{gasStats.average === null ? '—' : `${number(gasStats.average, 1)} mV`}</span>
                </div>
                <div className="fact">
                  <span className="fact__label">Highest delta</span>
                  <span className="fact__value">
                    {gasStats.max === null ? '—' : `${number(gasStats.max.value, 1)} mV at ${dateTime(gasStats.max.at)}`}
                  </span>
                </div>
                <div className="fact">
                  <span className="fact__label">Continuous runs</span>
                  <span className="fact__value">
                    {number(gasStats.runs, 0)} over {number(gasStats.total, 0)} buckets
                  </span>
                </div>
                <div className="fact">
                  <span className="fact__label">Buckets with no value</span>
                  <span className="fact__value">
                    {number(gasStats.missing, 0)}
                    {gasStats.missing === 0 ? '' : ` · ${duration(gasStats.unknownSeconds)} of the ${full} unknown`}
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      ) : null}

      <div className="panel__body">
        <section className="trend-markers" aria-label="Events inside the plotted window">
          <h3 className="chart__title">Events inside this window</h3>
          <p className="note">
            Guide §9 asks for door-open and alarm markers on the plot. The device raises events and this page draws none
            on the trace, so they are listed here in the same {full} instead — the times are the same receipt times
            the axis uses, and the association is the reader&apos;s to make rather than a mark this page chose to draw.
          </p>
          {data === null ? null : inWindow.length === 0 ? (
            <p className="note">
              No events were raised in the {full}. Events are raised by the device on a latch change, a door-open timeout or
              an input failure; an empty list means none of those happened in this window.
            </p>
          ) : (
            <ul className="marker-list">
              {inWindow.slice(0, 20).map((event) => (
                // `id`, not `event_id`: the device's counter restarts every boot, so the
                // same `event_id` recurs across boot generations and React may omit children.
                <li className="marker-list__item" key={event.id}>
                  <span className="num marker-list__time">{dateTime(event.received_at)}</span>
                  <span className="marker-list__type">{eventLabel(event.type)}</span>
                  <span className="marker-list__message">{event.message}</span>
                </li>
              ))}
              {inWindow.length > 20 ? (
                <li className="marker-list__item marker-list__more">
                  {number(inWindow.length - 20, 0)} more event{inWindow.length - 20 === 1 ? '' : 's'} in this window —
                  the event log has the rest.
                </li>
              ) : null}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
