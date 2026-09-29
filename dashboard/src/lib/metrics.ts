/**
 * The metric catalogue.
 *
 * ONE FILE, because a monitoring screen has exactly one answer to "what can
 * this device actually measure", and six places on screen that each had to be
 * told about it separately is six places to get it wrong.
 *
 * WHAT IS IN IT
 * -----------------------------------------------------------------------------
 * Six metrics, and only six, because the hardware is an ESP8266 with a BME280,
 * an MQ-135, an ADS1115, a DS3231, an RC522 and a reed switch. Two of the six
 * are NOT INSTALLED and are declared here as absences rather than invented as
 * readings:
 *
 *   Pi temperature     there is no Raspberry Pi in this build. The controller is
 *                      an ESP8266 and it reports no die temperature. Guide §7
 *                      asks for a "Pi temperature" card; the card exists and says
 *                      that the sensor is not fitted.
 *   Ambient temperature the BME280 sits INSIDE the cabinet and measures cabinet
 *                      air. There is no second temperature probe outside it, so
 *                      an "ambient" figure would be the cabinet figure with a
 *                      different label on it. Guide §10 lists one as "reference
 *                      only"; it is not available at all.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * -----------------------------------------------------------------------------
 * A metric is either a field the API returns, or an absence with a stated
 * reason. There is no third category, and in particular there is no category
 * where a page would like a number and one is manufactured. `field: null` is
 * the only way to say "nothing reports this", and `MetricCard` refuses to render
 * a value for a metric whose `field` is null.
 *
 * UNITS
 * -----------------------------------------------------------------------------
 * The gas metrics are millivolts. The MQ-135 is an uncalibrated resistive
 * sensor; the device reports the ADC divider output in millivolts and a delta
 * from a stored baseline, in millivolts. Guide §7 card 4 shows "137.8 ppm" and
 * then warns against exactly that reading, and guide §46.14 is explicit. There
 * is no conversion to ppm anywhere in this project, and the `qualification`
 * field is what the UI prints next to the number.
 */
import type { ReadingField, Thresholds } from '../api/types';

export type MetricId = 'temperature' | 'humidity' | 'pressure' | 'gas' | 'pi_temperature' | 'ambient';

export interface MetricSpec {
  readonly id: MetricId;
  readonly title: string;
  /** The name on a KPI card, which is shorter than the panel title. */
  readonly cardTitle: string;
  /** The readings field this metric is made of, or `null` when nothing reports it. */
  readonly field: ReadingField | null;
  /** A second field shown under the first, where one exists. */
  readonly secondary: { readonly field: ReadingField; readonly label: string; readonly unit: string; readonly digits: number } | null;
  readonly unit: string;
  readonly digits: number;
  /** The firmware's own name for the part, from the fault-bit map. */
  readonly sensor: string | null;
  /** A sentence about where the number comes from. */
  readonly provenance: string;
  /** Printed beside the value whenever the reading is not a calibrated measurement. */
  readonly qualification: string | null;
  /** Non-null exactly when the hardware is not part of this build. */
  readonly absence: { readonly part: string; readonly reason: string } | null;
  /** The fault bit whose presence explains this metric being absent from a snapshot. */
  readonly faultBit: string | null;
  /** True when the value is a change from a baseline rather than a level. */
  readonly isDelta: boolean;
}

export const METRICS: readonly MetricSpec[] = [
  {
    id: 'temperature',
    title: 'Cabinet temperature',
    cardTitle: 'Temperature',
    field: 'temperature_c',
    secondary: null,
    unit: '°C',
    digits: 1,
    sensor: 'bme280',
    provenance: 'BME280 on the I²C bus, validated by chip id 0x60. The device reports the whole chip as one fault bit, so an absent temperature and an absent pressure are the same fault.',
    qualification: null,
    absence: null,
    faultBit: 'bme280',
    isDelta: false,
  },
  {
    id: 'humidity',
    title: 'Relative humidity',
    cardTitle: 'Humidity',
    field: 'humidity_pct',
    secondary: null,
    unit: '% RH',
    digits: 1,
    sensor: 'bme280_humidity',
    provenance: 'The humidity path of the same BME280. It is a separate fault bit from the temperature path, so "humidity is unavailable" stays distinguishable from "the chip is gone".',
    qualification: null,
    absence: null,
    faultBit: 'bme280_humidity',
    isDelta: false,
  },
  {
    id: 'pressure',
    title: 'Barometric pressure',
    cardTitle: 'Pressure',
    field: 'pressure_hpa',
    secondary: null,
    unit: 'hPa',
    digits: 1,
    sensor: 'bme280',
    provenance: 'Absolute pressure from the same BME280, measured inside the cabinet. It is atmospheric pressure, not a refrigerant pressure: there is no pressure transducer in this build.',
    qualification: null,
    absence: null,
    faultBit: 'bme280',
    isDelta: false,
  },
  {
    id: 'gas',
    title: 'Gas sensor output',
    cardTitle: 'Air quality',
    field: 'gas_delta_mv',
    secondary: { field: 'gas_input_mv', label: 'Divider output', unit: 'mV', digits: 1 },
    unit: 'mV delta',
    digits: 1,
    sensor: 'mq135',
    provenance:
      'MQ-135 on the analogue input. The device reports the ADC divider reading in millivolts and a delta from a baseline captured after the heater settles. The heater and baseline take about 90 s after every power-up, and the device reports no gas value at all during that window.',
    qualification: 'relative · uncalibrated · not a gas concentration',
    absence: null,
    faultBit: 'mq135',
    isDelta: true,
  },
  {
    id: 'pi_temperature',
    title: 'Pi temperature',
    cardTitle: 'Pi temperature',
    field: null,
    secondary: null,
    unit: '°C',
    digits: 1,
    sensor: null,
    provenance: '',
    qualification: null,
    absence: {
      part: 'a host CPU temperature sensor',
      reason:
        'There is no Raspberry Pi in this build. The controller is an ESP8266, and the ESP8266 does not report a die temperature. The API has no field for one, so no value can be shown.',
    },
    faultBit: null,
    isDelta: false,
  },
  {
    id: 'ambient',
    title: 'Ambient temperature',
    cardTitle: 'Ambient temperature',
    field: null,
    secondary: null,
    unit: '°C',
    digits: 1,
    sensor: null,
    provenance: '',
    qualification: null,
    absence: {
      part: 'a second temperature probe outside the cabinet',
      reason:
        'The BME280 is fitted inside the cabinet and measures cabinet air. Nothing measures the room. An "ambient" figure here would be the cabinet figure relabelled, which is the kind of number guide §46.2 exists to prevent.',
    },
    faultBit: null,
    isDelta: false,
  },
];

/**
 * The metrics a KPI card is shown for (guide §7: five cards).
 *
 * A separate list from `METRICS` because the two are not the same question.
 * §7 asks for five headline cards; §10 asks for a six-cell environment grid;
 * the catalogue answers "what exists" for both and neither should be shaped by
 * the other's layout.
 */
export const CARD_METRICS: readonly MetricId[] = ['temperature', 'humidity', 'pressure', 'gas', 'pi_temperature'];

export const ENV_METRICS: readonly MetricId[] = ['temperature', 'humidity', 'gas', 'pressure', 'pi_temperature', 'ambient'];

const BY_ID = new Map(METRICS.map((metric) => [metric.id, metric] as const));

export function metricById(id: MetricId): MetricSpec {
  const found = BY_ID.get(id);
  if (found === undefined) throw new Error(`unknown metric: ${id}`);
  return found;
}

/**
 * The fields `LineChart` can plot.
 *
 * `LineChart`'s `MetricSpec.field` is a three-member union — temperature,
 * humidity, pressure — and that component is not in this pass's file
 * ownership. The gas series is therefore presented as figures rather than as a
 * trace rather than by forking a second chart engine to draw one more field.
 * This list is the single place that has to change when that component grows.
 */
export const CHARTABLE: readonly MetricId[] = ['temperature', 'humidity', 'pressure'];

/* ---------------------------------------------------------------------------
 * Bands
 * ------------------------------------------------------------------------- */

/** A min/max pair the device itself is applying, with where it came from. */
export interface MetricBand {
  readonly min: number;
  readonly max: number;
  readonly source: string;
}

/**
 * One threshold boundary, named.
 *
 * Guide §9 draws five lines and says, in the same breath, "do not rely solely on
 * colour; labels must exist". So a boundary is never a coloured rule with
 * nothing written on it: it is a number, a unit and a sentence saying what
 * crossing it means, and the chart legend prints the same three.
 */
export interface LabelledBound {
  readonly label: string;
  readonly value: number;
  readonly meaning: string;
}

const DEVICE_SOURCE = 'from the device’s own configuration';

/**
 * The band a metric is judged against, or `null` when the device configures
 * none.
 *
 * `null` is a real answer for three of the six metrics and is rendered as one.
 * No fallback band is invented, and in particular the guide's illustrative
 * "950–1,050 hPa" is NOT applied to barometric pressure: it is a wireframe
 * example, the device configures no pressure limit, and adopting it would put a
 * number on screen that nothing in the system ever decided.
 *
 * The gas path is also `null` here, and that is a different kind of `null` from
 * pressure's. A pressure limit is absent. A gas delta has two boundaries that
 * are not a range at all: below `clear` the path is settled, above `abnormal`
 * the zone is flagged, and the band between them is not "in range", it is the
 * region in which nothing has been decided. `boundsFor` returns both, named.
 */
export function bandFor(id: MetricId, thresholds: Thresholds | null): MetricBand | null {
  if (thresholds === null) return null;
  switch (id) {
    case 'temperature':
      return { min: thresholds.temperature_min_c, max: thresholds.temperature_max_c, source: DEVICE_SOURCE };
    case 'humidity':
      return { min: thresholds.humidity_min_pct, max: thresholds.humidity_max_pct, source: DEVICE_SOURCE };
    default:
      return null;
  }
}

export function boundsFor(id: MetricId, thresholds: Thresholds | null): readonly LabelledBound[] {
  if (thresholds === null) return [];
  switch (id) {
    case 'temperature':
      return [
        { label: 'Target minimum', value: thresholds.temperature_min_c, meaning: 'Below this the zone is colder than the device is configured to accept.' },
        { label: 'Target maximum', value: thresholds.temperature_max_c, meaning: 'Above this the device flags the zone and, for some items, the food with it.' },
      ];
    case 'humidity':
      return [
        { label: 'Target minimum', value: thresholds.humidity_min_pct, meaning: 'Below this, stored food dries out and loses quality.' },
        { label: 'Target maximum', value: thresholds.humidity_max_pct, meaning: 'Above this, condensation and mould become likely.' },
      ];
    case 'gas':
      return [
        { label: 'Clear', value: thresholds.gas_delta_clear_mv, meaning: 'A rise over baseline below this is treated as settled. Must stay under the abnormal figure or the condition could never reset.' },
        { label: 'Abnormal', value: thresholds.gas_delta_abnormal_mv, meaning: 'A rise over baseline above this is raised as a condition. Millivolts, never a gas concentration.' },
      ];
    default:
      return [];
  }
}
