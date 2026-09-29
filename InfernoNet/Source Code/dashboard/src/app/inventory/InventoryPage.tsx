/**
 * Food & inventory (guide §16, §17, §18).
 *
 *   §16  the summary with counts beside the ring, the full nine-column table,
 *        the real service-side CSV export, and a row-opening action
 *   §17  the item drawer, including a temperature exposure timeline built from
 *        the cabinet's own trace across the item's storage window
 *   §18  identification: the lookup the service can answer, its four outcomes in
 *        full, and the camera and manual ways of supplying the id
 *
 * WHAT THE DEVICE DOES NOT STORE, AND WHERE IT SAYS SO
 * -----------------------------------------------------------------------------
 * Three of the columns §16 asks for have no field behind them: a per-item
 * last-checked time, a per-item temperature exposure figure, and a per-item
 * entity that a door event could be attributed to. Each is marked in the table
 * with the reason, and the exposure question is answered properly in the drawer
 * rather than with a "n/a" — the cabinet's trace over the item's window IS the
 * exposure, and pretending it is not available would be the more convenient lie.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { getFreshness, getInventory, inventoryCsvUrl, registerItem } from '../../api/endpoints';
import type { ApiError } from '../../api/client';
import type {
  CurrentResponse,
  DeviceEvent,
  InventoryItem,
  InventoryResponse,
  ItemRegisterRequest,
  ItemRegisterResponse,
} from '../../api/types';
import { DeviceGate, PageHeader } from '../PageFrame';
import { AddItemForm } from './AddItemForm';
import { CommandStatusNotice } from './CommandStatusNotice';
import { FreshnessSection } from './FreshnessSection';
import { VerdictChip } from './FreshnessVerdict';
import { Donut } from '../../components/Donut';
import { IdentifyPanel } from '../../components/IdentifyPanel';
import { InventoryTable } from '../../components/InventoryTable';
import { ItemDrawer } from '../../components/ItemDrawer';
import { ErrorNotice, LoadingLine } from '../../components/Notices';
import { byUrgency } from '../../lib/status';
import { number } from '../../lib/format';
import { clearTrackedCommand, readTrackedCommand, trackCommand, type TrackedCommand } from '../../lib/lastCommand';
import { useCommandStatus } from '../../lib/useCommandStatus';
import { toApiError, useResource } from '../../lib/useResource';
import { useDashboard, useDashboardActions } from '../../store/DashboardProvider';

function DonutSlices({ items }: { readonly items: Readonly<Record<string, number>> }) {
  return (
    <Donut
      subject="items stored"
      slices={[
        { id: 'fresh', label: 'Fresh', value: items.fresh ?? 0, tone: 'ok', meaning: 'the device reports every item inside its limits' },
        { id: 'use-soon', label: 'Needs attention', value: items.useSoon ?? 0, tone: 'warn', meaning: 'the device reports an item past 75% of its storage window' },
        { id: 'check', label: 'Check food', value: items.check ?? 0, tone: 'crit', meaning: 'the device reports an item at or past its limit' },
        { id: 'unknown', label: 'Cannot be evaluated', value: items.unknown ?? 0, tone: 'unknown', meaning: 'the device could not evaluate this item' },
      ]}
    />
  );
}

export default function InventoryPage() {
  const [showRetired, setShowRetired] = useState(false);
  const [openUid, setOpenUid] = useState<string | null>(null);
  /**
   * The item an identification returned, kept so its drawer can be opened even
   * if the snapshot this page is holding has not caught up with it yet.
   *
   * The lookup and the snapshot read the same rows, but they are two requests and
   * the snapshot is the older of the two by up to one reporting interval. An item
   * registered seconds ago is in the service and not yet in `snapshot.inventory`,
   * and a drawer that said "that item is no longer in the list being shown" about
   * an item that was just identified from a label in the operator's hand would be
   * reporting the staleness of this page as a fact about the inventory.
   */
  const [identified, setIdentified] = useState<InventoryItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  /**
   * The uid the registration form opens with, and whether it is locked.
   *
   * Locked whenever the identify flow supplies one, because the value came off a
   * label. Unlocked when the operator opened the form from the page's own button,
   * where typing an id is what they came to do.
   */
  const [prefill, setPrefill] = useState<{ readonly uid: string; readonly locked: boolean } | null>(null);
  /**
   * The registration this page is currently responsible for reporting on.
   *
   * Not an item, and nothing is added to the list because of it — see
   * `CommandStatusNotice`. This is the command's IDENTITY only: which uid, which
   * request body, and what the POST answered. Its STATE is never held here, and
   * never persisted, because a stored `dispatched` would be this page making a
   * claim about a device it has not heard from — one that would go on being
   * displayed after it stopped being true. The state is read from the service on
   * every load and after every change, and whatever it says now is what is
   * rendered.
   *
   * Restored from storage on mount so a reload does not lose the one handle the
   * operator has on the thing they just did.
   */
  const [command, setCommand] = useState<TrackedCommand | null>(null);
  /** A failure of the RE-SEND itself, kept apart from the watch's read failures. */
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const { reloadCurrent } = useDashboardActions();
  const { dev, snapshot } = useDashboard();
  const formId = useId();

  /**
   * Pick up whatever was left in flight by a previous visit.
   *
   * An effect rather than a lazy `useState` initialiser, because `dev` is null on
   * the first render while the device list is still being decided and only then
   * becomes an id — an initialiser would run against `null` and the remembered
   * command would never be found. Keyed on `dev` so switching cabinets reads that
   * cabinet's command rather than carrying this one's along.
   */
  useEffect(() => {
    setCommand(dev === null ? null : readTrackedCommand(dev));
    setActionError(null);
  }, [dev]);

  /**
   * THE WATCH ON THE COMMAND.
   * ---------------------------------------------------------------------------
   * The one thing this page polls, and the only interval in the whole feature.
   * `getInventory`, `getCurrent` and the freshness document all arrive by the SSE
   * feed or are read once; a registration is the single case where the service
   * has to be asked what happened, because the answer arrives seconds later and by
   * no other route. See `useCommandStatus` for the cadence and what stops it.
   */
  const commandPoll = useCommandStatus(dev ?? '', command?.uid ?? null);

  // The active list already arrived inside the snapshot, so the common case costs
  // no request at all. Only the retired toggle needs the inventory endpoint, and
  // only then does the extra page exist.
  const loadAll = useCallback(() => (dev === null ? Promise.reject(new Error('no device')) : getInventory(dev, { retired: true })), [dev]);
  const all = useResource<InventoryResponse>(showRetired ? loadAll : null);

  /**
   * The list the table is rendering, read the same way the render prop reads it.
   *
   * Hoisted out of the `DeviceGate` render prop because the notice needs it to know
   * whether the item has actually turned up, and a `useEffect` cannot legally live
   * inside a render-prop callback. Both copies are built from the same two
   * objects — `snapshot.inventory`, or the retired-inclusive page when that is
   * loaded — so they cannot disagree; before the gate resolves there is no
   * snapshot and the list is empty, which makes `arrived` false rather than wrong.
   */
  const listed = all.data === null ? (snapshot?.inventory ?? []) : all.data.items;
  /**
   * Whether the device has actually reported this item.
   *
   * Read out of the same list the table renders, never set by the dispatch, and
   * never inferred from a confirmation. This is the only thing that may turn "the
   * device has it" into a true claim about the cabinet, and it can only do so
   * because the device said so.
   */
  const arrived = command === null ? false : listed.some((item) => item.uid === command.uid);

  /**
   * WHEN THE NOTICE HAS NOTHING LEFT TO SAY
   * ---------------------------------------------------------------------------
   * A confirmed command whose item has turned up in the list has been fully
   * discharged: the row is the permanent record, and it is the device's own.
   * Keeping a banner above the table to announce what the table is already
   * showing is noise that outlives its usefulness, and on this page it would
   * survive every reload, because the command is remembered.
   *
   * BOTH HALVES ARE REQUIRED, and neither alone is enough. Confirmation on its own
   * is not enough: the device can confirm in a snapshot this browser has not
   * received yet, and clearing on confirmation would drop the notice in precisely
   * the window where an operator most wants to read it. The row on its own is not
   * enough either: a row can appear for a uid registered from another session,
   * with no command here to have been discharged.
   */
  const discharged = arrived && commandPoll.data?.state === 'confirmed';
  useEffect(() => {
    if (!discharged || dev === null) return;
    clearTrackedCommand(dev);
    setCommand(null);
    setActionError(null);
  }, [discharged, dev]);

  /**
   * THE FRESHNESS DOCUMENT, AND WHY IT IS ALREADY IN HAND
   * -----------------------------------------------------------------------------
   * `getCurrent()` carries the whole verdict on `freshness`, and the store holds
   * that snapshot on every SSE frame the service publishes. So the common case is
   * `snapshot.freshness` and it costs ZERO requests, and a verdict that changes
   * because a reading arrived reaches this page by push.
   *
   * `getFreshness` is wired as the fallback for the one case that is not covered:
   * a snapshot from a service build that predates the engine, which sends
   * `freshness: null`. `useResource(null)` is a settled-empty resource, so the
   * two sources cannot race and the fallback can never overwrite a live push.
   *
   * There is no interval anywhere in this feature. Nothing here polls.
   */
  const pushed = snapshot?.freshness ?? null;
  const loadVerdict = useCallback(() => {
    if (dev === null) return Promise.reject(new Error('no device'));
    return getFreshness(dev);
  }, [dev]);
  const fetched = useResource(pushed !== null || dev === null ? null : loadVerdict);
  const verdict = pushed ?? fetched.data;

  /**
   * Open a registration form for a uid that came off a label.
   *
   * The uid is handed over, never retyped, and locked — see `prefill` above. Both
   * verbs the SRS gives for a scanned item arrive here: "retrieved" is the drawer
   * the identify panel opens, and "updated" is this form pre-filled with the uid
   * the service itself answered about.
   */
  const openFormFor = useCallback((uid: string) => {
    setPrefill({ uid, locked: true });
    setFormOpen(true);
  }, []);

  /**
   * A command was accepted. Remember it, and get the form out of the way.
   *
   * CLOSING THE FORM IS PART OF THE FEEDBACK, NOT A SEPARATE DECISION. The form
   * is a long panel of fields, and what the operator needs next is the notice
   * about the thing they just did. Leaving the form open underneath it buries
   * that notice below a screenful of inputs and makes the button they just
   * pressed look like it did nothing, which is the one impression a command that
   * has merely been sent must never give. The notice renders above the table and
   * takes focus of the reading order; the form is one click away again, and its
   * uid is still pre-filled if they came from a label.
   */
  const onDispatched = useCallback(
    (response: ItemRegisterResponse, body: ItemRegisterRequest) => {
      if (dev === null) return;
      const tracked = trackedFrom(response, body);
      trackCommand(dev, tracked);
      setCommand(tracked);
      setActionError(null);
      setFormOpen(false);
    },
    [dev],
  );

  /**
   * Send the same command again.
   *
   * The body is the one the service already accepted, not the form's current
   * contents, because this is a repeat of one action rather than a new one. The
   * service treats `item.register` as an upsert and keys idempotency on the
   * command, so re-sending cannot create a second item for the uid.
   *
   * The button stays disabled while this is in flight, and a failure is reported
   * as a failure OF THE RE-SEND — a separate line from the watch's own read
   * errors, because the two say different things: one is about this POST, the
   * other about the reads that follow it. The service records a refused publish
   * as `failed`, so if the re-send was refused the watch will say so on its next
   * read regardless of what happens here.
   */
  const retryCommand = useCallback(() => {
    if (command === null || dev === null || retrying) return;
    setRetrying(true);
    setActionError(null);
    registerItem(dev, command.body).then(
      (response) => {
        const tracked = trackedFrom(response, command.body);
        trackCommand(dev, tracked);
        setCommand(tracked);
        setRetrying(false);
      },
      (cause: unknown) => {
        setActionError(toApiError(cause));
        setRetrying(false);
      },
    );
  }, [command, dev, retrying]);

  /**
   * Stop reporting on this command.
   *
   * This only stops the WATCHING. The command stays recorded on the service, and
   * nothing is undone — an operator who dismisses an in-flight notice is saying
   * "do not keep telling me about this", not "cancel it". The service has no
   * cancel for a command already published, and inventing one on this side would
   * be a claim about the cabinet that nothing could support.
   */
  const dismissCommand = useCallback(() => {
    if (dev === null) return;
    clearTrackedCommand(dev);
    setCommand(null);
    setActionError(null);
  }, [dev]);

  /**
   * A service-computed verdict word, rendered by the freshness module.
   *
   * Passed down rather than imported by `IdentifyPanel`, so the component tree
   * keeps its existing direction and the identify panel does not grow a second
   * copy of the verdict vocabulary.
   */
  const renderVerdict = useCallback((status: string) => <VerdictChip status={status} />, []);

  return (
    <DeviceGate>
      {({ dev, snapshot, events }) => {
        const retiredCount = snapshot.counts.inventory_retired;
        const rows = byUrgency(listed);
        return (
          <>
            <PageHeader
              title="Food & storage"
              lede={
                <>
                  What {dev} says it is storing, and the verdict the service has computed for each item. Two authorities
                  appear on this page and they are not merged: the <strong>freshness verdict</strong> is computed by the
                  service from the item&apos;s own dates and the cabinet&apos;s air, and the <strong>Status</strong> column
                  in the table is the device&apos;s own report, which the service marks as not authoritative. The
                  dashboard computes neither.
                </>
              }
            />

            <section className="panel" aria-labelledby="inv-summary-title">
              <div className="panel__head">
                <h2 className="panel__title" id="inv-summary-title">
                  Summary
                </h2>
                <p className="panel__sub">
                  <span className="num">{snapshot.counts.inventory_active}</span> active
                  {retiredCount > 0 ? ` · ${retiredCount} retired` : ''}
                </p>
                <div className="panel__tools">
                  {retiredCount > 0 ? (
                    <button type="button" className="btn btn--quiet" aria-pressed={showRetired} onClick={() => setShowRetired((value) => !value)}>
                      {showRetired ? 'Hide retired items' : 'Show retired items'}
                    </button>
                  ) : null}
                  <a className="btn" href={inventoryCsvUrl(dev)} download>
                    Download CSV
                  </a>
                </div>
              </div>

              {showRetired && all.loading ? <LoadingLine>Loading retired items from the service…</LoadingLine> : null}
              {showRetired && all.error !== null ? (
                <div className="panel__body">
                  <ErrorNotice what="Loading the full item list" error={all.error} onRetry={all.reload} />
                </div>
              ) : null}

              <div className="panel__body food-summary">
                <DonutSlices
                  items={{
                    fresh: snapshot.inventory.filter((item) => item.status.code === 0).length,
                    useSoon: snapshot.inventory.filter((item) => item.status.code === 1).length,
                    check: snapshot.inventory.filter((item) => item.status.code === 2).length,
                    unknown: snapshot.inventory.filter((item) => item.status.code === 3).length,
                  }}
                />
                <dl className="food-counts">
                  <div className="food-counts__row" data-tone="ok">
                    <dt>Fresh</dt>
                    <dd>
                      <span className="num">{snapshot.inventory.filter((item) => item.status.code === 0).length}</span>
                      <span className="food-counts__note">inside every limit the device applies</span>
                    </dd>
                  </div>
                  <div className="food-counts__row" data-tone="warn">
                    <dt>Needs attention</dt>
                    <dd>
                      <span className="num">{snapshot.inventory.filter((item) => item.status.code === 1).length}</span>
                      <span className="food-counts__note">past 75% of a storage window. Plan, do not discard.</span>
                    </dd>
                  </div>
                  <div className="food-counts__row" data-tone="crit">
                    <dt>Check food</dt>
                    <dd>
                      <span className="num">{snapshot.inventory.filter((item) => item.status.code === 2).length}</span>
                      <span className="food-counts__note">at or past the expiry date or storage limit</span>
                    </dd>
                  </div>
                  <div className="food-counts__row" data-tone="unknown">
                    <dt>Cannot be evaluated</dt>
                    <dd>
                      <span className="num">{snapshot.inventory.filter((item) => item.status.code === 3).length}</span>
                      <span className="food-counts__note">
                        the device says it cannot judge these. Unknown is not the same as bad.
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>

              <p className="panel__note-strip">
                The ring is a summary of the counts written beside it, never the only representation (guide §16). The
                CSV is served by the service itself, so the file is complete whether or not this browser has the rows
                loaded.
              </p>
            </section>

            {/*
              THE SERVICE VERDICT.

              Placed between the summary and the item table, and the order is the
              argument: what the service concluded comes first, what the device
              reported second. The table below is untouched — it is the device's
              own record, and its Status column is the device's own `status_code`,
              which the freshness engine carries as `device_provisional` and
              states is not authoritative. The panel sub below says so, because a
              reader who lands on a table whose header just says "Status" has no
              way to know it is not the verdict.
            */}
            <FreshnessSection
              document={verdict}
              transport={snapshot.transport}
              loading={fetched.loading}
              error={fetched.error}
              onRetry={fetched.reload}
            />

            <section className="panel" aria-labelledby="inv-table-title">
              <div className="panel__head">
                <h2 className="panel__title" id="inv-table-title">
                  Inventory
                </h2>
                <p className="panel__sub">
                  {number(rows.length, 0)} item{rows.length === 1 ? '' : 's'} listed
                  {showRetired ? ' · active and retired' : ' · active only'} · ordered by urgency ·{' '}
                  <strong>the Status column is the device&apos;s own report, not the service verdict above</strong>
                </p>
                <div className="panel__tools">
                  <button
                    type="button"
                    className="btn"
                    aria-expanded={formOpen}
                    aria-controls={formId}
                    onClick={() => {
                      // Clearing the pre-fill matters: this button means "I want to
                      // type an id", and arriving at a form whose id is locked to
                      // some earlier label would be a different request than the one
                      // the operator made by pressing it.
                      setPrefill(null);
                      setFormOpen((open) => !open);
                    }}
                  >
                    {formOpen ? 'Close the form' : 'Register an item'}
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={reloadCurrent}>
                    Refresh
                  </button>
                </div>
              </div>

              {command === null ? null : (
                <div className="panel__body">
                  <CommandStatusNotice
                    dev={dev}
                    uid={command.uid}
                    poll={commandPoll}
                    arrived={arrived}
                    onRetry={retryCommand}
                    onDismiss={dismissCommand}
                    retrying={retrying}
                    actionError={actionError}
                  />
                </div>
              )}

              {rows.length === 0 ? (
                <div className="panel__body">
                  <p className="note">
                    No food is registered on this device. Items are registered either by scanning their RFID tag
                    against the reader inside the cabinet, or by sending the device a command from{' '}
                    <strong>Register an item</strong> above; either way the device reports the new list on its next
                    snapshot, so a row never appears here before the hardware says so. An empty list is not a fault —
                    the device would report <span className="num">Sensor Fault</span> if it could not send one.
                  </p>
                </div>
              ) : (
                <div className="panel__body panel__body--flush">
                  <InventoryTable items={rows} dev={dev} onOpen={setOpenUid} openUid={openUid} />
                </div>
              )}

              <div className="panel__foot">
                <p className="hint">
                  This table is the device&apos;s own record and is unchanged by the verdict above. Its Status column is
                  the device&apos;s <code className="num">status_code</code>, which the freshness engine carries as{' '}
                  <code className="num">device_provisional</code> and states is not authoritative: it is inferred from
                  the same cabinet air, so it cannot tell one item from another in the same cabinet. Line the rows up with
                  the cards above by UID. Three of guide §16&apos;s columns have no field behind them in this build: the
                  device keeps no per-item last-checked time, no per-item temperature exposure, and no entity a door event
                  could be attributed to. Each is marked in the table with the reason. The exposure is answered properly in
                  the item drawer, from the cabinet&apos;s own trace.
                </p>
              </div>
            </section>

            {formOpen ? (
              <AddItemForm
                id={formId}
                dev={dev}
                {...(prefill === null ? {} : { prefillUid: prefill.uid, lockUid: prefill.locked })}
                onDispatched={onDispatched}
                onClose={() => setFormOpen(false)}
              />
            ) : null}

            {/*
              IDENTIFICATION.

              Placed after the table and the form because the table is where an
              operator looks for "what is in here" and this is where they go when
              they have a label in their hand. The reader's own state is inside
              the panel, next to the two things that supersede it, because saying
              "the reader is fitted" in one place and "the reader is optional" in
              another is how a volunteer ends up not knowing which.
            */}
            <IdentifyPanel
              dev={dev}
              events={events}
              readerFault={
                snapshot.device.confirmed_faults.some((entry) => entry.name === 'rc522') ||
                snapshot.device.unavailable.some((entry) => entry.name === 'rc522')
              }
              onOpenItem={(item) => {
                setIdentified(item);
                setOpenUid(item.uid);
              }}
              onRegister={openFormFor}
              renderVerdict={renderVerdict}
            />

            {openUid === null ? null : (
              <ItemDrawerFor
                uid={openUid}
                identified={identified}
                snapshot={snapshot}
                listed={listed}
                events={events.items}
                onClose={() => {
                  setOpenUid(null);
                  setIdentified(null);
                }}
              />
            )}
          </>
        );
      }}
    </DeviceGate>
  );
}

/**
 * Build the remembered identity of a dispatch out of what the service answered.
 *
 * The three command fields are read out of the response and every one of them is
 * nullable, because they are additions to a route that existed before the durable
 * command record. Absent is recorded as `null` and rendered as "not reported",
 * which is a true statement about a service that did not say — and not the same
 * thing as a zero, which would read as a sequence number.
 */
function trackedFrom(response: ItemRegisterResponse, body: ItemRegisterRequest): TrackedCommand {
  return {
    uid: response.uid,
    body,
    // The local clock, and used for nothing but the operator's own sense of how
    // long ago they pressed the button. The service's own timestamps are the ones
    // shown as facts.
    dispatchedAt: Date.now(),
    commandId: response.command_id ?? null,
    cmdSeq: response.cmd_seq ?? null,
    expiresAtEpoch: response.expires_at_epoch ?? null,
  };
}

/**
 * Resolves the uid against whichever list the page is showing, so a retired item
 * opens its own detail rather than reporting that it has gone.
 *
 * AND THE FALLBACK, WHICH IS THE POINT
 * -----------------------------------------------------------------------------
 * `listed` wins whenever it has the item, so an open drawer keeps updating as
 * snapshots arrive — that is the behaviour this had before the identify flow
 * existed and it should not be lost.
 *
 * `identified` is the fallback: the item the lookup route returned, for the case
 * where the snapshot this page holds is older than the lookup. Both come from the
 * service and both are the same projection, so preferring the list costs nothing
 * and preferring the lookup would make an open drawer freeze. The only value that
 * could differ is one the device has not reported yet, and the device is the
 * authority on what it is storing — so when the two disagree, the list is right,
 * and until they agree the item the operator is looking at is still shown rather
 * than replaced by a message about this page's own staleness.
 */
function ItemDrawerFor({
  uid,
  identified,
  snapshot,
  listed,
  events,
  onClose,
}: {
  readonly uid: string;
  readonly identified: InventoryItem | null;
  readonly snapshot: CurrentResponse;
  readonly listed: readonly InventoryItem[];
  readonly events: readonly DeviceEvent[];
  readonly onClose: () => void;
}) {
  const item = useMemo(
    () => listed.find((entry) => entry.uid === uid) ?? (identified !== null && identified.uid === uid ? identified : null),
    [listed, identified, uid],
  );
  if (item === null) {
    return (
      <div className="panel__body">
        <p className="note">
          That item is not in the list this page is showing. It may have been retired since the drawer was opened; a
          refresh would find it.
        </p>
      </div>
    );
  }
  return <ItemDrawer item={item} snapshot={snapshot} events={events} onClose={onClose} />;
}

