/**
 * Environmental conditions (guide §10).
 *
 * A compact 2×3 grid, which is the same divided-face treatment the reading strip
 * already uses and reuses its cells: label, value, unit, foot. The guide's six
 * cells are Temperature, Humidity, Gas, Pressure, Pi Temperature and Ambient
 * Temperature, and two of the six are absences in this build.
 *
 * WHY THE ABSENT CELLS ARE FULL-SIZE
 * -----------------------------------------------------------------------------
 * They keep their place in the grid and their size, and they say what would be
 * measured. A hole in the middle of an instrument panel reads as a fault that
 * has not happened yet; a cell that says "not installed, and here is why" reads
 * as a cell the engineer left empty on purpose. This is the same argument as
 * the absent KPI card, at 1/3 the size.
 *
 * The gas cell is labelled in millivolts and carries the `relative · not a gas
 * concentration` qualification, for the reason guide §46.14 gives and
 * `lib/metrics.ts` states at length.
 */
import { memo } from 'react';
import type { ReadingBlock, StatusBlock, Thresholds, Transport } from '../api/types';
import { humaniseLabel, number } from '../lib/format';
import { boundsFor, ENV_METRICS, metricById, type MetricId } from '../lib/metrics';
import { useFreshness } from '../lib/freshness';
import { Mark } from './Mark';
import { StatusChip } from './StatusChip';

function readingFor(readings: ReadingBlock | null, id: MetricId): number | null {
  const field = metricById(id).field;
  if (readings === null || field === null) return null;
  return readings[field];
}

/** Why a value is missing, using the device's own availability mask. */
function absenceReason(id: MetricId, readings: ReadingBlock | null, warming: boolean): string {
  const metric = metricById(id);
  if (warming && id === 'gas') {
    return 'the gas heater and baseline have not settled yet; the device sends no value for about 90 s after power-up';
  }
  if (readings === null) return 'the service has no reading stored for this device yet';
  if (metric.faultBit === null) return 'the device did not report this in the latest snapshot';
  return 'the device raised an availability condition for this input, so it sent no value';
}

export interface EnvironmentalGridProps {
  readonly readings: ReadingBlock | null;
  readonly thresholds: Thresholds | null;
  readonly zoneStatus: StatusBlock;
  readonly transport: Transport;
  /** The device's gas-path state, so the gas cell can say why it is empty. */
  readonly gasWarming: boolean;
  readonly gasState: string;
}

export const EnvironmentalGrid = memo(function EnvironmentalGrid({
  readings,
  thresholds,
  zoneStatus,
  transport,
  gasWarming,
  gasState,
}: EnvironmentalGridProps) {
  // Measured against the browser clock, not read from `transport.stale` — that
  // field is the service's own comparison performed once and frozen, so it keeps
  // saying "fine" after the device has stopped. See lib/freshness.ts.
  const freshness = useFreshness(transport);
  return (
    <div className="readings readings--grid3" role="group" aria-label="Environmental conditions, six cells">
      {ENV_METRICS.map((id) => {
        const metric = metricById(id);
        const value = readingFor(readings, id);

        if (metric.absence !== null) {
          return (
            <div className="reading reading--absent" key={id}>
              <p className="reading__label">{metric.title}</p>
              <p className="reading__value">
                <span className="reading__number reading__number--absent">not installed</span>
              </p>
              <p className="reading__foot">
                <span className="reading__foot-mark">
                  <Mark shape="hatched-diamond" className="mark--sm" /> no sensor fitted
                </span>
                {metric.absence.part}
              </p>
            </div>
          );
        }

        const bounds = boundsFor(id, thresholds);
        const target =
          bounds.length === 0
            ? 'no limit configured on the device'
            : bounds.map((bound) => `${bound.label} ${number(bound.value, metric.digits)} ${metric.unit}`).join(' · ');

        const secondarySpec = metric.secondary;
        const secondary = secondarySpec === null || readings === null ? null : readings[secondarySpec.field];

        return (
          <div className="reading" key={id} data-tone={value === null ? 'unknown' : undefined}>
            <p className="reading__label">
              {metric.title}
              {value === null ? <Mark shape="hatched-diamond" className="mark--sm" /> : null}
            </p>
            <p className="reading__value">
              {value === null ? (
                <>
                  <span className="reading__number reading__number--absent">not reported</span>
                </>
              ) : (
                <>
                  <span className="reading__number">{number(value, metric.digits)}</span>
                  <span className="reading__unit">{metric.unit}</span>
                </>
              )}
            </p>
            <p className="reading__foot">
              {value === null ? absenceReason(id, readings, gasWarming) : target}
            </p>
            {secondary === null || secondary === undefined || secondarySpec === null ? null : (
              <p className="reading__sub">
                <span className="num">
                  {number(secondary, secondarySpec.digits)} {secondarySpec.unit}
                </span>{' '}
                {secondarySpec.label}
                {metric.qualification === null ? null : ` · ${metric.qualification}`}
              </p>
            )}
            {id === 'gas' && value === null && !gasWarming ? (
              <p className="reading__sub">Gas path: {humaniseLabel(gasState)}</p>
            ) : null}
          </div>
        );
      })}

      {/*
        The zone verdict and the freshness of the numbers, once, at the foot of
        the grid rather than repeated in six cells. §37: always a word beside the
        colour. §39: the operational verdict belongs above, so this is a pointer
        to it and not a second, competing statement of it.
      */}
      <p className="reading-foot-note">
        <StatusChip status={zoneStatus} /> — the device reports one verdict for the zone and it covers all six cells.
        Nothing here re-derives a status from a number. Last accepted snapshot {freshness.since ?? 'unknown'}
        {freshness.stale ? ' — stale, so these are historical and nothing on this grid is live.' : '.'}
        {thresholds === null ? ' The device reported no configuration block, so no limits are shown.' : null}
      </p>
    </div>
  );
});
