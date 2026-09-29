/**
 * Administrator item registration.
 *
 * WHAT THIS IS
 *
 * An operator can ask the backend to register an item on a device. The backend
 * does two things: it records the command durably in `admin_command` (see
 * command-store.js) and it publishes the command to `freshguard/{dev}/cmd`,
 * then reports what happened. It does not create, touch or anticipate an
 * `inventory_item` row, and it will never do so.
 *
 * THE ONE RULE THAT SHAPES THIS FILE
 *
 * The device is the sole authority for every item record. `POST
 * /api/v1/devices/:dev/items` dispatches an intent; the device decides whether to
 * accept it, mints or confirms the uid, stamps the store date from ITS clock,
 * applies ITS duration limit and computes ITS verdict. The row appears only when
 * the device echoes the item back in a snapshot and the existing ingest path
 * upserts it.
 *
 * This is the same rule as the threshold revision, and the same reason: a
 * backend-authored row would be a second source of truth for an item's storage
 * date, its exposure and its verdict. Two writers means two answers to "when
 * does this go off", and the one that shows on the dashboard is the one nobody
 * will debug. The threshold PUT is the precedent - it stores what an operator
 * CONFIGURED, which is a fact about the request, and it never computes a status.
 * The durable `admin_command` row is the same kind of fact: it records the
 * COMMAND - which device, which operation, at what sequence, valid until when -
 * never an item. An item that has not been accepted by the device does not
 * exist, so there is still no honest `inventory_item` row to write.
 *
 * `state: "dispatched"` in the response is therefore deliberate and load-bearing.
 * It is not "applied", and it is not "created". The device has not confirmed
 * anything at the moment this response is written, so the word says exactly what
 * happened: the command reached the broker and the broker connection accepted
 * it, and it is now recorded as `dispatched` in `admin_command`, ready for the
 * status read to resolve. The item becomes visible in the API when the device
 * reports it.
 *
 * WHY 503 AND NEVER 200 WHEN THE TRANSPORT IS DOWN
 *
 * mqtt.js will happily accept a publish call on a client that is not connected
 * and quietly drop the packet when the socket comes back. A handler that
 * reported 200 in that state would be reporting a dispatch that never happened:
 * the operator reloads the dashboard, sees no item, and has no way to tell a lost
 * command from a device that ignored it. So a disconnected transport is 503, and
 * the operator retries. The same reasoning is why the publish is only counted as
 * dispatched once the client calls back (see `CommandUnconfirmed`).
 *
 * THE DURABLE COMMAND RECORD, AND WHAT IT IS NOT
 *
 * Since migration 006 every dispatch leaves a row in `admin_command`, so "what
 * happened to my command" is a query, not a memory. The row and its sequence
 * number are written in ONE transaction BEFORE the publish (see command-store.js
 * `recordDispatch`), so a command the transport then refuses is recorded as
 * `failed` and the 503 the operator sees has a trace behind it. This is NOT a
 * command queue: nothing redelivers, replays or retries a failed or expired
 * command. The retry budget is the operator, dedupe is the device's own
 * `cmd_seq`, and an abandoned registration resolves to `expired` once
 * `COMMAND_TTL_SECONDS` passes - see commandStatus in read/service.js. The one
 * thing the record never holds is an item: the store that writes `admin_command`
 * has no prepared statement that can touch `inventory_item`, and the test that
 * asserts the POST creates no item row is the regression guard for that line.
 */
import { z } from 'zod';
import { ApiError } from '../ingest/errors.js';
import { devPathParam, uidField as sharedUidField, MAX_UID_CHARS } from '../ingest/contract.js';

/** The wire operation, shared with the firmware and the dashboard. */
export const ITEM_REGISTER_OP = 'item.register';

/** The response's one honest word. Not "applied": the device has not answered. */
export const DISPATCH_STATE = 'dispatched';

/**
 * How long a dispatched command stays valid: seven days.
 *
 * The broker queues a QoS1 command for a persistent-session device
 * indefinitely, so the only limit on "will the device still accept this" is the
 * device's own expiry rule. The window has to be long enough that a cabinet
 * that lost power overnight, or sat unconnected over a long weekend, still
 * finds its registration waiting - with plenty of margin for the DS3231's
 * drift, which the freshness engine already treats separately through
 * `clockMaxSkewSeconds`. It also has to be short enough that a registration the
 * operator abandoned resolves to `expired` instead of haunting the status read
 * as "dispatched" for a year. Seven days is comfortably both; it is written
 * here, with the reasons, so it can be argued with.
 */
export const COMMAND_TTL_SECONDS = 7 * 86_400;

/**
 * 2100-01-01T00:00:00Z. The upper bound on both epochs.
 *
 * A real expiry or manufacture date is at most a few years out. Anything past
 * 2100 is a number that arrived from somewhere else - a mis-scaled unit, a
 * milliseconds timestamp, a signed overflow - and accepting it would put a date
 * in 2106 into a freshness calculation. The device's own contract allows the
 * full 32-bit range, so this bound is specific to the ADMIN command: it is a
 * guard on a hand-typed request, not a reinterpretation of the wire format.
 */
export const MAX_EPOCH_YEAR_2100 = 4_102_444_800;

/**
 * Length caps, matching the snapshot contract's item block exactly.
 *
 * They match rather than being chosen here, because this command creates a row
 * the device will echo back through `itemSchema`. A cap here that were looser
 * than the one on the other path would let an operator register something the
 * ingest contract then rejects as an invalid snapshot - a command the device
 * accepts and the backend refuses to store.
 */
export const ITEM_FIELD_CAPS = Object.freeze({
  uid: MAX_UID_CHARS,
  name: 64,
  category: 32,
  quantity: 24,
  location: 64,
});

/** 3650 days is ten years; the snapshot contract's own duration limit. */
export const MAX_DURATION_DAYS = 3650;

/**
 * Uids are hex, and that is enforced rather than assumed.
 *
 * The device generates them as hex and they become an MQTT topic segment, a
 * uniqueness key per device and a lookup the operator types. A uid carrying a
 * space, a slash, a quote or a newline is a request to build an unparseable
 * command or a malformed topic, and the cost of refusing it here is zero: the
 * device still mints the uid it wants to use, and reports it in the snapshot.
 *
 * Case is NOT normalised. Upper-casing would be a guess about which convention
 * the firmware follows, and a wrong guess here silently registers the item under
 * a key that does not match the one the device holds - a duplicate that never
 * resolves. What the operator sent is what gets dispatched, and the device is
 * the authority on identity.
 *
 * The rule itself now lives in `ingest/contract.js` as `uidField`, imported
 * below. It used to be defined here, and this file was the ONLY place the hex
 * rule existed - which meant the identification lookup had to either import it
 * from here (a read module depending on an admin-write module) or re-derive it
 * (two rules that agree until someone edits one). There is now one definition,
 * and the lookup, the tag a device reports on an event, and this command all
 * validate against it: a uid that could be registered can always be looked up,
 * which is the property the whole identification path rests on.
 */
const uidField = sharedUidField;

const epochField = z
  .number()
  .int()
  .min(0)
  .max(MAX_EPOCH_YEAR_2100)
  .describe('unix seconds; 0 means unknown, or "use duration_days instead" for expiry');

/**
 * The request body: the command, minus `op`.
 *
 * `op` is not accepted here. It is added on the way out, by `toWireCommand`, so
 * there is exactly one place that decides what the device is told to do and a
 * caller cannot send a body whose `op` disagrees with the route it called. A
 * body carrying one is rejected rather than ignored, for the same reason the
 * snapshot contract is strict: a field that looks like it was honoured and was
 * not is worse than a refusal.
 *
 * Every field except `uid` is optional and is OMITTED from the command when it
 * is absent, so the device applies its own default rather than being told "not
 * configured" by a field this backend invented. Nothing is defaulted to 0 here,
 * because 0 is a meaningful value on the wire: `expiry_epoch: 0` is an explicit
 * "use duration_days instead", and `duration_days: 0` is an explicit "no limit".
 * Manufacturing a zero for an omitted field would destroy that distinction.
 */
export const itemRegisterBody = z.strictObject({
  uid: uidField,
  name: z.string().min(1).max(ITEM_FIELD_CAPS.name).optional(),
  category: z.string().max(ITEM_FIELD_CAPS.category).nullable().optional(),
  quantity: z.string().max(ITEM_FIELD_CAPS.quantity).nullable().optional(),
  location: z.string().max(ITEM_FIELD_CAPS.location).nullable().optional(),
  duration_days: z.number().int().min(0).max(MAX_DURATION_DAYS).optional(),
  expiry_epoch: epochField.optional(),
  manufacture_epoch: epochField.optional(),
});

/** The exact document published to `freshguard/{dev}/cmd`. */
export function toWireCommand(body) {
  const command = { op: ITEM_REGISTER_OP };
  // Key order follows the shared contract so a device-side diff of the payload
  // is readable, and absent fields stay absent rather than becoming null.
  for (const key of [
    'uid',
    'name',
    'category',
    'quantity',
    'location',
    'duration_days',
    'expiry_epoch',
    'manufacture_epoch',
  ]) {
    if (Object.hasOwn(body, key) && body[key] !== undefined) command[key] = body[key];
  }
  return command;
}

/**
 * Admin-surface error codes, defined here with explicit statuses for the same
 * reason admin-auth.js defines its own rather than extending CODES: that map is
 * the device-facing vocabulary and this is not a device-facing failure.
 *
 * Both are 503. Neither is 200, and that is the entire point - see the module
 * docstring.
 */
export const TRANSPORT_UNAVAILABLE = 'transport_unavailable';
export const COMMAND_UNCONFIRMED = 'command_unconfirmed';

/**
 * The transport is not connected, so nothing was sent.
 *
 * Distinct from `CommandUnconfirmed` because the operator's next move differs:
 * here the command definitely did not leave the process.
 */
export class TransportUnavailable extends Error {
  constructor(message = 'the device command transport is not connected') {
    super(message);
    this.name = 'TransportUnavailable';
  }
}

/**
 * The publish was handed to the client but the connection never confirmed it.
 *
 * This is the honest report of an ambiguous outcome: the packet may have been
 * delivered, or it may have been dropped in a disconnect that happened
 * microseconds later. Claiming either would be a guess, so the route answers 503
 * and the operator retries - which is safe for `item.register` because the
 * device is idempotent on uid and the ingest upsert revives rather than
 * duplicates. Reported separately from `TransportUnavailable` so a support
 * conversation can distinguish "MQTT was never up" from "MQTT dropped the
 * connection under us", which are different faults.
 */
export class CommandUnconfirmed extends Error {
  constructor(message = 'the broker did not confirm the command') {
    super(message);
    this.name = 'CommandUnconfirmed';
  }
}

/**
 * Item registration, durable for commands and blind to item rows.
 *
 * The constructor takes a command store, NOT a database handle: the module
 * records dispatches through `admin_command` but cannot reach `inventory_item`,
 * so the single-authority rule is enforced by the wiring rather than by
 * remembering to skip a query. If someone later passes `db` and writes an item
 * row, the test that asserts the POST creates no `inventory_item` row is what
 * stops them.
 */
export function createItemRegistrationService({
  publishCommand,
  commandStore,
  logger,
  now = () => new Date(),
  expectedDevice = null,
} = {}) {
  if (typeof publishCommand !== 'function') {
    throw new TypeError('createItemRegistrationService requires a publishCommand function');
  }
  if (!commandStore || typeof commandStore.recordDispatch !== 'function') {
    throw new TypeError('createItemRegistrationService requires a commandStore');
  }

  return {
    /**
     * Validate, record, dispatch, report. Returns the response body.
     *
     * `requestId` is passed through to the log line so a dispatch can be joined
     * to its access-log entry; it is never used for anything else.
     */
    async dispatch(dev, body, { requestId = null } = {}) {
      // Validated here as well as in the route so the service is safe to call
      // from anywhere else, but the route is what turns a failure into a 400 -
      // this function is reached only with an already-parsed body in practice.
      const command = toWireCommand(body);

      // A KNOWN BLIND SPOT, warned about rather than refused.
      //
      // This deployment's broker link is configured for one device
      // (FG_MQTT_DEVICE_ID), and the broker will happily acknowledge a publish to
      // any topic - including one no device is subscribed to. So a registration
      // aimed at the wrong device id gets the same 200 dispatched as a correct
      // one, and the item never appears.
      //
      // It is not turned into a 4xx because the response vocabulary is shared
      // with the dashboard and the firmware, and inventing a rejection reason
      // here would change a contract two other implementations are coded
      // against for a case that is a configuration mistake, not a bad request.
      // A warning puts it in front of an operator who can act, where silence
      // would leave them reloading the dashboard wondering which of the two
      // possible causes they are looking at.
      if (expectedDevice && dev !== expectedDevice) {
        logger?.warn?.('item.register aimed at a device this broker link is not configured for', {
          dev,
          expected_device: expectedDevice,
          uid: command.uid,
          request_id: requestId,
        });
      }

      // RECORD FIRST, PUBLISH SECOND. The row and its sequence number land in
      // one transaction (command-store.js `recordDispatch`), so the command
      // has a durable identity before it ever touches the transport - and a
      // command the transport then refuses is marked `failed`, giving the 503
      // the operator sees a row to stand on. The two durable fields ride on the
      // wire: `cmd_seq` so the device can order and dedupe, `expires_at_epoch`
      // so it can refuse a command whose window has closed.
      const at = now();
      const dispatchedAt = at.toISOString();
      const expiresAtEpoch = Math.floor(at.getTime() / 1000) + COMMAND_TTL_SECONDS;
      const record = commandStore.recordDispatch({
        dev,
        op: command.op,
        uid: command.uid,
        dispatched_at: dispatchedAt,
        expires_at_epoch: expiresAtEpoch,
      });
      const wire = { ...command, cmd_seq: record.cmd_seq, expires_at_epoch: expiresAtEpoch };

      try {
        await publishCommand(dev, wire);
      } catch (error) {
        const failedAt = now().toISOString();
        if (error instanceof TransportUnavailable) {
          // The command is marked failed so the status read can show WHY the
          // answer is 503 - the transport was never able to carry it.
          commandStore.markFailed(record.id, failedAt);
          logger?.warn?.('item.register refused: transport not connected; operator must retry', {
            dev,
            uid: command.uid,
            command_id: record.id,
            request_id: requestId,
          });
          throw new ApiError(
            TRANSPORT_UNAVAILABLE,
            'the device command transport is not connected; the item was NOT registered - retry once the transport is up',
            { status: 503 },
          );
        }
        if (error instanceof CommandUnconfirmed) {
          // Same trace, different fault: the command left the process and the
          // broker never said it held it, so the row's failure is the honest
          // "delivery is unknown".
          commandStore.markFailed(record.id, failedAt);
          logger?.warn?.('item.register not confirmed by the broker; outcome unknown, retry is safe', {
            dev,
            uid: command.uid,
            command_id: record.id,
            request_id: requestId,
          });
          throw new ApiError(
            COMMAND_UNCONFIRMED,
            'the broker did not confirm the command; delivery is unknown - the item may or may not have been registered, retrying is safe',
            { status: 503 },
          );
        }
        // Anything else is a bug or a genuinely unexpected broker failure. It is
        // marked failed the same way, then rethrown unchanged so the terminal
        // error handler reports 500 with the real cause logged, rather than
        // being disguised as a transport problem.
        commandStore.markFailed(record.id, failedAt);
        throw error;
      }

      // Only `dev`, `uid`, the command id and the sequence - all bounded (a
      // validated dev slug, a hex uid and two integers). The item's name,
      // category, location and quantity are operator free text and are
      // deliberately NOT logged: they can be longer than anything an operator
      // wants copied into a log file, and a log is the one place a payload
      // tends to outlive the request.
      logger?.info?.('item.register dispatched to device', {
        dev,
        uid: command.uid,
        command_id: record.id,
        cmd_seq: record.cmd_seq,
        request_id: requestId,
        state: DISPATCH_STATE,
      });

      return {
        dev,
        uid: command.uid,
        state: DISPATCH_STATE,
        // Additive: the dashboard's existing consumers read `dev`, `uid` and
        // `state`, and these three make the dispatch resolvable - the command's
        // row id for the status read, the sequence the device will protect
        // against, and when the command stops being valid.
        command_id: record.id,
        cmd_seq: record.cmd_seq,
        expires_at_epoch: expiresAtEpoch,
      };
    },
  };
}

export { devPathParam, ApiError };
