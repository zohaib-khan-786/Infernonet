/**
 * Config: the single place environment variables are read, validated and
 * defaulted. Nothing else in the codebase touches `process.env`.
 *
 * Interface:
 *   loadConfig(env?) -> frozen config object   (throws on invalid input)
 *   loadConfigOrExit(env?) -> config object    (prints a precise reason and
 *                                              exits 78/EX_CONFIG on failure)
 *
 * Secrets policy: the ingest key is only ever held here as a SHA-256 digest.
 * The plaintext key never enters the process, is never logged, and is never
 * written to disk by this service. `FG_INGEST_KEY_SHA256` is a placeholder in
 * `.env.example` and boot is refused while the placeholder is still in place.
 */
import process from 'node:process';
import { config as loadEnvFile } from 'dotenv';
import { z } from 'zod';

export const INGEST_KEY_PLACEHOLDER = '0'.repeat(64);

// `.default()` is applied to the *inner* schema and `.transform()` sits outside
// it, so the transform also runs for defaulted values. Getting this order wrong
// is not cosmetic: a defaulted allowlist would stay a raw string and the CORS
// check would degrade into a substring match.
const boolFlag = z
  .union([z.boolean(), z.string()])
  .default('false')
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const csvList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const schema = z.strictObject({
  FG_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FG_HOST: z.string().min(1).default('127.0.0.1'),
  FG_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  FG_DB_PATH: z.string().min(1).default('./data/freshguard.db'),
  // MQTT transport. Off unless FG_MQTT_ENABLED, so an existing deployment keeps
  // working with HTTP ingest alone and no broker is opened unexpectedly.
  FG_MQTT_ENABLED: z.coerce.boolean().default(false),
  FG_MQTT_HOST: z.string().min(1).default('0.0.0.0'),
  FG_MQTT_PORT: z.coerce.number().int().min(1).max(65535).default(1883),
  FG_MQTT_DEVICE_ID: z.string().min(1).default('fg-01'),
  // The device's broker credential. Distinct from the HTTP ingest key so a
  // broker credential and an ingest credential can be rotated independently.
  // Optional: they are only required when FG_MQTT_ENABLED is true, so a
  // deployment that has never used MQTT still loads a valid configuration.
  FG_MQTT_DEVICE_USER: z.string().min(1).default('fg-01'),
  FG_MQTT_DEVICE_PASSWORD: z.string().min(1).optional(),
  // The backend's own subscriber credential, used to log in to its broker.
  FG_MQTT_INGEST_USER: z.string().min(1).default('freshguard-ingest'),
  FG_MQTT_INGEST_PASSWORD: z.string().min(1).optional(),
  FG_INGEST_KEY_SHA256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'must be exactly 64 lowercase hex characters (SHA-256 of the device ingest key)'),
  // Bearer token for mutating administrator routes: PUT
  // /devices/:dev/thresholds and POST /devices/:dev/items.
  //
  // Optional in the schema so a deployment that only serves reads and device
  // ingest still loads a valid configuration, but UNSET IS NOT "AUTH DISABLED".
  // An absent token closes the admin mutation (every attempt is a 401) rather
  // than opening it; the middleware fails closed and server.js logs a startup
  // warning. Refusing to boot instead would be defensible too, but the read API
  // and the device path are useful without an operator account, and taking the
  // whole service down over a missing admin token turns a security control into
  // an availability outage.
  //
  // Held here as plaintext, unlike the ingest key which is digest-only. That is
  // a deliberate asymmetry: the dashboard holds this token verbatim and sends it
  // as a bearer, so hashing it here would break the shared contract for no
  // benefit. The comparison digests both sides before comparing, so a leaked
  // process memory dump of the config is the exposure, and that is the same
  // exposure any bearer secret carries.
  FG_ADMIN_TOKEN: z.string().min(1).max(512).optional(),
  FG_CORS_ORIGINS: csvList,
  FG_BODY_LIMIT_BYTES: z.coerce.number().int().min(256).max(1_048_576).default(4096),
  FG_INGEST_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(60),
  FG_INGEST_RATE_WINDOW_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),
  FG_READ_RATE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(600),
  FG_READ_RATE_WINDOW_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  FG_WRITE_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(120),
  FG_WRITE_RATE_WINDOW_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  FG_READINGS_MAX_POINTS: z.coerce.number().int().min(10).max(5000).default(500),
  FG_READING_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  FG_RETENTION_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  FG_SSE_HEARTBEAT_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  FG_SSE_REPLAY_BUFFER: z.coerce.number().int().min(0).max(1000).default(100),
  FG_TRANSPORT_STALE_AFTER_S: z.coerce.number().int().min(5).max(86_400).default(90),
  // Freshness engine. Two numbers, both about how much to trust what we have.
  //
  // FG_FRESHNESS_WINDOW_MINUTES is the exposure window: the span of reading rows
  // the cabinet condition is judged over, and the span `minutes_out_of_range` is
  // measured across. The upper bound of a day is deliberate - a longer window
  // would average a lunch-time door-open together with the previous night and
  // report a "steady state" that never existed.
  FG_FRESHNESS_WINDOW_MINUTES: z.coerce.number().int().min(5).max(1440).default(360),
  // FG_FRESHNESS_CLOCK_MAX_SKEW_S is the tolerance on the DEVICE clock, measured
  // against server time. Past it the clock is not trusted and the date layer
  // withholds every day count rather than computing from a timestamp the device
  // itself set to a test epoch. The cabinet layer is unaffected by design: it is
  // measured from server receipt times.
  //
  // 15 minutes is a judgement call and is stated here so it can be argued with.
  // It is far tighter than the day granularity of every date verdict, so it is
  // not there to protect the arithmetic - it is there so a clock that is hours
  // or years out is refused before it can produce a confident answer.
  FG_FRESHNESS_CLOCK_MAX_SKEW_S: z.coerce.number().int().min(0).max(86_400).default(900),
  FG_TRUST_PROXY: boolFlag,
  FG_LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
});

const KEYS = Object.keys(schema.shape);

function pick(env) {
  const picked = {};
  for (const key of KEYS) {
    if (env[key] !== undefined && env[key] !== '') picked[key] = env[key];
  }
  return picked;
}

export function loadConfig(env = process.env, { dotenvPath } = {}) {
  // dotenv.config() writes into the real process.env, not into the object we
  // were handed. Reading `env` directly therefore only worked by accident -
  // because server.js happens to pass process.env - and silently produced
  // "FG_INGEST_KEY_SHA256: undefined" for any other caller. Merge what the file
  // actually parsed so the result does not depend on which object arrived.
  // Explicit env still wins, matching dotenv's own precedence.
  let source = env;
  if (dotenvPath) {
    const loaded = loadEnvFile({ path: dotenvPath, quiet: true });
    if (loaded && loaded.parsed) source = { ...loaded.parsed, ...env };
  }

  const result = schema.safeParse(pick(source));
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration -> ${problems}`);
  }

  const config = result.data;
  if (config.FG_INGEST_KEY_SHA256 === INGEST_KEY_PLACEHOLDER) {
    throw new Error(
      'Refusing to start: FG_INGEST_KEY_SHA256 is still the .env.example placeholder. ' +
        'Generate one with: node -e "console.log(require(\'node:crypto\').createHash(\'sha256\').update(process.argv[1]).digest(\'hex\'))" <your-device-key>',
    );
  }
  if (config.FG_CORS_ORIGINS.includes('*')) {
    throw new Error('Refusing to start: FG_CORS_ORIGINS must never contain a wildcard origin.');
  }
  // Cross-field check: enabling MQTT without its two credentials would start a
  // broker that rejects every device, which looks like a device fault rather
  // than a misconfiguration. Fail loudly at startup instead.
  if (config.FG_MQTT_ENABLED) {
    const missing = [];
    if (!config.FG_MQTT_DEVICE_PASSWORD) missing.push('FG_MQTT_DEVICE_PASSWORD');
    if (!config.FG_MQTT_INGEST_PASSWORD) missing.push('FG_MQTT_INGEST_PASSWORD');
    if (missing.length > 0) {
      throw new Error(`Refusing to start: FG_MQTT_ENABLED is set but ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing.`);
    }
  }

  return Object.freeze({
    env: config.FG_ENV,
    host: config.FG_HOST,
    port: config.FG_PORT,
    dbPath: config.FG_DB_PATH,
    ingestKeySha256: config.FG_INGEST_KEY_SHA256,
    // `undefined` when unset. Never defaulted to a value: the admin middleware
    // treats an absent token as "nobody is authorised", not "everybody is".
    adminToken: config.FG_ADMIN_TOKEN,
    mqttEnabled: config.FG_MQTT_ENABLED,
    mqttHost: config.FG_MQTT_HOST,
    mqttPort: config.FG_MQTT_PORT,
    mqttDeviceId: config.FG_MQTT_DEVICE_ID,
    mqttDeviceUser: config.FG_MQTT_DEVICE_USER,
    mqttDevicePassword: config.FG_MQTT_DEVICE_PASSWORD,
    mqttIngestUser: config.FG_MQTT_INGEST_USER,
    mqttIngestPassword: config.FG_MQTT_INGEST_PASSWORD,
    corsOrigins: config.FG_CORS_ORIGINS,
    bodyLimitBytes: config.FG_BODY_LIMIT_BYTES,
    ingestRateLimit: config.FG_INGEST_RATE_LIMIT,
    ingestRateWindowMs: config.FG_INGEST_RATE_WINDOW_MS,
    readRateLimit: config.FG_READ_RATE_LIMIT,
    readRateWindowMs: config.FG_READ_RATE_WINDOW_MS,
    writeRateLimit: config.FG_WRITE_RATE_LIMIT,
    writeRateWindowMs: config.FG_WRITE_RATE_WINDOW_MS,
    readingsMaxPoints: config.FG_READINGS_MAX_POINTS,
    readingRetentionDays: config.FG_READING_RETENTION_DAYS,
    retentionIntervalMs: config.FG_RETENTION_INTERVAL_MS,
    sseHeartbeatMs: config.FG_SSE_HEARTBEAT_MS,
    sseReplayBuffer: config.FG_SSE_REPLAY_BUFFER,
    transportStaleAfterSeconds: config.FG_TRANSPORT_STALE_AFTER_S,
    freshnessWindowMinutes: config.FG_FRESHNESS_WINDOW_MINUTES,
    freshnessClockMaxSkewSeconds: config.FG_FRESHNESS_CLOCK_MAX_SKEW_S,
    trustProxy: config.FG_TRUST_PROXY,
    logLevel: config.FG_LOG_LEVEL,
  });
}

export function loadConfigOrExit(env = process.env, options = {}) {
  try {
    // `options` carries `dotenvPath`. It must be forwarded: server.js passes it
    // so a plain `node src/server.js` reads backend/.env, and dropping it here
    // is what made the service refuse to start with FG_INGEST_KEY_SHA256
    // undefined while every test (which passes an explicit env) passed.
    return loadConfig(env, options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(78); // EX_CONFIG
  }
}
