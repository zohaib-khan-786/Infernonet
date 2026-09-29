/**
 * Trends.
 *
 * Three small multiples over a selectable window, from `/readings`. Each plot
 * is its own panel with its own value axis and a shared, real time axis, which
 * is how a data logger prints them: three rows, one column of time.
 *
 * The range selector lives in the query string, so a link to "the last six
 * hours of temperature" is a real link.
 *
 * `downgraded` is not hidden. When the service cannot honour the requested
 * bucket within its 500-point cap it picks a coarser one and says so, and this
 * panel repeats that in words, because a chart that silently changes its
 * resolution is a chart that lies about detail.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { RANGE_BUCKET, getReadings } from '../api/endpoints';
import type { ReadingsResponse, Thresholds } from '../api/types';
import { dateTime, number } from '../lib/format';
import { useResource } from '../lib/useResource';
import { readParam, writeParams } from '../lib/url';
import { LineChart, type MetricSpec } from './LineChart';
import { ErrorNotice, LoadingLine } from './Notices';

const RANGES = [
  { id: '1h', label: '1 h', full: 'last hour', seconds: 3_600 },
  { id: '6h', label: '6 h', full: 'last 6 hours', seconds: 6 * 3_600 },
  { id: '24h', label: '24 h', full: 'last 24 hours', seconds: 24 * 3_600 },
  { id: '7d', label: '7 d', full: 'last 7 days', seconds: 7 * 86_400 },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

/** The range the URL asked for, or the default. Read once, on the first render. */
function initialRange(): RangeId {
  const requested = readParam('range');
  return RANGES.some((entry) => entry.id === requested) ? (requested as RangeId) : '6h';
}

/**
 * The time window for a range, ending now.
 *
 * One function, used for the first render AND for every subsequent choice,
 * because a panel whose initial window and its chosen window can disagree is
 * worse than either. It did: `range` was initialised from the URL and
 * `window_` was initialised unconditionally to six hours, corrected only inside
 * `choose()`. So loading `?range=7d` deep link rendered the 7 d button pressed,
 * fetched six hours of readings, drew an axis of clock times spanning six hours,
 * and wrote "Temperature summary for the last 7 days" into the hidden table and
 * "over the last 7 days" into the plot's accessible name - all of it describing
 * a week of data that was never on screen, in the three places a screen-reader
 * user has to trust when the picture is not available to them.
 */
function windowFor(range: RangeId): { from: number; to: number } {
  const seconds = RANGES.find((entry) => entry.id === range)?.seconds ?? 6 * 3_600;
  const to = Date.now();
  return { from: to - seconds * 1000, to };
}

const FIELDS = ['temperature_c', 'humidity_pct', 'pressure_hpa'] as const;

function metrics(thresholds: Thresholds | null): MetricSpec[] {
  const specs: MetricSpec[] = [
    {
      field: 'temperature_c',
      title: 'Temperature',
      unit: '°C',
      digits: 1,
      band:
        thresholds === null
          ? null
          : { min: thresholds.temperature_min_c, max: thresholds.temperature_max_c, source: 'from the device config' },
    },
    {
      field: 'humidity_pct',
      title: 'Humidity',
      unit: '% RH',
      digits: 1,
      band:
        thresholds === null
          ? null
          : {
              min: thresholds.humidity_min_pct,
              max: thresholds.humidity_max_pct,
              source: 'from the device config',
            },
    },
    {
      field: 'pressure_hpa',
      title: 'Pressure',
      unit: 'hPa',
      digits: 1,
      band: null,
    },
  ];
  return specs;
}

export interface TrendsPanelProps {
  readonly dev: string | null;
  readonly thresholds: Thresholds | null;
  readonly clockTrusted: boolean;
}

export const TrendsPanel = memo(function TrendsPanel({ dev, thresholds, clockTrusted }: TrendsPanelProps) {
  const [range, setRange] = useState<RangeId>(initialRange);
  // Derived from the same first read of the URL, so the deep link and the
  // window it fetches always agree. See windowFor.
  const [window_, setWindow] = useState(() => windowFor(initialRange()));

  useEffect(() => {
    writeParams({ range });
  }, [range]);

  const choose = useCallback((next: RangeId) => {
    setRange(next);
    setWindow(windowFor(next));
  }, []);

  const load = useCallback(() => {
    if (dev === null) return Promise.reject(new Error('no device selected'));
    return getReadings(dev, {
      from: Math.floor(window_.from / 1000),
      to: Math.floor(window_.to / 1000),
      bucket: RANGE_BUCKET[range],
      fields: FIELDS,
    });
  }, [dev, window_, range]);

  const readings = useResource<ReadingsResponse>(dev === null ? null : load);
  const specs = useMemo(() => metrics(thresholds), [thresholds]);

  const rangeFull = RANGES.find((entry) => entry.id === range)?.full ?? 'selected window';
  const data = readings.data;

  return (
    <section className="panel" aria-labelledby="trends-title">
      <div className="panel__head">
        <h2 className="panel__title" id="trends-title">
          Trends
        </h2>
        <p className="panel__sub">
          {data === null ? (
            'Loading…'
          ) : (
            <>
              <span className="num">{number(data.points, 0)}</span> points · bucket{' '}
              <span className="num">{data.bucket}</span> · {dateTime(data.from)} to {dateTime(data.to)}
            </>
          )}
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
          <button type="button" className="btn btn--quiet" onClick={readings.reload} disabled={dev === null}>
            Refresh
          </button>
        </div>
      </div>

      <div className="panel__body">
        {clockTrusted ? null : (
          <p className="panel__note-strip" style={{ marginBlockEnd: 'var(--space-3)' }}>
            The device clock is not trusted. The horizontal axis is the time the service received each sample, so
            these plots are still usable; only the device&apos;s own timestamps are missing.
          </p>
        )}

        {readings.loading ? <LoadingLine>Loading readings for the {rangeFull}…</LoadingLine> : null}

        {readings.error !== null ? (
          <ErrorNotice what={`Loading readings for the ${rangeFull}`} error={readings.error} onRetry={readings.reload} />
        ) : null}

        {data !== null && data.downgraded ? (
          <p className="panel__note-strip panel__note-strip--spaced">
            The service could not return the requested <span className="num">{data.requested_bucket}</span> bucket
            within its {number(data.max_points, 0)}-point limit, so it used <span className="num">{data.bucket}</span>{' '}
            instead. Each point below is an average over that much time, so fine detail has been smoothed away.
          </p>
        ) : null}

        {data !== null && data.points === 0 ? (
          <p className="note">
            The device has no readings in the {rangeFull}. Readings are kept for a limited window by the service, and a
            device that has only just started reporting will not have any history yet. Try a shorter range.
          </p>
        ) : null}

        {data !== null && data.points > 0 ? (
          <div className="chart-stack">
            {specs.map((spec) => (
              <LineChart
                key={spec.field}
                spec={spec}
                points={data.series}
                from={Date.parse(data.from)}
                to={Date.parse(data.to)}
                rangeLabel={rangeFull}
                legend={
                  <span className="chart-legend__key">
                    Bucket <span className="num">{data.bucket}</span>
                    {Math.max(...data.series.map((point) => point.samples)) > 1 ? (
                      <>
                        {' '}
                        · each point averages up to{' '}
                        <span className="num">
                          {Math.max(...data.series.map((point) => point.samples))}
                        </span>{' '}
                        samples
                      </>
                    ) : null}
                  </span>
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
});
