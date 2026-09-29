/**
 * The v1 snapshot contract, as a strict zod schema.
 *
 * Strict means `.strict()` on every object: an unknown key is a hard rejection,
 * not something to ignore. A device that drifts from the contract should be
 * visible immediately, because silently dropping a field is how a stale reading
 * becomes a plausible-looking lie on a chart.
 *
 * Range bounds below are *structural* limits (what the hardware can physically
 * produce), never freshness thresholds. A threshold breach is a device verdict,
 * not a validation failure.
 */
import { z } from 'zod';
import { GAS_STATES } from '../domain.js';

export const CONTRACT_VERSION = 1;
export const MAX_ITEMS = 12;
export const MAX_EVENTS = 4;
export const MAX_UPTIME_S = 2 ** 32 - 1;
export const MAX_EPOCH = 2 ** 32 - 1;
export const MAX_MARGIN_EPOCH = 2 ** 32 - 1;

/** Device id: lowercase-safe slug, 1-64 chars. Keeps the row key and the URL segment honest. */
const devId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be 1-64 chars of [A-Za-z0-9._-] starting alphanumeric');

/**
 * The uid rule, defined ONCE and imported by every path that touches one.
 *
 * Three places validate a uid and they must agree, or a tag that could be
 * registered could not be looked up:
 *
 *   - `item-registration.js`, the admin command that mints one (and, until this
 *     change, the only place the hex rule existed);
 *   - `eventSchema.uid` below, the tag a device presents;
 *   - `GET /devices/:dev/inventory/:uid`, the lookup that resolves it.
 *
 * uids are hex and that is enforced rather than assumed. The device mints them
 * as hex, they become an MQTT topic segment, a per-device uniqueness key and a
 * value typed into a URL. A uid carrying a space, a slash, a quote or a newline
 * is a request to build an unparseable command, a broken topic or a malformed
 * URL, and refusing it costs nothing: the device still mints whatever uid it
 * wants and reports it in the snapshot.
 *
 * Case is NOT normalised, and the reason is the same one item-registration.js
 * already records: upper-casing would be a guess about which convention the
 * firmware follows, and a wrong guess silently registers the item under a key
 * that does not match the one the device holds. What was sent is what is
 * dispatched, and the device is the authority on identity.
 *
 * `itemSchema.uid` is deliberately NOT this schema. It is `1-64` chars of
 * anything, and stays that way: the item block is the v1 wire contract, the
 * device has always been allowed to choose its own uid spelling, and tightening
 * it here would reject snapshots - losing every reading and every other item -
 * over a registry the device already owns. The hex rule belongs to the
 * surfaces this backend authors: the command it dispatches and the tag it looks
 * up.
 */
export const MAX_UID_CHARS = 64;

const uidField = z
  .string()
  .min(1)
  .max(MAX_UID_CHARS)
  .regex(/^[0-9A-Fa-f]+$/, 'must be hexadecimal digits only (0-9, A-F)');

export { uidField };

const epochSeconds = z
  .int()
  .min(0)
  .max(MAX_EPOCH)
  .describe('unix seconds; 0 means the device clock is not trusted');

const nullableRange = (min, max) => z.number().min(min).max(max).nullable();

export const readingsSchema = z
  .strictObject({
    temperature_c: nullableRange(-40, 85),
    humidity_pct: nullableRange(0, 100),
    pressure_hpa: nullableRange(300, 1200),
    gas_input_mv: nullableRange(0, 3300),
    gas_delta_mv: nullableRange(-3300, 3300),
  })
  .describe('every field is nullable; null means unavailable, never a sentinel');

export const stateSchema = z.strictObject({
  zone_status: z.int().min(0).max(3),
  overall_status: z.int().min(0).max(3),
  door_open: z.boolean(),
  door_stale: z.boolean(),
  confirmed_fault_mask: z.int().min(0).max(65535),
  availability_mask: z.int().min(0).max(65535),
  gas_state: z.enum(GAS_STATES),
});

export const itemSchema = z.strictObject({
  uid: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  category: z.string().max(32).nullable(),
  quantity: z.string().max(24).nullable(),
  location: z.string().max(64).nullable(),
  store_date_epoch: epochSeconds,
  expiry_epoch: epochSeconds,
  duration_limit_days: z.int().min(0).max(3650),
  status: z.int().min(0).max(3),
  // When the item was MADE, as opposed to when it went into the zone. The
  // device is the only reporter; the admin register endpoint dispatches a
  // command and this is where the value actually arrives.
  //
  // Optional so a build predating the field keeps validating. That optionality is
  // not cosmetic: `itemSchema` is strict, so without this line a device that
  // added the field would have every snapshot REJECTED as an unknown key - the
  // whole reading, the state block and every other item lost, over one extra
  // number. Absent and 0 both mean "unknown", and are stored as NULL.
  //
  // Deliberately placed after `status`, mirroring the append-only column in
  // migration 003: the fields above it are the original v1 contract, and this is
  // the one that arrived later.
  manufacture_epoch: epochSeconds.optional(),
});

/**
 * The event vocabulary, as a closed enum.
 *
 * WHY CLOSED, and why that is a deliberate change rather than a tightening:
 *
 * This used to be `z.string().min(1).max(32)` - free text, so a firmware typo
 * ("rfid_scan", "rfid-scanned", "Rfid_Scanned") landed in the `event` table
 * looking exactly like a real event. Nothing on the dashboard, in the log or in
 * the database would ever say the type was invented, and a scan that the backend
 * could not recognise would be indistinguishable from a scan it was ignoring.
 * That is the same failure the strict-object rule exists to prevent, one level
 * down: a field that looks like it was honoured and was not.
 *
 * A closed enum is also already this contract's established treatment of a
 * controlled vocabulary, so this makes event types consistent rather than
 * novel: `gas_state` is `z.enum(GAS_STATES)` and `time_source` is
 * `z.enum([...])`, and an unrecognised value in either rejects the snapshot
 * immediately and visibly. Event types now behave the same way.
 *
 * The cost is real and is accepted deliberately: ONE unknown event type rejects
 * the WHOLE snapshot, so a mistyped string costs every reading, every item and
 * the config block with it, not just the event. That is the correct trade here
 * because the alternative is a dashboard that has been quietly lying about what
 * the hardware reported, and because the failure is loud, immediate and
 * fixed by a one-line change to the firmware - while the silent version is
 * discovered by an operator who trusts a number. The device also learns about
 * it on its first snapshot, not in the field.
 *
 * TO ADD A TYPE: add the string here and document it. The list is deliberately
 * a literal, not a free string, precisely so that adding one is a visible edit
 * rather than something a device can do on its own. The first eleven are the
 * types `FreshGuard.ino` raises from `raiseAlert()`; the twelfth is the tag
 * identification event.
 */
export const EVENT_TYPES = Object.freeze([
  // Environmental latches.
  'temperature_high',
  'temperature_low',
  'humidity_high',
  'humidity_low',
  'gas_relative_high',
  // Cabinet.
  'door_open',
  // Item verdicts the device itself placed.
  'food_use_soon',
  'food_check',
  // Faults. Kept distinct from the latches above: R-10 makes a storage fault an
  // administration problem that never affects a freshness verdict.
  'sensor_fault',
  'storage_fault',
  // A tag was presented to the reader and its uid read. An OBSERVATION, and
  // deliberately not a verdict: a scan is a fact about the cabinet ("this uid was
  // here at this instant"), says nothing about any food-safety condition, and
  // must never be read as one. It is not a fault, it creates nothing, and a uid
  // it carries that is not registered is a normal outcome - an unregistered tag is
  // exactly what a reader that has just been fitted will meet on its first sweep.
  'rfid_scanned',
]);

export const eventSchema = z.strictObject({
  event_id: z.int().min(0).max(MAX_EPOCH),
  type: z.enum([...EVENT_TYPES]),
  message: z.string().min(1).max(256),
  timestamp_epoch: epochSeconds,
  time_valid: z.boolean(),
  // The tag an identification event is about, as the device read it.
  //
  // OPTIONAL on every event type, and absent on all of the existing ones, which
  // is what keeps this additive. `eventSchema` is strict, so without this line
  // a device that began sending `uid` would have every snapshot REJECTED as an
  // unknown key - the whole reading, the state block, every item and the config
  // gone, over one extra field. The regression test that pins this is in
  // test/uid-identification.test.js.
  //
  // It is allowed on any type rather than only on `rfid_scanned` because it
  // describes a tag, not an event: the reader reports what it read, and the same
  // code path can carry it whatever else the device noticed at the same instant.
  // Constraining it per-type would be a rule with no reader.
  //
  // Stored and returned as reported. Absent stays NULL and is never a sentinel
  // or an empty string, matching rule 001's "null means absent, never a
  // sentinel".
  uid: uidField.optional(),
});

export const thresholdsSchema = z.strictObject({
  temperature_min_c: z.number().min(-40).max(85),
  temperature_max_c: z.number().min(-40).max(85),
  humidity_min_pct: z.number().min(0).max(100),
  humidity_max_pct: z.number().min(0).max(100),
  gas_delta_abnormal_mv: z.number(),
  gas_delta_clear_mv: z.number(),
  use_soon_percent: z.int().min(1).max(100),
});

export const provenanceSchema = z.strictObject({
  source: z.string().min(1).max(64),
  note: z.string().max(256).nullable(),
  reference: z.string().max(256).nullable(),
});

export const configSchema = z.strictObject({
  firmware: z.string().min(1).max(32),
  thresholds: thresholdsSchema,
  // Which administrator-configured threshold revision the device is currently
  // applying. Optional so an older device build keeps validating; the backend
  // then simply cannot tell whether a threshold update has reached it, and
  // reports that honestly rather than assuming it has.
  thresholds_rev: z.int().min(0).max(1_000_000).optional(),
  door_timeout_ms: z.int().min(0).max(3_600_000),
  consecutive_samples: z.int().min(1).max(255),
  provenance: provenanceSchema,
});

export const snapshotSchema = z
  .strictObject({
    v: z.literal(CONTRACT_VERSION),
    seq: z.int().min(0).max(MAX_EPOCH),
    uptime: z.int().min(0).max(MAX_UPTIME_S),
    epoch: epochSeconds.nullable(),
    time_valid: z.boolean(),
    // Where `epoch` came from, and the clock conditions that explain it.
    //
    // The device no longer leads with its DS3231 reading. That clock counts
    // correctly but sits about 4-5 hours behind the server, and an RTC-first
    // chain therefore never reached its own fallback: the backend saw a
    // confident, plausible, 5-hour-wrong epoch and raised
    // device_clock_skew_exceeds_max, withholding the date layer for exactly the
    // same reason it always had. So the device now measures (server_time_epoch -
    // its own clock) over several agreeing ingest responses and reports the
    // CORRECTED time, advanced afterwards by its own monotonic millis().
    //
    //   server_synced  corrected from the server and carried by millis(); the
    //                  normal state, and it keeps working offline because only
    //                  the anchor came from the network
    //   rtc            a raw DS3231 reading, before any correction was measured
    //   rtc_offset     a last-known-good DS3231 reading advanced by millis()
    //   none           no time at all (epoch 0)
    //
    // `time_valid` was WIDENED to mean "this snapshot carries a real, advancing,
    // non-synthesised time reference" - true for the first three, false only for
    // `none`. Its old narrower meaning ("a real reading from the device's own
    // DS3231") had no reachable state that produced a verdict: a skewed-but-
    // working RTC tripped the skew rule, and a dead one tripped the invalid
    // rule, so every food item was stuck at Sensor Fault either way. The
    // distinction the narrow meaning drew is not lost - it is carried by
    // `time_source`, which is the field a clock-trust revision should key on.
    // The trust DECISION stays here on the server.
    time_source: z.enum(['rtc', 'server_synced', 'rtc_offset', 'none']).optional(),
    // The measured correction, in seconds, signed: positive means the server was
    // ahead of the device. This is the evidence a clock-trust rule needs in
    // order to judge trust from something other than the epoch alone, and it is
    // also the diagnostic for the underlying hardware fault. 0 with a
    // `time_source` of `rtc` or `none` means "not measured yet" rather than
    // "no error", which the time_source disambiguates.
    //
    // Optional so a build predating the field keeps validating; the backend then
    // simply cannot size the device's clock error, and says nothing about it,
    // rather than assuming it is zero.
    clock_offset_s: z.int().min(-86_400).max(86_400).optional(),
    // Whether the oscillator is actually keeping up with elapsed real time. This
    // is a LIVENESS verdict, not an offset: it separates "the clock is stopped"
    // from "the clock is running hours out", which are different faults with
    // different fixes.
    rtc_alive: z.boolean().optional(),
    // The backup cell. While the device has power the DS3231 is powered from VCC
    // and the time is valid regardless, so this is a maintenance condition
    // ("the time will not survive a power cycle") and is deliberately not an
    // input to time_valid or to clock trust.
    rtc_battery_low: z.boolean().optional(),
    inv_revision: z.int().min(0).max(MAX_EPOCH),
    pending_count: z.int().min(0).max(1024),
    full: z.boolean(),
    readings: readingsSchema,
    state: stateSchema,
    items: z.array(itemSchema).max(MAX_ITEMS).optional(),
    events: z.array(eventSchema).max(MAX_EVENTS).optional(),
    config: configSchema.optional(),
  })
  .refine(
    (snapshot) => !(snapshot.full && snapshot.items === undefined),
    { message: 'items is required when full is true, so an empty registry is distinguishable from an unsent list', path: ['items'] },
  )
  .refine((snapshot) => !snapshot.time_valid || (snapshot.epoch ?? 0) > 0, {
    message: 'time_valid true requires a non-zero epoch',
    path: ['epoch'],
  });
// Note: an item with both expiry_epoch and duration_limit_days at zero is
// accepted, not rejected. The device would never register such an item, and the
// rule matrix treats a zero-length window as Sensor Fault for that item. The
// projection reproduces that; the contract does not second-guess the device.

/** Device id in the URL path. */
export const devPathParam = devId;

export const INGEST_PATH_RE = /^\/api\/v1\/ingest\/devices\/([^/]+)\/snapshots$/;
