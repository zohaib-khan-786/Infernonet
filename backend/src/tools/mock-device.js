#!/usr/bin/env node
/**
 * Mock device: posts v1 snapshots at a real ingest endpoint so the dashboard
 * can be built and demoed without hardware.
 *
 * It is built on `test/fixtures/snapshots.js`, which is the same definition of
 * the contract the tests use, so a mock POST exercises exactly the path a real
 * device would - including the idempotency and reboot behaviour, which the
 * scenarios below deliberately exercise.
 *
 * Scenarios:
 *   steady         normal readings, no faults
 *   warmup         gas warming up, then ready (R-11: display-only)
 *   ramp-temp      temperature climbs past the prototype maximum (R-04)
 *   door           door opens and stays open (R-12)
 *   faults         a sensor goes unavailable (R-09) and later recovers
 *   no-time        DS3231 untrusted, so device time is withheld (R-13)
 *   reboot         uptime drops and the sequence restarts
 *   replay         the same snapshot is sent twice
 *   burst-events   four alert events per snapshot
 *
 * Usage:
 *   node src/tools/mock-device.js --scenario ramp-temp --count 12
 *   node src/tools/mock-device.js --url http://127.0.0.1:8080 --key my-key --dev fg-01
 */
import process from 'node:process';
import { snapshotFixture } from '../ingest/fixtures.js';

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [flag, inline] = token.slice(2).split('=');
    const value = inline ?? argv[index + 1];
    if (inline === undefined && value !== undefined && !value.startsWith('--')) index += 1;
    out[flag] = value === undefined || value.startsWith('--') ? true : value;
  }
  return out;
}

const config = {
  url: String(args.url ?? 'http://127.0.0.1:8080'),
  dev: String(args.dev ?? 'fg-01'),
  key: String(args.key ?? process.env.FG_MOCK_KEY ?? 'replace-me'),
  intervalMs: Number(args.interval ?? 5000),
  count: args.count === undefined ? Infinity : Number(args.count),
  scenario: String(args.scenario ?? 'steady'),
  quiet: Boolean(args.quiet),
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Build the snapshot for step `n`. Every scenario is a pure function of `n`,
 * so a run is reproducible and can be replayed exactly.
 */
function buildSnapshot(n) {
  const scenario = config.scenario;
  const base = snapshotFixture({ seq: n + 1, uptime: 30 + n * 5, epoch: Math.floor(Date.now() / 1000) });
  const override = { readings: {}, state: {} };

  if (scenario === 'warmup') {
    // ~90 s of warm-up and baseline, then ready. No confirmed fault bit, ever.
    const warming = n * config.intervalMs < 90_000;
    override.state = { gas_state: warming ? 'warming_up' : 'ready', availability_mask: warming ? 1 << 3 : 0 };
    override.readings = { gas_input_mv: warming ? null : 780, gas_delta_mv: warming ? null : 2.1 };
  }

  if (scenario === 'ramp-temp') {
    const temperature = round1(clamp(4 + n * 1.5, -40, 40));
    const overLimit = temperature > 8;
    override.readings = { temperature_c: temperature };
    override.state = { zone_status: overLimit ? 2 : 0, overall_status: overLimit ? 2 : 0 };
    if (overLimit) {
      base.events = [
        { event_id: 5_000 + n, type: 'temperature_high', message: `Temperature high: ${temperature} C (prototype max 8.0 C)`, timestamp_epoch: base.epoch, time_valid: true },
      ];
    }
  }

  if (scenario === 'door') {
    const open = n >= 2;
    override.state = { door_open: open, door_stale: false };
    if (open && n === 2) {
      base.events = [
        { event_id: 6_000 + n, type: 'door_open', message: 'Storage door remained open beyond the prototype timeout', timestamp_epoch: base.epoch, time_valid: true },
      ];
    }
  }

  if (scenario === 'faults') {
    // Unavailable for the middle third of the run, then recovered.
    const broken = n >= 2 && n < 6;
    override.state = {
      availability_mask: broken ? 1 << 0 : 0, // BMP280
      confirmed_fault_mask: broken ? 1 << 0 : 0,
      zone_status: broken ? 3 : 0,
      overall_status: broken ? 3 : 0,
    };
    override.readings = { temperature_c: broken ? null : 4.4 };
    if (broken && n === 2) {
      base.events = [
        { event_id: 7_000 + n, type: 'sensor_fault', message: 'Sensor Fault/Data Unavailable: BMP280', timestamp_epoch: base.epoch, time_valid: true },
      ];
    }
  }

  if (scenario === 'no-time') {
    override.state = {
      zone_status: 3,
      overall_status: 3,
      time_valid: false,
      epoch: 0,
      availability_mask: 1 << 4, // DS3231/time
    };
    base.time_valid = false;
    base.epoch = 0;
  }

  if (scenario === 'reboot') {
    // Uptime drops at step 4 and the sequence restarts, exactly as a device
    // that lost power would behave.
    base.seq = n < 4 ? n + 1 : n - 3;
    base.uptime = n < 4 ? 30 + n * 5 : 4 + (n - 4) * 5;
  }

  if (scenario === 'burst-events') {
    base.events = [
      { event_id: 8_000 + n * 4 + 0, type: 'temperature_high', message: 'Temperature high: 9.4 C (prototype max 8.0 C)', timestamp_epoch: base.epoch, time_valid: true },
      { event_id: 8_000 + n * 4 + 1, type: 'humidity_high', message: 'Humidity high: 91.0% (prototype max 85.0%)', timestamp_epoch: base.epoch, time_valid: true },
      { event_id: 8_000 + n * 4 + 2, type: 'door_open', message: 'Storage door remained open beyond the prototype timeout', timestamp_epoch: base.epoch, time_valid: true },
      { event_id: 8_000 + n * 4 + 3, type: 'food_use_soon', message: 'Tomatoes is approaching its storage/expiry limit', timestamp_epoch: base.epoch, time_valid: true },
    ];
  }

  if (scenario === 'replay' && n % 2 === 1) {
    // Handled by the sender below: send the previous body twice.
  }

  return {
    ...base,
    ...override,
    readings: { ...base.readings, ...override.readings },
    state: { ...base.state, ...override.state },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(body) {
  const response = await fetch(`${config.url}/api/v1/ingest/devices/${config.dev}/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FreshGuard-Key': config.key },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

async function main() {
  if (!config.quiet) {
    process.stdout.write(
      `[mock] ${config.scenario} -> ${config.url} device=${config.dev} every ${config.intervalMs}ms\n`,
    );
  }

  let previous = null;
  for (let n = 0; n < config.count; n += 1) {
    let body = buildSnapshot(n);
    if (config.scenario === 'replay' && n % 2 === 1 && previous) body = previous;

    let result;
    try {
      result = await send(body);
    } catch (error) {
      process.stdout.write(`[mock] step ${n}: request failed: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }

    if (!config.quiet) {
      const summary =
        result.status === 200
          ? `outcome=${result.body.outcome} reason=${result.body.reason} events+${result.body.events?.inserted ?? 0}`
          : `error=${result.body.error?.code ?? result.status}`;
      process.stdout.write(`[mock] step ${String(n).padStart(3)} seq=${body.seq} uptime=${body.uptime} -> ${result.status} ${summary}\n`);
    }

    previous = body;
    if (n + 1 < config.count) await sleep(config.intervalMs);
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    process.stderr.write(`[mock] fatal: ${error.stack ?? error.message}\n`);
    process.exit(1);
  },
);
