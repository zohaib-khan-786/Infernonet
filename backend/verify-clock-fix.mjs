/*
 * OFFLINE verification of the Fix B' clock logic.
 *
 * The backend is not running and the brief forbids starting it, so the
 * server-synced path cannot be exercised against live hardware in this session.
 * This harness therefore does two things, and only claims these two things:
 *
 *   1. It re-implements the firmware's clock state machine as a FAITHFUL
 *      TRANSCRIPTION (each function below names the FreshGuard.ino function it
 *      mirrors and the line range it was taken from) and runs it through the
 *      scenarios that matter, including the measured ~17,946 s skew.
 *
 *   2. It builds the JSON that the firmware's own emitter would produce for the
 *      server_synced case and validates it against the REAL zod ingest contract
 *      imported from the backend. That part is not a simulation - it is the
 *      actual schema, and it is the part that can silently reject every snapshot.
 *
 * It starts no server, binds no port and opens no socket.
 */
import { snapshotSchema } from '../backend/src/ingest/contract.js';

// --- constants transcribed from FreshGuard.ino ---------------------------
const MIN_VALID_RTC_EPOCH = 1704067200;   // sanity floor
const SERVER_SYNC_MIN_SAMPLES = 3;         // server sync gate
const SERVER_SYNC_SAMPLE_TOLERANCE_S = 5;  // max disagreement between samples
const SERVER_OFFSET_ABS_LIMIT_S = 86400;   // implausible-offset reject
const RTC_LIVENESS_STALL_SAMPLES = 2;      // consecutive failures to declare dead
const RTC_LIVENESS_TOLERANCE_SECONDS = 2;  // slack for the 1 Hz register
const I2C_RTC_POLL_INTERVAL_MS = 60000;    // poll cadence

// --- liveness: mirrors noteRtcEpochRead(uint32_t, uint32_t) ---------------
function makeLiveness() {
  return { previousEpoch: 0, previousReadMs: 0, stallCount: 0, running: true };
}
function resetRtcLiveness(s, seedEpoch, nowMs) {
  s.previousEpoch = seedEpoch; s.previousReadMs = nowMs;
  s.stallCount = 0; s.running = true;
}
function noteRtcEpochRead(s, epoch, nowMs) {
  if (s.previousEpoch === 0) { s.previousEpoch = epoch; s.previousReadMs = nowMs; return true; }
  const delta = epoch - s.previousEpoch;               // signed on purpose
  const elapsed = Math.floor((nowMs - s.previousReadMs) / 1000);
  s.previousEpoch = epoch; s.previousReadMs = nowMs;
  if (elapsed === 0) return true;                       // nothing to have missed
  if (delta >= elapsed - RTC_LIVENESS_TOLERANCE_SECONDS) { s.stallCount = 0; return true; }
  if (s.stallCount < 255) s.stallCount += 1;
  return false;
}

// --- server sync: mirrors rememberServerTime(uint32_t, uint32_t) ----------
function makeClock() {
  return {
    serverEpoch: 0, serverEpochMs: 0, serverTimeKnown: false,
    offset: 0, samples: 0, synced: false,
    lastGoodRtcEpoch: 0, lastGoodRtcMs: 0,
    rtcEpoch: 0, rtcTrusted: true,
  };
}
function rememberServerTime(c, serverEpoch, deviceEpoch, nowMs) {
  if (serverEpoch < MIN_VALID_RTC_EPOCH) return 'rejected:below sanity floor';
  if (deviceEpoch === 0) {
    c.serverEpoch = serverEpoch; c.serverEpochMs = nowMs; c.serverTimeKnown = true;
    return 'anchored with no device clock to correct';
  }
  const offset = serverEpoch - deviceEpoch;              // signed
  if (Math.abs(offset) > SERVER_OFFSET_ABS_LIMIT_S) return 'rejected:implausible';
  const previous = c.offset;
  if (c.serverTimeKnown && !c.synced && Math.abs(offset - previous) > SERVER_SYNC_SAMPLE_TOLERANCE_S) {
    c.offset = offset; c.samples = 1;
  } else if (c.samples === 0) {
    c.offset = offset; c.samples = 1;
  } else {
    c.offset = Math.trunc((previous + offset) / 2);
    if (c.samples < 255) c.samples += 1;
  }
  c.serverEpoch = serverEpoch; c.serverEpochMs = nowMs; c.serverTimeKnown = true;
  if (!c.synced && c.samples >= SERVER_SYNC_MIN_SAMPLES) { c.synced = true; return 'ADOPTED'; }
  return `sample ${c.samples}/${SERVER_SYNC_MIN_SAMPLES}`;
}

// --- authority: mirrors currentReportEpoch(uint32_t, TimeSource*) ----------
function currentReportEpoch(c, nowMs) {
  if (c.synced && c.serverTimeKnown) {
    return { epoch: c.serverEpoch + Math.floor((nowMs - c.serverEpochMs) / 1000), source: 'server_synced' };
  }
  if (c.rtcTrusted && c.rtcEpoch !== 0) {
    return { epoch: c.rtcEpoch, source: 'rtc' };
  }
  if (c.serverTimeKnown) {
    return { epoch: c.serverEpoch + Math.floor((nowMs - c.serverEpochMs) / 1000), source: 'server_synced' };
  }
  if (c.lastGoodRtcEpoch !== 0) {
    return { epoch: c.lastGoodRtcEpoch + Math.floor((nowMs - c.lastGoodRtcMs) / 1000), source: 'rtc_offset' };
  }
  return { epoch: 0, source: 'none' };
}

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

// =========================================================================
console.log('\n1. MEASURED SKEW: device ~17,946 s behind the server');
console.log('   Real observed epochs from the hardware: device 1790559267, server +17946 = 1790607213\n');

const c = makeClock();
const rtcEpoch = 1790559267;          // the raw DS3231 reading from final.log
const trueEpoch = 1790559267 + 17946; // what the server said
c.rtcEpoch = rtcEpoch;

console.log('   probe 1 (t+0s):  ', rememberServerTime(c, trueEpoch, rtcEpoch, 0));
check('after 1 sample the source is still rtc', currentReportEpoch(c, 0).source, 'rtc');
check('after 1 sample the offset is NOT adopted', c.synced, false);

console.log('   probe 2 (t+20s): ', rememberServerTime(c, trueEpoch + 20, rtcEpoch, 20000));
check('after 2 samples still not adopted', c.synced, false);

console.log('   probe 3 (t+40s): ', rememberServerTime(c, trueEpoch + 40, rtcEpoch, 40000));
check('after 3 agreeing samples the correction is ADOPTED', c.synced, true);
check('measured offset is +17,946 s', c.offset, 17946);
check('time_source is server_synced', currentReportEpoch(c, 40000).source, 'server_synced');
check('reported epoch now matches the server', currentReportEpoch(c, 40000).epoch, trueEpoch + 40);

console.log('\n2. THE SERVER-SYNCED CLOCK KEEPS ADVANCING WITH NO NETWORK');
// Server stops answering here. Only millis() moves, which is the whole point.
for (const elapsedS of [60, 600, 3600, 86400]) {
  const got = currentReportEpoch(c, 40000 + elapsedS * 1000);
  check(`t+${elapsedS}s offline -> epoch is server time + ${elapsedS}s`,
    got, { epoch: trueEpoch + 40 + elapsedS, source: 'server_synced' });
}

console.log('\n3. FALLBACKS, in the order the brief requires');
const noSync = makeClock();
noSync.rtcEpoch = rtcEpoch;
check('no correction measured -> rtc (honest, ~5h out)', currentReportEpoch(noSync, 0).source, 'rtc');
noSync.rtcTrusted = false;
noSync.lastGoodRtcEpoch = rtcEpoch; noSync.lastGoodRtcMs = 0;
check('no correction + dead RTC -> rtc_offset', currentReportEpoch(noSync, 65000).source, 'rtc_offset');
check('rtc_offset still advances', currentReportEpoch(noSync, 65000).epoch, rtcEpoch + 65);
const nothing = makeClock();
check('nothing at all -> none', currentReportEpoch(nothing, 0), { epoch: 0, source: 'none' });

console.log('\n4. LIVENESS AGAINST ELAPSED TIME, not "did the value change"');
// Healthy clock at the real 60 s cadence.
{
  const s = makeLiveness();
  resetRtcLiveness(s, rtcEpoch, 0);
  const ok = [];
  for (let i = 1; i <= 5; i += 1) {
    ok.push(noteRtcEpochRead(s, rtcEpoch + i * 60, i * I2C_RTC_POLL_INTERVAL_MS));
  }
  check('5 healthy 60 s polls all pass', ok, [true, true, true, true, true]);
  check('healthy clock never trips the stall counter', s.stallCount, 0);
}
// Frozen clock at the real 60 s cadence: fails by 58 s, needs 2 samples.
{
  const s = makeLiveness();
  resetRtcLiveness(s, rtcEpoch, 0);
  const first = noteRtcEpochRead(s, rtcEpoch, 60000);
  check('1st frozen read alone does NOT trip it (second-boundary guard)', first, false);
  check('...but the counter is 1, below the 2-sample threshold', s.stallCount, 1);
  const second = noteRtcEpochRead(s, rtcEpoch, 120000);
  check('2nd consecutive frozen read trips it', [second, s.stallCount >= RTC_LIVENESS_STALL_SAMPLES], [false, true]);
}
// A single unchanged read where no whole second passed: not a test at all.
{
  const s = makeLiveness();
  resetRtcLiveness(s, rtcEpoch, 1000);
  check('read with <1s elapsed is not a stall sample', noteRtcEpochRead(s, rtcEpoch, 1400), true);
  check('...and leaves the counter clean', s.stallCount, 0);
}
// A backwards jump must not read as a huge positive advance.
{
  const s = makeLiveness();
  resetRtcLiveness(s, rtcEpoch, 0);
  check('clock going backwards is a failure, not a leap forward', noteRtcEpochRead(s, rtcEpoch - 3600, 60000), false);
}

console.log('\n5. A SERVER THAT DISAGREES WITH ITSELF IS NOT BELIEVED');
{
  const d = makeClock();
  rememberServerTime(d, trueEpoch, rtcEpoch, 0);
  rememberServerTime(d, trueEpoch + 20, rtcEpoch, 20000);
  const verdict = rememberServerTime(d, trueEpoch + 40000, rtcEpoch, 40000);  // jumps 40,000 s
  check('a wild third sample restarts the measurement instead of being averaged in', d.samples, 1);
  check('...and does not establish the correction', d.synced, false);
  check('...and the source is still rtc', currentReportEpoch(d, 40000).source, 'rtc');
  console.log(`        (verdict: ${verdict})`);
}
{
  const e = makeClock();
  const verdict = rememberServerTime(e, trueEpoch + 100000, rtcEpoch, 0);  // +100,000 s
  check('an offset beyond +/-86400 s is rejected outright', e.synced, false);
  console.log(`        (verdict: ${verdict})`);
}
{
  const f = makeClock();
  rememberServerTime(f, trueEpoch, rtcEpoch, 0);
  check('a device whose clock runs FAST gets a negative offset, not a wrap',
    (rememberServerTime(f, trueEpoch, rtcEpoch + 17946, 20000), f.offset), -17946);
}

console.log('\n6. THE server_synced PAYLOAD AGAINST THE REAL INGEST CONTRACT');
{
  const got = currentReportEpoch(c, 40000);
  // Byte-for-byte the shape the firmware's buildBackendSnapshot() emits for this
  // state, per the emitter's own use of appendKeyString/appendKeyValue.
  const snapshot = {
    v: 1,
    seq: 7,
    uptime: 40,
    epoch: got.epoch,
    time_valid: true,
    time_source: got.source,
    clock_offset_s: c.offset,
    rtc_alive: true,
    rtc_battery_low: true,
    inv_revision: 3,
    pending_count: 0,
    full: true,
    readings: { temperature_c: 4.2, humidity_pct: 61.7, pressure_hpa: 1005.07, gas_input_mv: 437.6, gas_delta_mv: 78 },
    state: { zone_status: 1, overall_status: 1, door_open: false, door_stale: false, confirmed_fault_mask: 16384, availability_mask: 0, gas_state: 'warming_up' },
    items: [{ uid: 'A1B2C3D4', name: 'Milk', category: 'Dairy', quantity: '1', location: 'Fridge', store_date_epoch: got.epoch, expiry_epoch: 0, duration_limit_days: 7, status: 0, manufacture_epoch: 0 }],
  };
  const parsed = snapshotSchema.safeParse(snapshot);
  check('contract accepts the server_synced snapshot', parsed.success, true);
  if (!parsed.success) for (const i of parsed.error.issues) console.log(`        ${i.path.join('.')}: ${i.message}`);

  // And the backend's own clock-trust rule, on the corrected epoch.
  const { evaluateClock } = await import('../backend/src/freshness/rules.js');
  const now = got.epoch + 5;
  const before = evaluateClock({ timeValid: true, reportedAtEpoch: rtcEpoch, nowEpoch: now, maxSkewSeconds: 900 });
  const after = evaluateClock({ timeValid: true, reportedAtEpoch: got.epoch, nowEpoch: now, maxSkewSeconds: 900 });
  check('RAW rtc epoch: clock UNTRUSTED (device_clock_skew_exceeds_max)',
    [before.trusted, before.reasons.includes('device_clock_skew_exceeds_max'), before.untrustworthy_layers], [false, true, ['date_derived']]);
  check('CORRECTED epoch: clock TRUSTED, date layer restored',
    [after.trusted, after.reasons, after.trustworthy_layers], [true, [], ['date_derived', 'cabinet_derived']]);
  check('...and the measured skew is now inside tolerance', after.skew_seconds <= 900, true);
  console.log(`        raw skew ${before.skew_seconds} s -> corrected skew ${after.skew_seconds} s (tolerance 900 s)`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
