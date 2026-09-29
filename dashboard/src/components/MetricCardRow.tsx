/**
 * The KPI card row (guide §7) and the sparklines in it.
 *
 * This exists so the dashboard and the live-monitoring page cannot drift into
 * showing two different sets of cards, and so the sparkline request is made once
 * rather than once per card. Five cards is five `getReadings` calls otherwise,
 * against a service that rate-limits reads.
 *
 * The cards themselves are `MetricCard`; this supplies the series.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { getReadings } from '../api/endpoints';
import type { CurrentResponse, ReadingsResponse } from '../api/types';
import { CARD_METRICS, bandFor, boundsFor, metricById, type MetricId } from '../lib/metrics';
import { RANGES, bucketFor, isRangeId, windowFor, type RangeId } from '../lib/ranges';
import { readParam } from '../lib/url';
import { useResource } from '../lib/useResource';
import { conditionFacts } from '../lib/conditions';
import { MetricCard } from './MetricCard';
import { Sparkline } from './Sparkline';
import { useFreshness } from '../lib/freshness';

/** The sparkline window. Short, because a card cannot show a week legibly. */
function sparkRange(): RangeId {
  const requested = readParam('spark');
  return isRangeId(requested) ? requested : '1h';
}

export interface MetricCardRowProps {
  readonly snapshot: CurrentResponse;
  /** Called with a metric id; the page owns the drawer. */
  readonly onOpen: (id: MetricId) => void;
}

export const MetricCardRow = memo(function MetricCardRow({ snapshot, onOpen }: MetricCardRowProps) {
  const [range] = useState<RangeId>(sparkRange);
  const [window_] = useState(() => windowFor(sparkRange()));

  const fields = useMemo(
    () =>
      CARD_METRICS.map((id) => metricById(id))
        .filter((metric) => metric.field !== null)
        .map((metric) => metric.field as NonNullable<(typeof metric)['field']>),
    [],
  );

  const load = useCallback(
    () =>
      getReadings(snapshot.device.dev, {
        from: Math.floor(window_.from / 1000),
        to: Math.floor(window_.to / 1000),
        bucket: bucketFor(range),
        fields,
      }),
    [snapshot.device.dev, window_, range, fields],
  );

  const series = useResource<ReadingsResponse>(load);
  const points = series.data?.series;

  const conditionsPerMetric = useMemo(() => {
    const counts = new Map<MetricId, number>();
    for (const alert of snapshot.alerts) {
      const facts = conditionFacts(alert, snapshot.readings, snapshot.device.thresholds);
      const id = facts.metric?.id;
      if (id === undefined) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [snapshot.alerts, snapshot.readings, snapshot.device.thresholds]);

  // One tick for five cards. The boolean is passed down rather than each card
  // running its own clock. See lib/freshness.ts.
  const freshness = useFreshness(snapshot.transport);

  const thresholds = snapshot.device.thresholds;
  const readings = snapshot.readings;

  return (
    <div className="metric-row">
      {CARD_METRICS.map((id) => {
        const metric = metricById(id);
        const field = metric.field;
        const value = readings !== null && field !== null ? readings[field] : null;

        // Narrowed once, outside any closure: the secondary reading belongs to
        // the gas card and nowhere else, and a `!` inside a callback is a way to
        // reintroduce the assumption this file is careful about elsewhere.
        const spec = metric.secondary;
        const secondaryValue = readings === null || spec === null ? null : readings[spec.field];
        const secondary =
          spec === null || secondaryValue === null || secondaryValue === undefined
            ? null
            : { value: secondaryValue, label: spec.label, unit: spec.unit, digits: spec.digits };

        const sparkPoints =
          field === null || points === undefined
            ? null
            : points.map((point) => point[field]);

        const span = sparkPoints === null ? null : `${RANGES.find((entry) => entry.id === range)?.full ?? 'the window'}`;

        return (
          <MetricCard
            key={id}
            metric={metric}
            value={value}
            secondary={secondary}
            zoneStatus={snapshot.device.zone_status}
            band={bandFor(id, thresholds)}
            bounds={boundsFor(id, thresholds)}
            recordedAt={readings === null ? null : readings.recorded_at}
            stale={freshness.stale}
            lastAccepted={freshness.since ?? 'unknown'}
            conditionCount={conditionsPerMetric.get(id) ?? 0}
            spark={
              sparkPoints === null || span === null ? null : (
                <Sparkline
                  values={sparkPoints}
                  title={`${metric.title} over the ${span}: shape only. The plot, the range and the figures are in the metric detail.`}
                />
              )
            }
            onOpen={() => onOpen(id)}
          />
        );
      })}
    </div>
  );
});
