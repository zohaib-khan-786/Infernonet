/**
 * Domain vocabulary shared by ingest, read and realtime.
 *
 * The device is authoritative for every value in here. This module only names
 * things and turns the device's 16-bit fault mask into readable names; it never
 * derives a freshness verdict.
 */

/** Firmware `FreshnessStatus` enum: Fresh, UseSoon, CheckFood, SensorFault. */
export const STATUS_FRESH = 0;
export const STATUS_USE_SOON = 1;
export const STATUS_CHECK_FOOD = 2;
export const STATUS_SENSOR_FAULT = 3;

export const STATUS_LABELS = ['fresh', 'use_soon', 'check_food', 'sensor_fault'];

export function statusLabel(code) {
  return STATUS_LABELS[code] ?? 'unknown';
}

export const statusWithLabel = (code) => ({ code, label: statusLabel(code) });

/**
 * Fault-mask bit map, copied from `FreshGuard.ino`. Bit *class* decides how a
 * condition is presented (R-09 vs R-10 vs optional hardware), which is why the
 * class is carried alongside each name.
 */
export const FAULT_BITS = {
  // Bit 0 is the fitted BME280 (temperature + pressure). The device validates
  // chip id 0x60, so this is the BME280 part specifically, not a generic
  // barometer.
  0: { name: 'bme280', class: 'sensor' },
  // Bit 1 is the humidity path. The DHT11 that used to own it has been removed:
  // the BME280 measures humidity itself, and this bit is set when the humidity
  // read is invalid while the rest of the chip is answering. It stays a separate
  // bit so "humidity is unavailable" stays distinguishable from "the chip is
  // gone", which are different faults with different fixes.
  1: { name: 'bme280_humidity', class: 'sensor' },
  2: { name: 'ads1115', class: 'sensor' },
  3: { name: 'mq135', class: 'sensor' },
  4: { name: 'ds3231', class: 'sensor' },
  5: { name: 'pcf8574_read', class: 'sensor' },
  6: { name: 'pcf8574_write', class: 'sensor' },
  7: { name: 'reed', class: 'sensor' },
  8: { name: 'littlefs', class: 'storage' },
  9: { name: 'inventory', class: 'storage' },
  10: { name: 'alert_queue', class: 'storage' },
  11: { name: 'configuration', class: 'storage' },
  12: { name: 'rc522', class: 'optional' },
  13: { name: 'lcd', class: 'optional' },
};

export const GAS_STATES = ['warming_up', 'capturing_baseline', 'ready', 'faulted'];
export const WARMING_GAS_STATES = new Set(['warming_up', 'capturing_baseline']);

/** Expand a 16-bit mask into `{ bit, name, class }` entries, lowest bit first. */
export function describeMask(mask) {
  const out = [];
  for (let bit = 0; bit < 16; bit += 1) {
    if ((mask & (1 << bit)) === 0) continue;
    const entry = FAULT_BITS[bit];
    if (!entry) continue; // Bits 14-15 are unused by the firmware.
    out.push({ bit, ...entry });
  }
  return out;
}
