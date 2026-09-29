/**
 * Environment readings.
 *
 * Laid out as a data logger's front panel: labelled cells divided by seams, one
 * measurement each, values in tabular mono. The important behaviour is in the
 * absent values.
 *
 * A `null` from this API means "the device did not have this". It is never a
 * zero, and it is never left as a blank cell: each absence is named, and where
 * the device's own availability mask explains it, the mask's name is used
 * (`BME280 not producing data`) rather than a generic "unavailable". The MQ-135
 * cells are labelled in millivolts and relative millivolts, because that is the
 * only thing the hardware reports — the dashboard never converts them to a gas
 * concentration.
 */
import { memo } from 'react';
import type { DeviceBlock, ReadingBlock, Transport } from '../api/types';
import { ago, dateTime, humaniseLabel, number, span } from '../lib/format';
import { Mark } from './Mark';

/** Which firmware fault bit explains an absent value for each measurement. */
const FAULT_FOR: Readonly<Record<string, string>> = {
  temperature_c: 'bme280',
  pressure_hpa: 'bme280',
  humidity_pct: 'bme280_humidity',
  gas_input_mv: 'mq135',
  gas_delta_mv: 'mq135',
};

interface ReadingCellProps {
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly digits: number;
  /** Why the value is absent, if it is. */
  readonly absence: string | null;
  /** Extra line under the value: a device-configured band, a state, a note. */
  readonly foot?: string;
  readonly flagged?: boolean;
  readonly tone?: 'unknown';
}

/**
 * A single cell. `min-height` on the value and the foot line is deliberate: the
 * panel must not change shape as values arrive, drop out, or come back.
 */
const ReadingCell = memo(function ReadingCell({
  label,
  value,
  unit,
  digits,
  absence,
  foot,
  flagged = false,
  tone,
}: ReadingCellProps) {
  const titleId = `${label.replace(/\W+/g, '-')}-absence`;
  return (
    <div className={`reading${flagged ? ' reading--flag' : ''}`} data-tone={tone}>
      <p className="reading__label">
        {label}
        {flagged ? <Mark shape="triangle" className="mark--sm" /> : null}
      </p>
      <p className="reading__value">
        {value === null ? (
          <>
            <span className="reading__number reading__number--absent">not reported</span>
            <span className="visually-hidden" id={titleId}>
              . {absence}
            </span>
          </>
        ) : (
          <>
            <span className="reading__number">{number(value, digits)}</span>
            <span className="reading__unit">{unit}</span>
          </>
        )}
      </p>
      <p className="reading__foot">{value === null && absence !== null ? absence : foot}</p>
    </div>
  );
});

/** Why a value is missing, using the device's own availability mask. */
function absenceReason(
  field: string,
  device: DeviceBlock,
  gasState: string,
  warming: boolean,
): string {
  if (warming && FAULT_FOR[field] === 'mq135') {
    return 'gas path is warming up; the device sends no value yet (R-11)';
  }
  const bit = FAULT_FOR[field];
  if (bit !== undefined && device.unavailable.some((entry) => entry.name === bit)) {
    return `${bit} is not producing data (R-09)`;
  }
  if (gasState === 'faulted' && FAULT_FOR[field] === 'mq135') {
    return 'the device reports the gas path as faulted';
  }
  return 'the device did not report this in the latest snapshot';
}

interface FactsProps {
  readonly device: DeviceBlock;
  /** Sequence number of the latest reading, or null when none has been stored. */
  readonly seq: number | null;
  readonly transport: Transport;
}

const DeviceFacts = memo(function DeviceFacts({ device, seq, transport }: FactsProps) {
  const facts: { label: string; value: string }[] = [
    { label: 'Uptime', value: span(device.uptime_s) },
    { label: 'Boots', value: number(device.boot_count, 0) },
    { label: 'Reading sequence', value: seq === null ? 'no reading yet' : number(seq, 0) },
    { label: 'Device sequence', value: number(device.seq, 0) },
    { label: 'Inventory revision', value: number(device.inv_revision, 0) },
    {
      label: 'Queue pending',
      value: device.pending_count === null ? 'not reported' : number(device.pending_count, 0),
    },
    { label: 'Firmware', value: device.firmware ?? 'not reported' },
    {
      label: 'Door timeout',
      value: device.door_timeout_ms === null ? '—' : `${number(device.door_timeout_ms / 1000, 0)} s`,
    },
    {
      label: 'Samples latched',
      value: device.consecutive_samples === null ? '—' : number(device.consecutive_samples, 0),
    },
    { label: 'Contract', value: `v${device.contract_version}` },
    { label: 'First seen', value: dateTime(device.first_seen_at) },
  ];

  return (
    <div className="facts">
      {facts.map((fact) => (
        <div className="fact" key={fact.label}>
          <span className="fact__label">{fact.label}</span>
          <span className="fact__value" translate="no">
            {fact.value}
          </span>
        </div>
      ))}
      <div className="fact">
        <span className="fact__label">Last accepted snapshot</span>
        <span className="fact__value">
          {ago(transport.age_seconds)} · {transport.stale ? 'stale' : 'within threshold'}
        </span>
      </div>
    </div>
  );
});

const GAS_STATE_TEXT: Readonly<Record<string, string>> = {
  warming_up: 'Warming up',
  capturing_baseline: 'Capturing baseline',
  ready: 'Ready',
  faulted: 'Faulted',
};

export interface ReadingsPanelProps {
  readonly device: DeviceBlock;
  readonly readings: ReadingBlock | null;
  readonly transport: Transport;
  readonly fullSnapshot: boolean;
}

export const ReadingsPanel = memo(function ReadingsPanel({
  device,
  readings,
  transport,
  fullSnapshot,
}: ReadingsPanelProps) {
  const thresholds = device.thresholds;
  const warming = device.gas.warming_or_baselining;
  const gasState = device.gas.state;
  const warmingDescription = warming
    ? 'Expected for about 90 s after power-up. The device reports no value during this time, and that is normal (R-11).'
    : null;

  const doorValue = device.door.stale ? 'Unknown' : device.door.open ? 'Open' : 'Closed';
  const doorFoot = device.door.stale
    ? 'The reed input is not reporting, so the door state is unknown (R-12).'
    : device.door.open
      ? 'Open now. The freshness status itself is unchanged by the door (R-12).'
      : 'Closed.';

  return (
    <section className="panel" aria-labelledby="readings-title">
      <div className="panel__head">
        <h2 className="panel__title" id="readings-title">
          Environment
        </h2>
        {readings === null ? (
          <p className="panel__sub">No reading received yet</p>
        ) : (
          <p className="panel__sub">
            Last accepted reading <span className="num">{ago(transport.age_seconds)}</span>
            {readings.time_valid ? (
              <>
                {' · device clock '}
                <span className="num">{dateTime(readings.reported_at)}</span>
              </>
            ) : (
              ' · device clock not trusted, showing the service receipt time'
            )}
          </p>
        )}
        {fullSnapshot ? null : (
          <p className="hint">
            The last snapshot from this device was partial, so any change to the food list arrived earlier.
          </p>
        )}
      </div>

      {readings === null ? (
        <div className="panel__body">
          <p className="note">
            The service has this device, but it has not stored a reading for it. The device appears in the list as soon
            as its first snapshot is accepted, so this panel fills in on the next one.
          </p>
        </div>
      ) : (
        <div className="readings">
          <ReadingCell
            label="Temperature"
            value={readings.temperature_c}
            unit="°C"
            digits={1}
            absence={absenceReason('temperature_c', device, gasState, warming)}
            foot={
              thresholds
                ? `device band ${number(thresholds.temperature_min_c, 0)} to ${number(thresholds.temperature_max_c, 0)} °C`
                : 'band not reported'
            }
          />
          <ReadingCell
            label="Humidity"
            value={readings.humidity_pct}
            unit="% RH"
            digits={1}
            absence={absenceReason('humidity_pct', device, gasState, warming)}
            foot={
              thresholds
                ? `device band ${number(thresholds.humidity_min_pct, 0)} to ${number(thresholds.humidity_max_pct, 0)}%`
                : 'band not reported'
            }
          />
          <ReadingCell
            label="Pressure"
            value={readings.pressure_hpa}
            unit="hPa"
            digits={1}
            absence={absenceReason('pressure_hpa', device, gasState, warming)}
            foot="atmospheric, from the same sensor as temperature"
          />
          <ReadingCell
            label="Gas input"
            value={readings.gas_input_mv}
            unit="mV"
            digits={1}
            absence={absenceReason('gas_input_mv', device, gasState, warming)}
            foot={
              warmingDescription ?? 'Divider output in millivolts. Not a gas concentration, and never ppm.'
            }
            flagged={warming}
          />
          <ReadingCell
            label="Gas delta"
            value={readings.gas_delta_mv}
            unit="mV"
            digits={1}
            absence={absenceReason('gas_delta_mv', device, gasState, warming)}
            foot={
              thresholds
                ? `difference from the stored baseline, in millivolts. Device clear value ${number(thresholds.gas_delta_clear_mv, 0)} mV.`
                : 'difference from the stored baseline, in millivolts'
            }
            flagged={warming}
          />
          <div className="reading">
            <p className="reading__label">Door</p>
            <p className="reading__value">
              <span className="reading__number">{doorValue}</span>
            </p>
            <p className="reading__foot">{doorFoot}</p>
          </div>
          <div className="reading">
            <p className="reading__label">Gas path</p>
            <p className="reading__value">
              <span className="reading__number">{GAS_STATE_TEXT[gasState] ?? humaniseLabel(gasState)}</span>
            </p>
            <p className="reading__foot">
              {warmingDescription ?? 'The MQ-135 heater and baseline are settled; values can be read.'}
            </p>
          </div>
        </div>
      )}

      <div className="panel__foot">
        <DeviceFacts device={device} seq={readings?.seq ?? null} transport={transport} />
      </div>
    </section>
  );
});
