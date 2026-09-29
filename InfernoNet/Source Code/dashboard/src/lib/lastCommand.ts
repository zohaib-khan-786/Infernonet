/**
 * Remembering the registration you just made, so a page reload does not lose it.
 *
 * WHY THIS EXISTS. A registration produces exactly one interesting sentence —
 * "sent" — and the sentence that matters, "applied" or "never arrived", can take
 * a few seconds to exist. An operator who dispatches, looks away, and comes back
 * to a reloaded tab has lost the only handle on the thing they just did. The
 * service keeps the command durably, so the dashboard's job is only to remember
 * WHICH command to go and read.
 *
 * WHAT IS STORED IS AN IDENTITY, NOT A RESULT. The uid and the request body, so
 * the command can be re-read and retried. Never the state: a stored `dispatched`
 * would be a claim the dashboard is making about a device it has not heard from,
 * and it would be a claim that survives being wrong. On every load the state is
 * asked for again, and what is rendered is whatever the service says this time.
 * That is the whole discipline of this file — persistence selects the question,
 * it never supplies the answer.
 *
 * WHY THE BODY IS KEPT. `item.register` is an upsert, so re-sending the same
 * body is safe and re-sending a *different* one is not what the operator asked
 * for. Holding the exact bytes that were accepted is what makes "Retry" a repeat
 * of the action rather than a new one with the same uid.
 *
 * ONE COMMAND PER DEVICE. A cabinet has one operator at a time, and the question
 * is always "what happened to the last thing I did" — so the newest dispatch
 * replaces the older, and the key is overwritten rather than accumulated. This is
 * also what bounds it: two slots, ever, no matter how many registrations are made.
 */
import type { ItemRegisterRequest } from '../api/types';
import { readStored, writeStored } from './url';

/**
 * What the dashboard remembers about the most recent dispatch on a device.
 *
 * `commandId`, `cmdSeq` and `expiresAtEpoch` are carried for display only, and
 * are all nullable because they are absent from a response from a service older
 * than migration 006. Nothing branches on them.
 */
export interface TrackedCommand {
  readonly uid: string;
  /** The body that was accepted, verbatim, so a retry repeats the same action. */
  readonly body: ItemRegisterRequest;
  /** Local clock when the POST resolved. For copy only — never a service fact. */
  readonly dispatchedAt: number;
  readonly commandId: number | null;
  readonly cmdSeq: number | null;
  /** Unix seconds, or null when the service did not report one. */
  readonly expiresAtEpoch: number | null;
}

/** Per device, so switching devices does not carry a cabinet's command along. */
function storageKey(dev: string): string {
  return `command:${dev}`;
}

// ---------------------------------------------------------------------------
// Reading back something that was written by an earlier build, or by a hand.
//
// `localStorage` is not trusted input. It survives deploys, so a value written
// by a build with a different shape can still be sitting there, and anyone with
// the page open can edit it. Everything below is therefore validated field by
// field and a value that does not make sense is DISCARDED rather than repaired —
// a remembered command that cannot be understood is not a command to remember,
// and guessing at its shape risks re-POSTing a body nobody chose.
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const asEpoch = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Rebuild an `ItemRegisterRequest` from stored JSON, or `null` if it is not one.
 *
 * Every field is optional except the uid, and a field is copied only when it is
 * the right primitive type. Unknown keys are dropped rather than preserved: this
 * build cannot vouch for a field it does not know the meaning of, and passing
 * one back to the service on a retry is a worse failure than omitting it.
 */
function reviveBody(value: unknown): ItemRegisterRequest | null {
  if (!isRecord(value)) return null;
  const uid = asString(value['uid']);
  if (uid === null) return null;

  const name = asString(value['name']);
  const category = asString(value['category']);
  const quantity = asString(value['quantity']);
  const location = asString(value['location']);
  const durationDays = asEpoch(value['duration_days']);
  const expiryEpoch = asEpoch(value['expiry_epoch']);
  const manufactureEpoch = asEpoch(value['manufacture_epoch']);

  return {
    uid,
    ...(name === null ? {} : { name }),
    ...(category === null ? {} : { category }),
    ...(quantity === null ? {} : { quantity }),
    ...(location === null ? {} : { location }),
    ...(durationDays === null ? {} : { duration_days: durationDays }),
    ...(expiryEpoch === null ? {} : { expiry_epoch: expiryEpoch }),
    ...(manufactureEpoch === null ? {} : { manufacture_epoch: manufactureEpoch }),
  };
}

/** The command remembered for `dev`, or `null` if there is none we can trust. */
export function readTrackedCommand(dev: string): TrackedCommand | null {
  const raw = readStored(storageKey(dev));
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not even JSON. Someone edited it, or a truncated write. Either way there
    // is no remembered command, which is the safe reading.
    return null;
  }

  if (!isRecord(parsed)) return null;
  const body = reviveBody(parsed['body']);
  const uid = asString(parsed['uid']);
  if (body === null || uid === null) return null;

  return {
    uid,
    body,
    dispatchedAt: asEpoch(parsed['dispatchedAt']) ?? 0,
    commandId: asEpoch(parsed['commandId']),
    cmdSeq: asEpoch(parsed['cmdSeq']),
    expiresAtEpoch: asEpoch(parsed['expiresAtEpoch']),
  };
}

/** Remember `dev`'s most recent dispatch, replacing any earlier one. */
export function trackCommand(dev: string, command: TrackedCommand): void {
  writeStored(
    storageKey(dev),
    JSON.stringify({
      uid: command.uid,
      body: command.body,
      dispatchedAt: command.dispatchedAt,
      commandId: command.commandId,
      cmdSeq: command.cmdSeq,
      expiresAtEpoch: command.expiresAtEpoch,
    }),
  );
}

/**
 * Forget `dev`'s command, so no notice is shown on the next load.
 *
 * The caller's job, not this module's: only something that has actually seen the
 * question answered and found nothing left to say should call this. A command
 * that is merely old is not a resolved command.
 */
export function clearTrackedCommand(dev: string): void {
  writeStored(storageKey(dev), null);
}
