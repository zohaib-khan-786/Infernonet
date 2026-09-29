/**
 * What the operator is told about a registration, from "sent" to "applied".
 *
 * THE ONE PLACE DISPATCHED AND APPLIED ARE KEPT APART
 * -----------------------------------------------------------------------------
 * A registration used to be able to say only one thing: `dispatched`. That is the
 * broker taking a message, not the cabinet confirming one, and it is true forever
 * whether or not the device ever heard it. The service now persists every
 * command, so this component reads that record and reports the resolution
 * instead — while keeping the original discipline that the sentence about the
 * item and the row in the table are two claims by two separate authorities.
 *
 * FOUR FACTS, NOT ONE, AND THE COPY NEVER FUSES THEM
 * -----------------------------------------------------------------------------
 *   1. The command's own state, from `GET .../commands/:uid` — the service's
 *      record of what it dispatched and what the device did about it.
 *   2. Whether the item is in the list being shown. `arrived` is
 *      `listed.find(...) !== null`, read off the same array the table renders,
 *      so it can only ever become true because the device said so.
 *   3. Whether this watch has stopped and why — a statement about the dashboard's
 *      own patience, never about the device.
 *   4. Whether the last check got through at all — a statement about the
 *      network, not about the cabinet.
 *
 * A confirmation (1) is NOT an inventory row (2). The device can confirm a
 * command in a snapshot that has not reached this browser yet, and saying "it is
 * in the cabinet" at that moment would be reporting this page's staleness as a
 * fact about the hardware. So the two are stated in that order and never
 * collapsed.
 *
 * `expired` and `failed` are both "not in the cabinet", for different reasons,
 * and the difference is the whole reason an operator can act on it: one needs the
 * command sent again, the other needs the broker fixed first.
 *
 * WHY THE MARK NEVER CHANGES
 * -----------------------------------------------------------------------------
 * `lib/status.ts` reserves circle, triangle and square for the food verdicts —
 * circle is `fresh`, triangle is `use_soon`, square is `check_food` — and that
 * file is explicit that reusing one for an unrelated meaning teaches a volunteer
 * exactly the wrong lesson. A registration that never arrived is not a
 * `check_food`. So the shape here is a constant neutral circle, as it was before
 * this change, and the state is carried redundantly by `data-tone` AND by the
 * verbatim `state:` chip, which is legible in greyscale and to a reader who sees
 * no colour at all.
 */
import type { ReactElement } from 'react';
import type { ApiError } from '../../api/client';
import { isTerminalCommandState, type CommandStatusResponse, type DeviceCommand } from '../../api/types';
import { Mark } from '../../components/Mark';
import { dateTime } from '../../lib/format';
import { commandPhase, COMMAND_POLL_BUDGET_MS, type CommandPhase, type CommandPoll } from '../../lib/useCommandStatus';

type Tone = 'ok' | 'warn' | 'crit' | 'unknown' | 'neutral';

/** A minute, said the way a person says it. One place, so the copy cannot drift. */
function humanMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export interface CommandStatusNoticeProps {
  readonly dev: string;
  readonly uid: string;
  readonly poll: CommandPoll;
  /** True only when the item is in the very list the page is rendering. */
  readonly arrived: boolean;
  /** Re-sends the identical body. Safe: `item.register` is an upsert. */
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
  /** True while the retry is in flight, so the button cannot be pressed twice. */
  readonly retrying: boolean;
  /**
   * A failure of the RE-SEND itself, kept separate from the watch's read failures.
   *
   * Two different things, and one sentence cannot carry both. "The service could
   * not be reached" while the operator watches a re-send means the POST did not go
   * through, and it says nothing about the state of the command already on record;
   * the same words arriving from the watch mean the reads have stopped, and the
   * command's state is still whatever the last successful one said. Blurring them
   * would let an operator conclude the command was lost when it may be sitting
   * there confirmed.
   */
  readonly actionError: ApiError | null;
}

export function CommandStatusNotice({
  dev,
  uid,
  poll,
  arrived,
  onRetry,
  onDismiss,
  retrying,
  actionError,
}: CommandStatusNoticeProps): ReactElement {
  const phase = commandPhase(poll);
  // The command the notice is about is the newest one the service holds, not
  // necessarily the one this browser dispatched: a retry from another tab is a
  // newer command for the same uid, and the resolution belongs to the newest.
  const latest = latestCommand(poll.data);
  const state = poll.data?.state ?? null;
  const tone = toneFor(phase, state);

  return (
    <div className="notice" data-tone={tone} role="status" aria-label={`Registration of ${uid}`}>
      <Mark shape="circle" className="mark--lg" />
      <div>
        <p className="notice__kind">
          {kindLabel(phase.kind, state, arrived)}{' '}
          <span className="chip chip--plain">state: {state === null ? 'none' : `"${state}"`}</span>
          {latest === null ? null : <span className="chip chip--plain">cmd #{latest.cmd_seq}</span>}
        </p>
        <p className="notice__title">{titleFor(phase.kind, state, uid, dev, arrived)}</p>
        <div className="notice__body">
          {actionError === null ? null : (
            <p className="notice__meta">
              <strong>The re-send did not go through.</strong> {errorSentence(actionError)} The command already on the
              service is untouched by that, and the sentence above still describes it — the button can be pressed again,
              and the watch will read whatever the service recorded.
            </p>
          )}
          <Body
            phase={phase}
            dev={dev}
            uid={uid}
            arrived={arrived}
            latest={latest}
            polling={poll.polling}
            onRetry={onRetry}
            onDismiss={onDismiss}
            retrying={retrying}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentation, split out so every branch of the sentence lives in one place
// and a state this build has never seen cannot land somewhere with no wording.
// ---------------------------------------------------------------------------

/** The newest command in a history. The service orders these newest-first. */
function latestCommand(data: CommandStatusResponse | null): DeviceCommand | null {
  return data === null ? null : (data.commands[0] ?? null);
}

/**
 * A state this build was not written against.
 *
 * The `dispatched` check is written out rather than assumed, because
 * `CommandStatus` is `string & {}`: a service that adds a state produces a value
 * this build can carry but cannot interpret, and the safe reading of an
 * uninterpretable state is "not understood", never "succeeded".
 */
function isUnfamiliar(state: string | null): boolean {
  return state !== null && state !== 'dispatched' && !isTerminalCommandState(state);
}

function toneFor(phase: CommandPhase, state: string | null): Tone {
  if (phase.kind === 'gave-up' || phase.kind === 'unread') return 'unknown';
  if (state === 'confirmed') return 'ok';
  if (state === 'expired') return 'warn';
  if (state === 'failed') return 'crit';
  // `dispatched`, `null`, and anything unfamiliar: in flight or not understood.
  // Never `ok`. A future success word this build does not know must not be
  // coloured green, because green here would mean the dashboard decided a
  // command succeeded on the strength of a word it had never heard of.
  return 'neutral';
}

function kindLabel(kind: CommandPhase['kind'], state: string | null, arrived: boolean): string {
  if (kind === 'gave-up') return 'Could not check the service';
  if (kind === 'unread') return 'Reading the command record';
  if (kind === 'no-history') return 'No command on record';
  if (state === 'confirmed') return arrived ? 'Reported by the device' : 'Confirmed by the device';
  if (state === 'expired') return 'Expired — never applied';
  if (state === 'failed') return 'Failed — never sent';
  return 'Dispatched — awaiting the device';
}

function titleFor(
  kind: CommandPhase['kind'],
  state: string | null,
  uid: string,
  dev: string,
  arrived: boolean,
): string {
  if (kind === 'gave-up') return `What happened to ${uid} is not known yet`;
  if (kind === 'unread') return `Reading what happened to ${uid}`;
  if (kind === 'no-history') return `The service has no record of a command for ${uid}`;
  if (state === 'confirmed' && arrived) return `${uid} is now in the inventory below`;
  if (state === 'confirmed') return `${dev} confirmed the command for ${uid}`;
  if (state === 'expired') return `${uid} was not registered — the command expired unused`;
  if (state === 'failed') return `${uid} was not registered — the command never left the service`;
  return `The command for ${uid} has been sent, not applied`;
}

function Body({
  phase,
  dev,
  uid,
  arrived,
  latest,
  polling,
  onRetry,
  onDismiss,
  retrying,
}: {
  readonly phase: CommandPhase;
  readonly dev: string;
  readonly uid: string;
  readonly arrived: boolean;
  readonly latest: DeviceCommand | null;
  readonly polling: boolean;
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
  readonly retrying: boolean;
}): ReactElement {
  const state = phase.kind === 'resolved' || phase.kind === 'watching' ? phase.data.state : null;

  return (
    <>
      {phase.kind === 'watching' ? (
        <>
          <p>
            The service accepted a command to register UID <span className="num">{uid}</span> on{' '}
            <span className="num">{dev}</span>. That is the broker taking the message, not the cabinet confirming it.{' '}
            {polling
              ? 'This page is re-reading the service’s record and will say the moment that changes.'
              : null}
          </p>
          <InventoryClaim arrived={arrived} dev={dev} />
        </>
      ) : null}

      {phase.kind === 'resolved' && phase.data.state === 'confirmed' ? (
        <>
          <p>
            {dev} carried <span className="num">{uid}</span> in a later accepted snapshot, so the device applied the
            command. That is the service reading the device&apos;s own report, not this page deciding it worked.
          </p>
          <InventoryClaim arrived={arrived} dev={dev} confirmed />
        </>
      ) : null}

      {phase.kind === 'resolved' && phase.data.state === 'expired' ? (
        <>
          <p>
            The command had a validity window, and the device never reported taking it inside that window, so the service
            expired it. <strong>Nothing was added to the list above</strong>, and {uid} is not in the cabinet.
          </p>
          <p>
            This is a command that did not land, not a refusal: nothing in the record says the device objected to it.
            Sending it again is safe, because registering the same uid sets the same fields rather than creating a second
            item.
          </p>
        </>
      ) : null}

      {phase.kind === 'resolved' && phase.data.state === 'failed' ? (
        <>
          <p>
            The service tried to publish the command and the transport refused it, so the command was never sent.{' '}
            <strong>Nothing was added to the list above</strong>, and {uid} is not in the cabinet.
          </p>
          <p>
            This is a fault on the service or the broker rather than on the cabinet, and the same request will fail the
            same way until that is fixed. Sending it again is offered because the fault may already be gone.
          </p>
        </>
      ) : null}

      {phase.kind === 'no-history' ? (
        <>
          <p>
            The service holds no command for <span className="num">{uid}</span> on <span className="num">{dev}</span>:
            nothing was ever dispatched for this id, so there is no command that could have been applied. This is an
            answer read from the record, not a gap in it.
          </p>
          <p>
            If this id was just registered from this page, the service answering this read did not record the dispatch.
            Sending it again is the way to find out which of the two is true.
          </p>
        </>
      ) : null}

      {phase.kind === 'gave-up' ? (
        <>
          <ErrorLine error={phase.error} />
          <p>
            That is a statement about reaching the service, and nothing has been concluded about {dev} or about the
            item.{' '}
            {phase.data === null ? (
              <>No read of this command has come back yet, so there is nothing to report about it.</>
            ) : phase.data.state === 'dispatched' ? (
              <>
                The last read that did get through said the command is still <span className="num">dispatched</span>, and
                that is the most recent word the service has — it is not evidence that the device has it, only that
                nothing has yet said otherwise.
              </>
            ) : (
              <>The last read that did get through is the one still shown above.</>
            )}{' '}
            The command is recorded on the service, so opening this page again will read whatever its state is now.
          </p>
        </>
      ) : null}

      {/* A state word this build was not written against: reported, never guessed. */}
      {isUnfamiliar(state) ? (
        <p>
          <strong>Unfamiliar state.</strong> This dashboard was written for{' '}
          <span className="num">dispatched</span>, <span className="num">confirmed</span>,{' '}
          <span className="num">expired</span> and <span className="num">failed</span>, and the service answered{' '}
          <span className="num">&quot;{state}&quot;</span>. It is shown as sent, and it is not being treated as a
          confirmation.
        </p>
      ) : null}

      <Fact
        latest={latest}
        polling={polling}
        retrying={retrying}
        onRetry={onRetry}
        onDismiss={onDismiss}
        canRetry={phase.kind === 'resolved' || phase.kind === 'no-history' || phase.kind === 'gave-up'}
      />
    </>
  );
}

/**
 * The one paragraph allowed to talk about the list.
 *
 * `confirmed` does not reach the claim — it only reaches `confirmed` here, which
 * adds a clause without asserting the row. Confirmation is the service's record
 * of the device applying a command; the row is the device's report of what it is
 * storing, and the two travel at different speeds over different transports. So
 * confirmation upgrades the tone and the sentence about the COMMAND, and this
 * paragraph still waits for the row.
 */
function InventoryClaim({
  arrived,
  dev,
  confirmed = false,
}: {
  readonly arrived: boolean;
  readonly dev: string;
  readonly confirmed?: boolean;
}): ReactElement {
  if (arrived) {
    return (
      <p>
        {dev} has now reported the item on its own, so the row above is the device&apos;s record and not this page&apos;s.
        Its status and dates are the device&apos;s too — nothing here was computed.
      </p>
    );
  }
  return (
    <p>
      {confirmed ? 'The item has not appeared in the list above yet. ' : 'Nothing has been added to the list above. '}
      The row appears by itself once {dev} reports the item in a later snapshot over the live feed
      {confirmed ? ', and this notice will say so at that point. ' : '. '}Until then the item is a request, not food in
      the cabinet.
    </p>
  );
}

/** The service's own timestamps, so the record can be checked against the notice. */
function Fact({
  latest,
  polling,
  retrying,
  onRetry,
  onDismiss,
  canRetry,
}: {
  readonly latest: DeviceCommand | null;
  readonly polling: boolean;
  readonly retrying: boolean;
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
  readonly canRetry: boolean;
}): ReactElement {
  return (
    <>
      {latest === null ? null : (
        <p className="notice__meta">
          dispatched <Time value={latest.dispatched_at} /> · valid until{' '}
          <Time value={expiryIso(latest)} />
          {latest.confirmed_at === null ? null : (
            <>
              {' · '}confirmed <Time value={latest.confirmed_at} />
            </>
          )}
          {latest.failed_at === null ? null : (
            <>
              {' · '}failed <Time value={latest.failed_at} />
            </>
          )}
        </p>
      )}
      {polling ? null : (
        <p className="notice__meta">
          This page stopped re-reading the command after {humanMinutes(COMMAND_POLL_BUDGET_MS)} of waiting, rather than
          asking a settled question for as long as the tab stayed open. It is recorded on the service, so its state can be
          read again at any time with the button above or by reopening this page.
        </p>
      )}
      <div className="notice__actions">
        {canRetry ? (
          <button type="button" className="btn btn--primary" onClick={onRetry} disabled={retrying}>
            {retrying ? 'Sending again…' : 'Send the same command again'}
          </button>
        ) : null}
        <button type="button" className="btn btn--quiet" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </>
  );
}

/**
 * A service the dashboard could not read or write.
 *
 * Deliberately not `ErrorNotice`, which is a page-level surface for "this whole
 * panel failed" and paints itself as a service fault with no verdict shape
 * available. This is one call that did not get through, sitting beside a record
 * that is still perfectly readable.
 */
function errorSentence(error: ApiError): ReactElement {
  return (
    <>
      {error.isNetwork ? 'The service could not be reached. ' : `The service answered HTTP ${error.status}. `}
      {error.message} (service code <span className="num">{error.code}</span>)
    </>
  );
}

function ErrorLine({ error }: { readonly error: ApiError }): ReactElement {
  return <p className="notice__meta">{errorSentence(error)}</p>;
}

/** A timestamp, or an honest gap. Never a blank that reads like a real value. */
function Time({ value }: { readonly value: string | null }): ReactElement {
  if (value === null) return <>not reported</>;
  return <time dateTime={value}>{dateTime(value)}</time>;
}

/**
 * The command's deadline, preferring the service's own ISO string.
 *
 * The epoch is the field the service documents, and the ISO string is optional,
 * so the epoch is the fallback rather than the other way round — a `Time` fed
 * `null` says "not reported", which is the honest answer when neither is usable.
 */
function expiryIso(command: DeviceCommand): string | null {
  if (command.expires_at !== undefined) return command.expires_at;
  return Number.isFinite(command.expires_at_epoch) ? new Date(command.expires_at_epoch * 1000).toISOString() : null;
}
