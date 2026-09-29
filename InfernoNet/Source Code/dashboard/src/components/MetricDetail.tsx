/**
 * The metric detail drawer (guide §8).
 *
 * §8 lists what belongs here: current value, target, current status, historical
 * chart, min, max, average, time outside threshold, number of alerts, last
 * update, source and sensor health. Ten of the ten are answerable from what the
 * service returns. The eleventh thing a reader wants and cannot have is the
 * sensor's own idea of whether it is well, so `sensor health` below is a
 * statement about the fault bit the device set, and nothing more.
 *
 * WHERE THE NUMBERS COME FROM
 * -----------------------------------------------------------------------------
 * Everything historical is computed from one `getReadings` call over the
 * selected range, on the service's receipt-time axis. The min, max, average and
 * the time outside a limit are arithmetic over the buckets the service returned,
 * and the component states the bucket width next to the time figure, because a
 * duration quoted without its resolution overstates its own precision: a
 * forty-second excursion inside a one-hour bucket is not visible in a one-hour
 * bucket, and pretending otherwise would be the §26 defect in prose.
 *
 * The chart is `LineChart`, the one the trends page uses. It is not forked for
 * the gas path, because `LineChart`'s field union is the three measurements it
 * was written for and re-implementing a plot to draw one more field would leave
 * two chart engines to keep honest. The gas detail therefore shows its series as
 * figures and says that it is doing so.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { getReadings } from '../api/endpoints';
import type { CurrentResponse, ReadingsResponse } from '../api/types';
import { dateTime, number } from '../lib/format';
import { bandFor, boundsFor, type MetricId, type MetricSpec } from '../lib/metrics';
import { RANGES, bucketFor, rangeFull, windowFor, type RangeId } from '../lib/ranges';
import { duration, outsideSeconds, summariseSeries } from '../lib/series';
import { useResource } from '../lib/useResource';
import { conditionFacts } from '../lib/conditions';
import { LineChart, type MetricSpec as ChartSpec } from './LineChart';
import { Drawer } from './Drawer';
import { ErrorNotice, LoadingLine } from './Notices';
import { Mark } from './Mark';
import { statusPresentation } from '../lib/status';

/** The three fields `LineChart` plots. See lib/metrics CHARTABLE. */
const CHART_FIELD: Partial<Record<MetricId, ChartSpec['field']>> = {
  temperature: 'temperature_c',
  humidity: 'humidity_pct',
  pressure: 'pressure_hpa',
};

/**
 * The bucket as a phrase, so the resolution next to a duration means something.
 * `1m` alone next to "3 h 20 min" tells a reader nothing; "5 minutes" tells them
 * the figure is a sum of five-minute averages.
 */
function bucketSecondsText(bucket: string): string {
  switch (bucket) {
    case 'raw':
      return 'one point per sample, no averaging';
    case '1m':
      return '1 minute per point';
    case '5m':
      return '5 minutes per point';
    case '1h':
      return '1 hour per point';
    default:
      return bucket;
  }
}

interface FactProps {
  readonly label: string;
  readonly children: ReactNode;
  /** Explicitly nullable: the tone is chosen by a ternary at every call site. */
  readonly tone?: 'unknown' | undefined;
}

function Fact({ label, children, tone }: FactProps) {
  return (
    <div className="fact" data-tone={tone}>
      <span className="fact__label">{label}</span>
      <span className="fact__value">{children}</span>
    </div>
  );
}

export interface MetricDetailProps {
  readonly metric: MetricSpec;
  readonly snapshot: CurrentResponse;
  /** Called with no arguments to close. Must be stable. */
  readonly onClose: () => void;
  /** Initial range, so the drawer can open on the range the page is showing. */
  readonly initialRange: RangeId;
}

export function MetricDetail({ metric, snapshot, onClose, initialRange }: MetricDetailProps) {
  const [range, setRange] = useState<RangeId>(initialRange);
  const [window_, setWindow] = useState(() => windowFor(initialRange));

  const choose = useCallback((next: RangeId) => {
    setRange(next);
    setWindow(windowFor(next));
  }, []);

  const load = useCallback(() => {
    if (metric.field === null) return Promise.reject(new Error('nothing reports this measurement'));
    return getReadings(snapshot.device.dev, {
      from: Math.floor(window_.from / 1000),
      to: Math.floor(window_.to / 1000),
      bucket: bucketFor(range),
      fields: [metric.field],
    });
  }, [metric.field, snapshot.device.dev, window_, range]);

  const readings = useResource<ReadingsResponse>(metric.field === null ? null : load);
  const data = readings.data;

  const thresholds = snapshot.device.thresholds;
  const band = bandFor(metric.id, thresholds);
  const bounds = boundsFor(metric.id, thresholds);
  const chartField = metric.field === null ? null : (CHART_FIELD[metric.id] ?? null);
  const stats = useMemo(
    () =>
      metric.field === null || data === null
        ? null
        : summariseSeries(metric.field, data.series, Date.parse(data.from), Date.parse(data.to), band),
    [metric.field, data, band],
  );

  const reading = metric.field === null || snapshot.readings === null ? null : snapshot.readings[metric.field];
  const zone = statusPresentation(snapshot.device.zone_status);
  const full = rangeFull(range);

  // Conditions that name this measurement. The count is a count of the
  // conditions the service returned that name it — not a count of breaches, and
  // not a count of events.
  const related = useMemo(
    () => snapshot.alerts.filter((alert) => {
      const facts = conditionFacts(alert, snapshot.readings, thresholds);
      return facts.metric?.id === metric.id;
    }),
    [snapshot.alerts, snapshot.readings, thresholds, metric.id],
  );

  const sensorBit = metric.faultBit;
  const sensorCondition =
    sensorBit === null
      ? null
      : (snapshot.alerts.find(
          (alert) => alert.condition_key.endsWith(`:${sensorBit}`) || alert.condition_key.endsWith(`:${sensorBit}:read`),
        ) ?? null);

  return (
    <Drawer
      open
      onClose={onClose}
      title={metric.title}
      subtitle={
        <>
          {snapshot.device.dev} · {full} · the horizontal axis is the time the service received each sample
        </>
      }
      tools={
        <div className="segmented" role="group" aria-label="Range for this metric">
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
      }
    >
      <div className="metric-detail">
        <p className="metric-detail__headline">
          <span className="metric-detail__value">
            {reading === null ? (
              <span className="reading__number--absent">not reported</span>
            ) : (
              <>
                <span className="metric-card__number">{number(reading, metric.digits)}</span>
                <span className="reading__unit">{metric.unit}</span>
              </>
            )}
          </span>
          {metric.qualification === null ? null : <span className="metric-card__qualification">{metric.qualification}</span>}
        </p>

        <div className="facts">
          <Fact label="Current status">
            {/* The cabinet verdict, labelled as such. Never recomputed per metric. */}
            <span className="chip" data-tone={zone.tone}>
              <Mark shape={zone.shape} className="mark--sm" /> Cabinet: {zone.label} ({zone.token})
            </span>
          </Fact>
          <Fact label="Last update">
            {snapshot.readings === null
              ? 'no reading stored'
              : `${dateTime(snapshot.readings.recorded_at)} (received)`}
          </Fact>
          <Fact label="Source sensor">{metric.sensor ?? 'not reported'}</Fact>
          <Fact label="Sensor health" tone={sensorCondition === null ? undefined : 'unknown'}>
            {sensorCondition === null
              ? 'No condition names this sensor in the latest snapshot. That is a statement about the fault map, not a calibration check.'
              : sensorCondition.title}
          </Fact>
          <Fact label="Conditions naming this">
            {related.length === 0 ? 'none' : `${related.length} active`}
          </Fact>
          <Fact label="Time outside the limits">
            {stats === null || band === null
              ? 'not computed — no limit is configured for this measurement'
              : outsideSeconds(stats) === 0
                ? 'none in this window'
                : `${duration(outsideSeconds(stats))} of the ${full}`}
          </Fact>
          <Fact label="Window with no value" tone={stats !== null && stats.unknownSeconds > 0 ? 'unknown' : undefined}>
            {stats === null
              ? '—'
              : stats.unknownSeconds === 0
                ? `none — all ${number(stats.total, 0)} buckets in the window carry a value`
                : `${duration(stats.unknownSeconds)} of the ${full} carries no reading, and is counted as unknown rather than as in range`}
          </Fact>
          <Fact label="Service bucket">
            {data === null ? '—' : `${data.bucket} — ${bucketSecondsText(data.bucket)}`}
          </Fact>
        </div>

        {data !== null && data.downgraded ? (
          <p className="panel__note-strip panel__note-strip--spaced">
            The service could not return the requested <span className="num">{data.requested_bucket}</span> bucket
            within its {number(data.max_points, 0)}-point limit, so it used <span className="num">{data.bucket}</span>.
            Each point is an average over that much time.
          </p>
        ) : null}

        {readings.loading ? <LoadingLine>Loading {metric.title.toLowerCase()} for {full}…</LoadingLine> : null}

        {readings.error !== null ? (
          <ErrorNotice what={`Loading the ${metric.title} history`} error={readings.error} onRetry={readings.reload} />
        ) : null}

        {chartField !== null && data !== null && stats !== null ? (
          <LineChart
            spec={{
              field: chartField,
              title: metric.title,
              unit: metric.unit,
              digits: metric.digits,
              band: band === null ? null : { min: band.min, max: band.max, source: band.source },
            }}
            points={data.series}
            from={Date.parse(data.from)}
            to={Date.parse(data.to)}
            rangeLabel={full}
          />
        ) : null}

        {/* The gas path. Real figures over the real series, stated as figures,
            because the shared chart component plots the three fields it was
            written for and a second chart engine is a worse trade than a table
            that is honest about what it is. */}
        {chartField === null && data !== null && stats !== null ? (
          <section className="panel__sub panel__sub--boxed" aria-label={`${metric.title} figures for the ${full}`}>
            <h3 className="chart__title">Figures rather than a plot</h3>
            <p className="note">
              This measurement is shown as numbers over the {full} rather than as a trace. The shared chart component
              plots temperature, humidity and pressure; extending it is a change to that component, and a second chart
              engine would be worse than a table. Every figure below is arithmetic on the same{' '}
              <span className="num">{data.points}</span> points.
            </p>
            <div className="facts">
              <Fact label="Points in range">
                {number(stats.total, 0)} ({number(stats.present, 0)} with a value)
              </Fact>
              <Fact label="Lowest">{stats.min === null ? '—' : `${number(stats.min.value, metric.digits)} ${metric.unit} at ${dateTime(stats.min.at)}`}</Fact>
              <Fact label="Average">{stats.average === null ? '—' : `${number(stats.average, metric.digits)} ${metric.unit}`}</Fact>
              <Fact label="Highest">{stats.max === null ? '—' : `${number(stats.max.value, metric.digits)} ${metric.unit} at ${dateTime(stats.max.at)}`}</Fact>
              <Fact label="Continuous runs">
                {number(stats.runs, 0)} {stats.runs === 1 ? 'run, no gap' : 'runs, so the line would break here'}
              </Fact>
            </div>
          </section>
        ) : null}

        <section className="metric-detail__limits" aria-label="Limits">
          <h3 className="chart__title">Limits the device is applying</h3>
          {bounds.length === 0 ? (
            <p className="note">
              The device configures no limit for this measurement, so none is shown. The illustrative ranges in the
              interface guide are wireframe examples and are not applied anywhere in this product.
            </p>
          ) : (
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
        </section>

        <section className="metric-detail__provenance" aria-label="Where this number comes from">
          <h3 className="chart__title">Where this number comes from</h3>
          <p className="note">{metric.provenance}</p>
        </section>
      </div>
    </Drawer>
  );
}
