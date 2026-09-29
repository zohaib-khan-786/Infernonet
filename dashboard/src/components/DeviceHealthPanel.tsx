/**
 * Device health (guide §12).
 *
 * This is the one panel in the product that is built entirely out of the
 * device's own fault map, which makes it unusual: it is a list of the fourteen
 * bits the firmware maintains, and for each one the bit's own meaning. The list
 * is not a list of components a marketing page would like, it is a list of
 * components the firmware can actually fail to hear from.
 *
 * WHY A CLEAR BIT IS REPORTED AS "REPORTING" AND NOT AS "HEALTHY"
 * -----------------------------------------------------------------------------
 * A bit is set when a required input stops producing data, or when a debounced
 * read fails. A clear bit therefore means the input answered in the snapshot we
 * are looking at — and nothing more. It is not a calibration check, not a
 * accuracy figure and not a lifetime counter, and the panel says so in the
 * legend rather than in a footnote.
 *
 * WHY THE GUIDE'S OWN COMPONENT LIST IS NOT USED
 * -----------------------------------------------------------------------------
 * §12 lists a Raspberry Pi 4, a DHT11, a BMP280, a "pressure sensor" and a
 * "refrigeration controller". Of those, three do not exist in this build and
 * two are the wrong part:
 *
 *   Raspberry Pi 4           there is no Pi. The controller is an ESP8266.
 *   DHT11                     removed. The BME280 measures humidity itself, and
 *                            the firmware keeps bit 1 specifically so that
 *                            "humidity is unavailable" stays distinguishable
 *                            from "the chip is gone".
 *   BMP280                    the fitted part is a BME280, and the firmware
 *                            validates chip id 0x60 to say so.
 *   pressure sensor           there is none. The pressure figure is ambient
 *                            barometric pressure from the BME280, not a
 *                            refrigerant transducer.
 *   refrigeration controller  there is none; the board does not drive a plant.
 *
 * They are listed at the foot, as absent, rather than being quietly dropped —
 * §36 says an absence is a designed state and §46.13 says do not fake one.
 *
 * ERROR COUNTS AND FIRMWARE
 * -----------------------------------------------------------------------------
 * §12 asks for an error count per item. The service stores a 16-bit fault mask
 * and nothing else: there is no counter, no per-part error log and no firmware
 * version per part. Each row therefore says "not recorded" and says why, once,
 * for the whole table. Inventing a count from "the bit is set" would produce a
 * number that is always 0 or 1 and would read as an error tally.
 */
import { memo } from 'react';
import type { DeviceBlock, ReadingBlock, Transport } from '../api/types';
import { ago, humaniseLabel, number, span } from '../lib/format';
import { Mark } from './Mark';
import { StatusChip } from './StatusChip';

interface Part {
  readonly bit: number;
  readonly name: string;
  readonly class: 'sensor' | 'storage' | 'optional';
  /** What it is, in one line. */
  readonly what: string;
  /** The reading this part produces, if it produces one. */
  readonly reading: (readings: ReadingBlock | null) => number | null;
  readonly unit: string;
  readonly digits: number;
}

/**
 * The firmware's fault map, transcribed.
 *
 * `bit`, `name` and `class` are `FAULT_BITS` in `backend/src/domain.js`, which
 * is copied from `FreshGuard.ino`. Only the `what` sentence and the reading
 * mapping are added here, and neither can change a state.
 */
const PARTS: readonly Part[] = [
  { bit: 0, name: 'bme280', class: 'sensor', what: 'Temperature and barometric pressure. Validated by chip id 0x60.', reading: (r) => r?.temperature_c ?? null, unit: '°C', digits: 1 },
  { bit: 1, name: 'bme280_humidity', class: 'sensor', what: 'The humidity path of the same chip, kept as its own bit on purpose.', reading: (r) => r?.humidity_pct ?? null, unit: '% RH', digits: 1 },
  { bit: 2, name: 'ads1115', class: 'sensor', what: '16-bit analogue-to-digital converter. The gas input is read through it.', reading: () => null, unit: '', digits: 1 },
  { bit: 3, name: 'mq135', class: 'sensor', what: 'Uncalibrated gas sensor. Millivolts only, never a concentration.', reading: (r) => r?.gas_delta_mv ?? null, unit: 'mV delta', digits: 1 },
  { bit: 4, name: 'ds3231', class: 'sensor', what: 'Real-time clock with a backup battery. Its trust decides whether storage times can be judged at all.', reading: () => null, unit: '', digits: 1 },
  { bit: 5, name: 'pcf8574_read', class: 'sensor', what: 'I/O expander input bank.', reading: () => null, unit: '', digits: 1 },
  { bit: 6, name: 'pcf8574_write', class: 'sensor', what: 'I/O expander output bank.', reading: () => null, unit: '', digits: 1 },
  { bit: 7, name: 'reed', class: 'sensor', what: 'Door switch. Reports open or closed, or nothing at all when it has stopped responding.', reading: () => null, unit: '', digits: 1 },
  { bit: 8, name: 'littlefs', class: 'storage', what: 'On-board flash filesystem. A fault here is an administration problem; freshness is unaffected.', reading: () => null, unit: '', digits: 1 },
  { bit: 9, name: 'inventory', class: 'storage', what: 'The stored-food table. A fault here is an administration problem; freshness is unaffected.', reading: () => null, unit: '', digits: 1 },
  { bit: 10, name: 'alert_queue', class: 'storage', what: 'The unsent event queue. A full queue delays events; it does not change any verdict.', reading: () => null, unit: '', digits: 1 },
  { bit: 11, name: 'configuration', class: 'storage', what: 'Stored configuration, including the thresholds this device is applying.', reading: () => null, unit: '', digits: 1 },
  { bit: 12, name: 'rc522', class: 'optional', what: 'RFID reader for tagging stored food. Optional: the device keeps monitoring without it.', reading: () => null, unit: '', digits: 1 },
  { bit: 13, name: 'lcd', class: 'optional', what: 'Local display. Optional, and the dashboard reads nothing from it.', reading: () => null, unit: '', digits: 1 },
];

const CLASS_WORD: Readonly<Record<Part['class'], string>> = {
  sensor: 'Required input',
  storage: 'Storage / administration',
  optional: 'Optional hardware',
};

interface RowProps {
  readonly part: Part;
  readonly unavailable: boolean;
  readonly confirmedFault: boolean;
  readonly readings: ReadingBlock | null;
  readonly warming: boolean;
}

const PartRow = memo(function PartRow({ part, unavailable, confirmedFault, readings, warming }: RowProps) {
  const faulted = unavailable || confirmedFault;
  const value = faulted ? null : part.reading(readings);
  const warmingHere = warming && part.name === 'mq135';

  const word = unavailable ? 'Not producing data' : confirmedFault ? 'Confirmed fault' : 'Reporting';
  const tone = unavailable || confirmedFault ? 'unknown' : 'neutral';
  const shape = unavailable || confirmedFault ? 'hatched-diamond' : 'circle';

  return (
    <tr>
      <th scope="row" className="cell-head">
        <span className="part-cell">
          <span className="part-cell__name">{part.name}</span>
          <span className="part-cell__class">{CLASS_WORD[part.class]}</span>
        </span>
      </th>
      <td>
        <span className="chip" data-tone={tone}>
          <Mark shape={shape} className="mark--sm" />
          {word}
        </span>
        <span className="part-cell__what">{part.what}</span>
      </td>
      <td className="cell-num">
        {warmingHere ? (
          <span className="withheld">
            <span className="withheld__value">warming up</span>
            <span className="withheld__note">the MQ-135 heater and baseline settle for about 90 s after power-up</span>
          </span>
        ) : part.unit === '' ? (
          <span className="part-cell__na">no reading</span>
        ) : value === null ? (
          <span className="withheld">
            <span className="withheld__value">none</span>
            <span className="withheld__note">no value in the latest snapshot</span>
          </span>
        ) : (
          <span className="num">
            {number(value, part.digits)} {part.unit}
          </span>
        )}
      </td>
      <td className="cell-num">
        <span className="part-cell__na">not recorded</span>
      </td>
    </tr>
  );
});

export interface DeviceHealthPanelProps {
  readonly device: DeviceBlock;
  readonly readings: ReadingBlock | null;
  readonly transport: Transport;
}

export const DeviceHealthPanel = memo(function DeviceHealthPanel({ device, readings, transport }: DeviceHealthPanelProps) {
  const unavailable = new Set(device.unavailable.map((entry) => entry.name));
  const confirmed = new Set(device.confirmed_faults.map((entry) => entry.name));
  const faultCount = unavailable.size + confirmed.size;

  return (
    <section className="panel" aria-labelledby="health-title">
      <div className="panel__head">
        <h2 className="panel__title" id="health-title">
          Device health
        </h2>
        <p className="panel__sub">
          {faultCount === 0 ? (
            <>No fault bit is set in the latest snapshot</>
          ) : (
            <>
              <span className="num">{faultCount}</span> fault bit{faultCount === 1 ? '' : 's'} set
            </>
          )}
          {' · '}firmware {device.firmware ?? 'not reported'}
        </p>
        <div className="panel__tools">
          <StatusChip status={device.overall_status} />
        </div>
      </div>

      <div className="panel__body">
        <p className="note">
          A clear bit means the input answered in the snapshot below. It is not a calibration check and not a lifetime
          count. There is no per-part error counter in the service — the device sends a 16-bit fault mask and nothing
          else — so that column reads &quot;not recorded&quot; rather than showing a number that would only ever be 0 or
          1.
        </p>
      </div>

      <div className="food-table-scroll" tabIndex={0} role="region" aria-label="Device health table">
        <table className="data-table part-table">
          <caption className="visually-hidden">
            Every part in the device&apos;s fault map, with whether it reported in the latest accepted snapshot, its
            last reading where it produces one, and its error count, which the service does not record.
          </caption>
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">State in the latest snapshot</th>
              <th scope="col" className="cell-num">
                Last reading
              </th>
              <th scope="col" className="cell-num">
                Error count
              </th>
            </tr>
          </thead>
          <tbody>
            {PARTS.map((part) => (
              <PartRow
                key={part.bit}
                part={part}
                unavailable={unavailable.has(part.name)}
                confirmedFault={confirmed.has(part.name)}
                readings={readings}
                warming={device.gas.warming_or_baselining}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel__body">
        <h3 className="chart__title">Parts the guide lists that are not in this build</h3>
        <ul className="absence-list">
          <li>
            <strong>Raspberry Pi.</strong> There is no Pi here; the controller is an ESP8266. The guide&apos;s Pi
            temperature and Pi-cooling pages are built on the Refrigeration page, each stating what would be measured.
          </li>
          <li>
            <strong>DHT11.</strong> Removed. The BME280 measures humidity, and firmware bit 1 exists so that a humidity
            read failure stays distinguishable from a missing chip.
          </li>
          <li>
            <strong>BMP280.</strong> The fitted part is a BME280, validated by chip id <span className="num">0x60</span>.
            Bit 0 is named for it, so the firmware and this table use the BME280 name.
          </li>
          <li>
            <strong>Refrigeration controller, pressure transducers, coolant probes.</strong> None fitted. The pressure
            figure on the dashboard is ambient barometric pressure from the BME280, not a refrigerant pressure.
          </li>
        </ul>
      </div>

      <div className="panel__foot">
        <div className="facts">
          <div className="fact">
            <span className="fact__label">Uptime</span>
            <span className="fact__value">{span(device.uptime_s)}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Boots</span>
            <span className="fact__value">{number(device.boot_count, 0)}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Reading sequence</span>
            <span className="fact__value">{readings === null ? 'none stored' : number(readings.seq, 0)}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Samples latched</span>
            <span className="fact__value">
              {device.consecutive_samples === null ? 'not reported' : number(device.consecutive_samples, 0)}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Queue pending</span>
            <span className="fact__value">
              {device.pending_count === null ? 'not reported' : number(device.pending_count, 0)}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Inventory revision</span>
            <span className="fact__value">{number(device.inv_revision, 0)}</span>
          </div>
            <div className="fact">
              <span className="fact__label">Device clock</span>
              <span className="fact__value">
                {device.time_valid ? 'trusted' : 'not trusted — the service withholds every storage duration'}
              </span>
            </div>
          <div className="fact">
            <span className="fact__label">Gas path</span>
            <span className="fact__value">{humaniseLabel(String(device.gas.state))}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Last accepted snapshot</span>
            <span className="fact__value">
              {ago(transport.age_seconds)} {transport.stale ? '· stale' : '· within threshold'}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Contract</span>
            <span className="fact__value">v{number(device.contract_version, 0)}</span>
          </div>
          <div className="fact">
            <span className="fact__label">First seen</span>
            <span className="fact__value">{new Date(device.first_seen_at).toLocaleString()}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Last snapshot was</span>
            <span className="fact__value">{device.full_snapshot ? 'complete' : 'partial'}</span>
          </div>
        </div>
      </div>
    </section>
  );
});
