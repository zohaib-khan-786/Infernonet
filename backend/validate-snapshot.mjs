// OFFLINE validator. Imports the real ingest contract and checks a snapshot that
// was captured verbatim from the device's SNAPSHOT serial command against it.
// Starts no server, binds no port, opens no socket - it is a pure parse of the
// bytes the firmware actually emitted.
import { readFileSync } from 'node:fs';
import { snapshotSchema } from '../backend/src/ingest/contract.js';

const file = process.argv[2];
const raw = readFileSync(file, 'utf8');

const lines = raw.split(/\r?\n/);
const start = lines.findIndex((l) => l.includes('[Snapshot] begin'));
const end = lines.findIndex((l) => l.includes('[Snapshot] end'));
if (start < 0 || end < 0) {
  console.error('no [Snapshot] begin/end markers in', file);
  process.exit(2);
}

// The payload is one logical JSON document but the serial logger wraps it, so
// reassemble by stripping the capture's own timing lines and concatenating.
const body = lines
  .slice(start + 1, end)
  .filter((l) => !l.startsWith('--- t+') && !l.startsWith('<<<'))
  .join('');

let parsed;
try {
  parsed = JSON.parse(body);
} catch (e) {
  console.error('SNAPSHOT IS NOT VALID JSON:', e.message);
  process.exit(1);
}

const result = snapshotSchema.safeParse(parsed);
if (!result.success) {
  console.error('CONTRACT REJECTED the device snapshot:');
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

console.log('contract: ACCEPTED');
console.log('  time_source   :', parsed.time_source);
console.log('  time_valid    :', parsed.time_valid);
console.log('  clock_offset_s:', parsed.clock_offset_s);
console.log('  epoch         :', parsed.epoch);
console.log('  rtc_alive     :', parsed.rtc_alive);
console.log('  rtc_battery_low:', parsed.rtc_battery_low);
console.log('  items         :', parsed.items?.length, '| events:', parsed.events?.length ?? 0);
console.log('  payload bytes :', body.length);
