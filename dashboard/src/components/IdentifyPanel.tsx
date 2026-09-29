/**
 * Identify an item from its unique id. One action, three ways in.
 *
 * ===========================================================================
 * ONE ACTION, BECAUSE TWO FLOWS WOULD DRIFT
 * ===========================================================================
 *
 * SRS L105-108 / L157 / L305-308 make identification mandatory, and make it
 * mandatory through a unique identification id on a label. SRS L542 lists QR or
 * RFID tracking as optional. So the id is the contract and every peripheral is
 * only a way of obtaining it, which means a camera reading a printed code, the
 * cabinet's own reader reporting one, and a volunteer typing what is printed on
 * the label are three inputs to ONE function — `identify()` below — and one
 * classification of one response. Every one of them ends in `getItemByUid`, and
 * every one of them is presented by the same outcome block.
 *
 * The alternative, which this replaces, was a panel that matched a typed uid
 * against the inventory list already in the browser. That could drift from the
 * service in one specific and dangerous way: it could not tell a RETIRED id from
 * an UNKNOWN one, because a retired item is simply absent from the active list.
 * So it reported "not found" about an id the service knew perfectly well, and
 * offered to register it — which would have told a volunteer to add a duplicate
 * of an item already on the shelf. The 404/409 split is what makes the difference
 * visible, and only a request can see it.
 *
 * ===========================================================================
 * WHAT THIS PANEL IS NOT ALLOWED TO DO
 * ===========================================================================
 *
 *   - It never shows an item the service did not return. `found` carries
 *     `response.item` and nothing else, and this component has no way to add a
 *     row to the inventory table above it.
 *   - It never shows a QR payload as a value. SRS L105-108 lets a sticker
 *     "contain" details as well as link to them, so a label can carry a name and
 *     a date. Those are claims by whoever printed the sticker. Only the id is
 *     lifted out of a label (`extractUidCandidate`), the raw text is shown
 *     separately and explicitly labelled as what the label said, and the item is
 *     only ever the service's.
 *   - It never draws a conclusion about food from a sensor. SRS L227 forbids
 *     using a sensor to identify which item caused a condition. Identifying an id
 *     says which item is PRESENT; the verdict rendered below is the engine's
 *     existing per-item block, which references the cabinet condition rather than
 *     inheriting it. Nothing here joins the two.
 *   - It never fails silently. Each of the four answers gets its own treatment,
 *     and so does every failure of the request itself.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { getItemByUid } from '../api/endpoints';
import { ITEM_FIELD_CAPS, type DeviceEvent, type InventoryItem } from '../api/types';
import { toApiError } from '../lib/useResource';
import { dateTime, number, remaining } from '../lib/format';
import { useDashboard, useDashboardActions } from '../store/DashboardProvider';
import { Mark } from './Mark';
import { QrCodeDrawer } from './QrCodeDrawer';
import { QrScanner } from './QrScanner';
import { RfidScan, isReaderObservation } from './RfidScan';
import { StatusChip } from './StatusChip';
import {
  classifyLookupFailure,
  extractionProblem,
  extractUidCandidate,
  identifyPresentation,
  labelFormSentence,
  originSentence,
  ID_SHAPE_RULE,
  type IdentifyOrigin,
  type IdentifyOutcome,
  type IdentifyRequest,
  type LabelForm,
} from '../app/inventory/identify';

/**
 * `ITEM_FIELD_CAPS.uid` as a sentence.
 *
 * Interpolated rather than typed out, because this cap is mirrored in
 * `api/types.ts` from the service and a second hard-coded "1-64" in prose would
 * be a third place to forget to update it.
 */
const UID_RULE = `${ITEM_FIELD_CAPS.uid} or fewer hexadecimal characters (the digits 0-9 and the letters A-F), with nothing between them`;

/**
 * How long one identification suppresses an identical one.
 *
 * Shared by all three sources on purpose. A label held in front of the camera
 * and the same label on the cabinet's reader within the same few seconds are one
 * event observed twice, and answering it twice would replace a result the
 * operator was reading with an identical one at the moment they were reaching
 * for the button underneath it. It also means the debounce does not have to be
 * perfect in the scanner: this is the second line of defence, and the one that
 * actually holds.
 */
const REPEAT_WINDOW_MS = 2500;

export interface IdentifyPanelProps {
  readonly dev: string;
  /** The device's stored events, newest first, and whether they are still loading. */
  readonly events: {
    readonly items: readonly DeviceEvent[];
    readonly loading: boolean;
  };
  /** The device has flagged its optional reader as unavailable. */
  readonly readerFault: boolean;
  /** Open the existing drawer for an item the service returned. */
  readonly onOpenItem: (item: InventoryItem) => void;
  /**
   * Open the registration form for a uid, pre-filled and locked.
   *
   * Both of the SRS's other verbs route here: "retrieved or updated" (L105-108)
   * is the found case, and a not-yet-registered id is the case the form exists
   * for. The uid is passed rather than retyped.
   */
  readonly onRegister: (uid: string) => void;
  /**
   * The service verdict's chip, rendered by the page.
   *
   * Passed in rather than imported, because `VerdictChip` lives in the inventory
   * app and components here sit below it in the dependency order. The page
   * already owns that vocabulary; this panel asks for the one piece of it it
   * needs instead of reaching across.
   */
  readonly renderVerdict: (status: string) => ReactNode;
}

export function IdentifyPanel({ dev, events, readerFault, onOpenItem, onRegister, renderVerdict }: IdentifyPanelProps) {
  const { snapshot } = useDashboard();
  const { reloadEvents } = useDashboardActions();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrDrawerOpen, setQrDrawerOpen] = useState(false);
  const [qrDrawerUid, setQrDrawerUid] = useState('');
  const [typed, setTyped] = useState('');
  const [outcome, setOutcome] = useState<IdentifyOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  /** What a label yielded that was not usable, so it can be explained. */
  const [labelProblem, setLabelProblem] = useState<{ readonly text: string; readonly why: string } | null>(null);
  /** How the id was taken out of a decoded label, so the panel can say so. */
  const [labelForm, setLabelForm] = useState<LabelForm | null>(null);

  const inputId = useId();
  const hintId = useId();
  const titleId = useId();
  const outcomeTitleId = useId();

  /**
   * One identification in flight at a time, and only the newest may write.
   *
   * A camera read, a reader event and a typed uid can all arrive within a second
   * of each other, and the responses can come back out of order. `ticket` is
   * compared before every `setOutcome`, so a slow answer for an old uid can never
   * overwrite a fast answer for the one the operator is actually looking at.
   */
  const ticketRef = useRef(0);
  const lastRef = useRef<{ readonly uid: string; readonly at: number } | null>(null);

  /**
   * THE ONE ACTION.
   *
   * Takes the id and how it was obtained, and nothing else. It does not care
   * which source called it, which is the whole reason the three sources cannot
   * drift: there is no second code path to keep in step, and no way for the
   * camera path to be correct about a retired id while the manual path is not.
   */
  const identify = useCallback(
    (uid: string, origin: IdentifyOrigin, from?: { readonly labelText: string; readonly form: LabelForm }) => {
      const previous = lastRef.current;
      const at = Date.now();
      if (previous !== null && previous.uid === uid && at - previous.at < REPEAT_WINDOW_MS) return;
      lastRef.current = { uid, at };

      const request: IdentifyRequest = { uid, origin, ...(from === undefined ? {} : { labelText: from.labelText }) };
      const ticket = ticketRef.current + 1;
      ticketRef.current = ticket;

      setBusy(true);
      setOutcome(null);
      setLabelProblem(null);
      // Set here rather than by the caller, so there is no ordering hazard: the
      // caller used to set it and then call this, which reset it again.
      setLabelForm(from === undefined ? null : from.form);

      getItemByUid(dev, uid).then(
        (response) => {
          if (ticketRef.current !== ticket) return;
          setBusy(false);
          setOutcome({ kind: 'found', request, item: response.item });
        },
        (cause: unknown) => {
          if (ticketRef.current !== ticket) return;
          setBusy(false);
          setOutcome(classifyLookupFailure(request, toApiError(cause)));
        },
      );
    },
    [dev],
  );

  /**
   * AN EXPLICIT RETRY, which is not a repeat.
   *
   * The repeat window exists to swallow a label that two sources reported at
   * once. A person pressing "try again" after a 429 is not that, and the window
   * would silently swallow their click for two and a half seconds — so the record
   * of the last attempt is dropped first and the same action runs.
   */
  const retry = useCallback(
    (uid: string, origin: IdentifyOrigin) => {
      lastRef.current = null;
      identify(uid, origin);
    },
    [identify],
  );

  // A different cabinet is a different world. Nothing identified on the last one
  // may be on screen beside this one's controls.
  useEffect(() => {
    ticketRef.current += 1;
    lastRef.current = null;
    setOutcome(null);
    setBusy(false);
    setLabelProblem(null);
    setLabelForm(null);
    setScannerOpen(false);
  }, [dev]);

  /**
   * THE CAMERA PATH.
   *
   * Takes the decoded text, lifts the id out of it, and hands that to the same
   * action. The panel closes around the scanner on the way through: the scanner
   * has already stopped the stream by the time it calls back, and this removes
   * the frame rather than leaving a live preview on screen looking like it is
   * still looking.
   */
  const onDecoded = useCallback(
    (text: string) => {
      setScannerOpen(false);
      const extracted = extractUidCandidate(text);
      if (extracted.kind === 'none') {
        setOutcome(null);
        setBusy(false);
        setLabelForm(null);
        setLabelProblem({ text, why: extractionProblem(extracted.reason) });
        return;
      }
      identify(extracted.uid, 'camera', { labelText: text, form: extracted.form });
    },
    [identify],
  );

  const primedForRef = useRef<string | null>(null);
  /**
   * The highest SERVER row id (`event.id`) this tab has seen for this device —
   * or `null` while it has seen none at all.
   *
   * `null` is a real state, not "-1 under another name": it means there is no
   * sequence yet to compare against, which is where the panel starts and where
   * it stays for as long as the service sends rows without `id`. See the note
   * on `DeviceEvent.id` for why the fallback in that case is deliberately
   * "nothing is new" rather than `event_id`.
   */
  const highestSeenRef = useRef<number | null>(null);

  /**
   * THE DEVICE-READER PATH, REACTING TO THE PUSH.
   *
   * An observation arrives as an ordinary stored event, surfaced by `/events`.
   * There is no separate scan stream and none is needed: the live feed already
   * publishes a complete snapshot on every accepted ingest, and the snapshot
   * object is replaced outright each time — so its identity changing IS the push
   * signal. That is the only trigger used. There is no interval, no timer and no
   * `setTimeout` anywhere in this feature: nothing here polls on a clock.
   *
   * Re-reading the event page is what makes an observation visible, because an
   * observation is a stored event and not part of the snapshot. `reloadEvents`
   * invalidates the client's cache and re-requests one bounded page, so the cost
   * is about twelve small requests a minute at the device's ~5 s reporting
   * interval, against a service configured for six hundred reads a minute — and
   * only while this page is on screen, because the panel is not mounted otherwise.
   */
  useEffect(() => {
    if (snapshot === null) return;
    reloadEvents();
  }, [snapshot, reloadEvents]);

  /**
   * THE DIFFERENCE, AND THE PLACES IT COULD GO WRONG IN THE DANGEROUS
   * DIRECTION.
   *
   * THE FIRST PAGE IS NEVER TREATED AS NEWS. A device that has been running for a
   * day has a day of observations in page one, and identifying all of them on
   * arrival would fire off a dozen lookups at a volunteer who has just opened the
   * page. So the first SETTLED page for a device is marked as already seen.
   *
   * "Settled" means `loading === false`, and an EMPTY page does not count as
   * settled for this purpose: the store publishes an empty, not-loading slice
   * before its first fetch begins, and treating that as the baseline would make
   * every real event that followed look new. The consequence of getting this
   * wrong in the safe direction is that the very first observation can be missed,
   * which is one missed lookup rather than one burst of a dozen wrong ones — and
   * that is the right way round, because a burst would replace whatever the
   * operator was reading with an unrelated item.
   *
   * "NEW" IS DECIDED AGAINST THE SERVER'S ROW ID, `event.id` — NEVER AGAINST
   * `event_id`. This used to be the other way round, on the premise that ids are
   * monotonic, so one number is the whole of the memory. That premise is false
   * and has been since migration `005_boot_generation.sql`: `event_id` is the
   * DEVICE's counter, the dedupe key is now `(device_id, boot_generation,
   * event_id)`, and it restarts at 1 after every reflash by design. So a
   * high-water mark kept across a flash puts every genuinely new event BELOW the
   * mark already seen — and the failure is silent. No error, no failed request,
   * no warning in the console: the filter simply starves and this panel never
   * fires again for the rest of the tab's life, while a label is being held in
   * front of a reader that is reporting perfectly well. `event.id` is the
   * service's AUTOINCREMENT row id — the same sequence `/events` sorts by and
   * its `before` cursor walks — so it still increases after a flash, and one
   * integer remains the whole of the memory: a set of seen ids would grow for
   * the life of a long-lived tab to answer a question one number answers.
   *
   * A ROW WITHOUT A ROW ID IS NEVER NEW. An older service may not send `id` yet.
   * Such a row is skipped rather than compared, and it is explicitly NOT
   * compared against `event_id` instead, because "ids are monotonic" is exactly
   * the premise the flash disproves — falling back would reinstate the silent
   * starvation this rule exists to prevent. A skipped observation costs one
   * missed lookup; the alternative, guessing, costs a burst of lookups for
   * events already on screen. For the same reason `highestSeenRef` stays `null`
   * until a page actually carries row ids: priming continues across pages, so
   * the first id-carrying page becomes the baseline rather than firing a burst
   * of historical observations that the old service never let us number.
   */
  useEffect(() => {
    if (events.loading || events.items.length === 0) return;

    // The highest SERVER row id on this page. Rows that arrived without one
    // cannot be placed in the sequence, so they cannot move it either.
    let highest: number | null = null;
    for (const event of events.items) {
      if (typeof event.id === 'number' && (highest === null || event.id > highest)) highest = event.id;
    }

    if (primedForRef.current !== dev || highestSeenRef.current === null) {
      primedForRef.current = dev;
      // `highest` may be null — a page with no row ids leaves the panel still
      // waiting for a sequence, which is the safe direction (see above).
      highestSeenRef.current = highest;
      return;
    }

    const seen = highestSeenRef.current;
    const fresh = events.items
      .filter(
        (event): event is DeviceEvent & { readonly uid: string } =>
          isReaderObservation(event) && typeof event.id === 'number' && event.id > seen,
      )
      // OLDEST FIRST, so the most recent observation is the one left on screen:
      // the page arrives newest-first and each `identify()` takes the last
      // ticket, so the last one fired is the one whose answer survives — it has
      // to be the newest observation, not the oldest. The order is by `id` and
      // not by `event_id`, which restarts per boot and would place a post-flash
      // event ahead of ones it actually followed.
      .sort((a, b) => a.id - b.id);

    if (highest !== null) highestSeenRef.current = Math.max(seen, highest);
    if (fresh.length === 0) return;

    for (const event of fresh) identify(event.uid, 'device');
  }, [dev, events.items, events.loading, identify]);

  /**
   * THE MANUAL PATH. Always present, never conditional.
   *
   * Not a fallback in the apologetic sense: it is the path that works over plain
   * HTTP on the LAN, the path a keyboard and a screen reader take, and the path
   * that works when the camera is broken, the device has no reader, and the
   * battery is flat. It is a full peer of the camera and it is rendered even
   * while the camera is working.
   */
  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const uid = typed.trim();
      if (uid === '') return;
      identify(uid, 'typed');
    },
    [typed, identify],
  );

  const dismiss = useCallback(() => {
    ticketRef.current += 1;
    setOutcome(null);
    setBusy(false);
    setLabelProblem(null);
    setLabelForm(null);
  }, []);

  const presentation = outcome === null ? null : identifyPresentation(outcome);

  return (
    <section className="panel" aria-labelledby={titleId}>
      <div className="panel__head">
          <h2 className="panel__title" id={titleId}>
            Identify an item
          </h2>
        <p className="panel__sub">
          Read the QR label with this device&apos;s camera, or type the unique id printed on it. Both are the same lookup
          against <span className="num">{dev}</span>.
        </p>
      </div>

      <div className="panel__body">
        <p className="note">
          <strong>Identification is by unique id, not by any one reader.</strong> The SRS requires it through a unique
          identification id on the label (L105-108, L157, L305-308) and treats QR or RFID tracking as optional (L542), so
          the id is the contract and the camera and the cabinet reader are two ways of obtaining it. A FreshGuard id is{' '}
          {ID_SHAPE_RULE}.
        </p>

        {/*
          THE CAMERA, as the primary path, and a real button.

          `aria-expanded` and `aria-controls` tie the trigger to the frame it
          opens, so a screen-reader user hears the relationship rather than
          finding a live video element appear below with no announcement.
        */}
        <div className="identify__camera">
          <button
            type="button"
            className="btn btn--primary"
            aria-expanded={scannerOpen}
            aria-controls={scannerOpen ? 'identify-scanner' : undefined}
            onClick={() => setScannerOpen((open) => !open)}
          >
            {scannerOpen ? 'Close the camera' : 'Scan a label with the camera'}
          </button>
          <p className="field__hint">
            Decoded on this device. Nothing the camera sees is uploaded, logged or sent anywhere — only the unique id
            printed on the label leaves this page, and only as part of the lookup below.
          </p>
        </div>

        {scannerOpen ? (
          <div id="identify-scanner">
            <QrScanner open onRead={onDecoded} onClose={() => setScannerOpen(false)} />
          </div>
        ) : null}

        {/*
          THE MANUAL PATH, rendered unconditionally and given the same visual
          weight as the camera — because on this project's LAN address it is the
          one that works.
        */}
        <form className="identify__manual" onSubmit={submit}>
          <div className="field">
            <label className="field__label" htmlFor={inputId}>
              Unique id on the label
            </label>
            <input
              id={inputId}
              className="field__input"
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="1778F106"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              aria-describedby={hintId}
            />
            <p className="field__hint" id={hintId}>
              Type or paste it exactly as printed. The case is not corrected for you and separators are not removed,
              because rewriting what someone read off a label could look up a different item than the one in their hand. If
              the service refuses it, the answer below says what it expected and shows what was sent.
            </p>
          </div>
          <div className="identify__manual-actions">
            <button type="submit" className="btn btn--primary" aria-disabled={busy || typed.trim() === ''}>
              Look up this id
            </button>
            <button type="button" className="btn btn--quiet" onClick={dismiss} aria-disabled={outcome === null && labelProblem === null}>
              Clear
            </button>
          </div>
        </form>

        {/*
          THE OUTCOME, announced.

          A dedicated, visually-hidden live region carrying one short sentence.
          The outcome block below it is ordinary content: making the whole block
          live would read the id, the service code and every paragraph out loud on
          top of that sentence, which talks over the person rather than informing
          them.
        */}
        <p className="visually-hidden" role="status" aria-live="polite">
          {busy ? 'Looking the id up…' : (presentation?.live ?? '')}
        </p>

        {labelProblem === null ? null : (
          <div className="notice" data-kind="service" role="note">
            <Mark shape="diamond" className="mark--lg" />
            <div>
              <p className="notice__kind">Nothing to look up</p>
              <p className="notice__title">That label does not carry a unique id</p>
              <div className="notice__body">
                <p>{labelProblem.why}</p>
                <p>A FreshGuard id is {ID_SHAPE_RULE}.</p>
                <p>
                  The label read: <span className="num" translate="no">{labelProblem.text}</span>
                </p>
                <p>No request was made, and nothing has been concluded about this item.</p>
              </div>
            </div>
          </div>
        )}

        {busy && outcome === null ? <p className="loading-line" aria-hidden="true">Looking the id up…</p> : null}

        {outcome === null || presentation === null ? null : (
          <div
            className="identify__outcome"
            {...(presentation.serviceFailure ? { 'data-kind': 'service' } : { 'data-tone': presentation.tone })}
            role="group"
            aria-labelledby={outcomeTitleId}
          >
            <p className="identify__outcome-kind">
              <Mark shape={presentation.shape} className="mark--sm" />
              {presentation.kind}
            </p>
            <p className="identify__outcome-title" id={outcomeTitleId}>
              {presentation.title}
            </p>

            {/* WHAT WAS SENT, AND WHERE IT CAME FROM. A result with no
                provenance is a result nobody can check, and the raw label text
                has to be visible so the claim "only the id was read from it" can
                be verified rather than believed. */}
            <p className="identify__outcome-origin">
              <span className="chip chip--plain">id {outcome.request.uid}</span>
              <span className="identify__origin-text">{originSentence(outcome.request.origin)}</span>
              {outcome.request.labelText === undefined ? null : (
                <span className="identify__label-echo">
                  Label read: <span className="num" translate="no">{outcome.request.labelText}</span>
                  {labelForm === null ? null : <span className="withheld__note">{labelFormSentence(labelForm)}</span>}
                </span>
              )}
            </p>

            {outcome.kind === 'found' ? (
              <FoundOutcome
                item={outcome.item}
                dev={dev}
                offersUpdate={presentation.offersUpdate}
                renderVerdict={renderVerdict}
                onOpen={() => onOpenItem(outcome.item)}
                onUpdate={() => onRegister(outcome.item.uid)}
                onShowQr={(uid) => { setQrDrawerUid(uid); setQrDrawerOpen(true); }}
              />
            ) : (
              <FailureOutcome
                outcome={outcome}
                dev={dev}
                offersRegistration={presentation.offersRegistration}
                onRegister={() => onRegister(outcome.request.uid)}
                onRetry={() => retry(outcome.request.uid, outcome.request.origin)}
              />
            )}
          </div>
        )}

        {/*
          THE DEVICE READER. Its own component, because it is the only part of
          this panel that is about an optional peripheral rather than about
          identification, and it renders identically whichever of the three
          sources produced the result.
        */}
        <RfidScan dev={dev} events={events.items} readerFault={readerFault} />
      </div>

      <div className="panel__foot">
        <p className="hint">
          A scan identifies an item. It never says which item caused a condition: this product has one thermometer, one
          humidity sensor and one gas sensor, and all three measure the air in the cabinet, shared by everything in it
          (SRS L227). The verdict shown with a found item is the service&apos;s own — computed from that item&apos;s dates
          and the cabinet it shares, and labelled as an inference about cabinet air rather than a measurement of the item.
        </p>
      </div>
      <QrCodeDrawer
        uid={qrDrawerUid}
        open={qrDrawerOpen}
        onClose={() => setQrDrawerOpen(false)}
      />
    </section>
  );
}

/**
 * THE FOUND ANSWER.
 *
 * Two verdicts are shown and they are not merged, because they are not the same
 * claim and the table above says the same thing:
 *
 *   - the SERVICE verdict, from the engine, which is the one to act on; and
 *   - the DEVICE's own `status`, which the backend itself marks provisional and
 *     not authoritative, because it is inferred from the same shared cabinet air
 *     and cannot tell one item from another in the same cabinet.
 *
 * And two actions, because SRS L105-108 says a scanned item's details may be
 * "retrieved or updated": opening the drawer is the retrieval, and re-sending
 * the registration for the same id is the update. Re-registering an id is
 * explicitly safe — the device re-registers it and the service revives that row
 * rather than creating a second one — which is what makes "update" a real
 * capability here rather than a hopeful label on a button.
 */
function FoundOutcome({
  item,
  dev,
  offersUpdate,
  renderVerdict,
  onOpen,
  onUpdate,
  onShowQr,
}: {
  readonly item: InventoryItem;
  readonly dev: string;
  /** From the pure module, so which actions exist is decided in one place. */
  readonly offersUpdate: boolean;
  readonly renderVerdict: (status: string) => ReactNode;
  readonly onOpen: () => void;
  readonly onUpdate: () => void;
  readonly onShowQr: (uid: string) => void;
}) {
  const verdict = item.freshness ?? null;
  const timeLeft = remaining(item.derived.remaining_seconds);

  return (
    <>
      <div className="identify__found">
        <dl className="facts">
          <div className="fact">
            <span className="fact__label">Unique id</span>
            <span className="fact__value" translate="no">
              {item.uid}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Category</span>
            <span className="fact__value">{item.category ?? 'not reported'}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Location</span>
            <span className="fact__value">{item.location ?? 'not reported'}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Stored</span>
            <span className="fact__value">
              {item.store_date === null ? <span className="withheld__value">not reported</span> : dateTime(item.store_date)}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Deadline</span>
            <span className="fact__value">
              {item.derived.deadline === null ? (
                <span className="withheld__value">none registered</span>
              ) : (
                dateTime(item.derived.deadline)
              )}
              {timeLeft === null ? null : <span className="withheld__note">{timeLeft}</span>}
            </span>
          </div>
        </dl>

        <div className="identify__verdicts">
          <p className="identify__verdict">
            <span className="identify__verdict-label">Service verdict</span>{' '}
            {verdict === null ? (
              <span className="withheld__value">not computed by this service</span>
            ) : (
              <>
                {renderVerdict(verdict.status)}
                <span className="chip chip--plain">{verdict.status}</span>
              </>
            )}
          </p>
          <p className="identify__verdict">
            <span className="identify__verdict-label">Device&apos;s own status</span> <StatusChip status={item.status} />
            <span className="withheld__note">
              Reported by the device, and marked not authoritative by the service: it is inferred from the same cabinet air
              and cannot tell one item from another in the same cabinet.
            </span>
          </p>
          <p className="identify__verdict-reason">
            {verdict === null
              ? 'This service did not compute a freshness verdict for this item, so none is shown. That is an absence in the record, not a good result.'
              : verdict.reason}
          </p>
        </div>

        <p className="notice__meta">
          revision {number(item.revisions.last, 0)} on {dev} · in service · the service returned this item and computed
          nothing here
        </p>
      </div>

      <div className="notice__actions">
        <button type="button" className="btn btn--primary" onClick={onOpen}>
          Open the item
        </button>
        {offersUpdate ? (
          <button type="button" className="btn" onClick={onUpdate}>
            Update these details
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => onShowQr(item.uid)}>
          QR Code
        </button>
      </div>
    </>
  );
}

/**
 * THE THREE ANSWERS THAT ARE NOT "FOUND", plus the service failures.
 *
 * Each is a different problem with a different next step, which is why they are
 * separate blocks and not one error with three strings in it:
 *
 *   retired     the service KNOWS this id and has withdrawn it. Offering to
 *               register it would be actively wrong — that is precisely the
 *               mistake a list-matching panel makes — so there is no register
 *               action here at all.
 *   unknown     the service has never heard of it. Registering is the correct
 *               next step, and the id is handed to the form pre-filled and
 *               locked, because a volunteer who retypes sixteen hexadecimal
 *               characters will eventually mistype one and register a label under
 *               an id that is not the one in their hand.
 *   malformed   the value is not an id at all, so no lookup was made. There is
 *               nothing to register, because the thing in the hand is not an id.
 */
function FailureOutcome({
  outcome,
  dev,
  offersRegistration,
  onRegister,
  onRetry,
}: {
  readonly outcome: Exclude<IdentifyOutcome, { kind: 'found' }>;
  readonly dev: string;
  /** From the pure module, so which actions exist is decided in one place. */
  readonly offersRegistration: boolean;
  readonly onRegister: () => void;
  readonly onRetry: () => void;
}) {
  return (
    <div className="notice__body">
      {outcome.kind === 'retired' ? (
        <>
          <p>
            <strong>This id was registered and has since been withdrawn from service.</strong> It is not missing, and it is
            not unknown — the service holds a record of it, which is exactly what makes this answer different from the one
            under it. Registering it again here would be wrong, so there is nothing to do with this label but look up the
            one you actually meant.
          </p>
          <p>
            Withdrawn:{' '}
            {outcome.retiredAt === null ? (
              <span className="withheld__value">the service did not state when</span>
            ) : (
              <span className="num">{dateTime(outcome.retiredAt)}</span>
            )}
            {outcome.retiredAtRevision === null ? null : (
              <>
                {' '}
                · at inventory revision <span className="num">{number(outcome.retiredAtRevision, 0)}</span>
              </>
            )}
          </p>
          <p>
            A retired item is not counted as stored and does not appear in the inventory above. It is not food that has
            gone off and it is not a fault: the device reported it gone in a later snapshot, which is the ordinary way a
            container leaves the registry once it has been used up or thrown out.
          </p>
          <p className="notice__meta">
            service code {outcome.code} · HTTP 409 · the service said: {outcome.message}
          </p>
        </>
      ) : null}

      {outcome.kind === 'unknown' ? (
        <>
          <p>
            <strong>Nothing on {dev} is registered under this id.</strong> That is a fact about the inventory rather than
            a fault in the monitor, and it is exactly what a label nobody registered looks like. It is emphatically not
            the answer above: this id was never known here, and that one was registered and then withdrawn.
          </p>
          <p>Worth checking, in order: whether the label belongs to a different cabinet; whether the item was registered under a different spelling, since the case is not corrected for you; and whether it has been registered at all.</p>
          <p>
            <strong>Registering it sends a command to the device, not a row to the service.</strong> The item joins the
            inventory above only once {dev} reports it in a later snapshot over the live feed, so nothing will be counted
            as stored until the device says so.
          </p>
          <p className="notice__meta">
            service code {outcome.code} · HTTP 404 · the service said: {outcome.message}
          </p>
        </>
      ) : null}

      {outcome.kind === 'malformed' ? (
        <>
          <p>
            <strong>No lookup was made.</strong> The value is not a FreshGuard id, so there is nothing to look up and
            nothing to register — the thing in the hand is not an id.
          </p>
          <p>A FreshGuard id is {ID_SHAPE_RULE}, which is {UID_RULE}.</p>
          <p>
            A label printed with separators — <code className="num">04:A3:1B:2C</code> — is refused exactly like this, and
            so is one in a different case from the one the device holds. The value that was sent is shown above, unchanged,
            so it can be compared against what is printed on the label.
          </p>
          <p className="notice__meta">
            service code {outcome.code} · HTTP 400 · the service said: {outcome.message}
          </p>
        </>
      ) : null}

      {outcome.kind === 'unavailable' ? (
        <>
          <p>
            <strong>Nothing has been concluded about this label.</strong> The lookup did not complete, so the service has
            not told us whether this id is registered, and this screen will not guess in either direction. In particular it
            is not reported as missing, because a request that failed is not evidence about an item.
          </p>
          <p className="notice__meta">
            service code {outcome.code}
            {outcome.reason === 'no-answer' ? '' : ` · the service answered ${outcome.reason.replace('-', ' ')}`} · the
            service said: {outcome.message}
          </p>
        </>
      ) : null}

      <div className="notice__actions">
        {outcome.kind === 'unknown' && offersRegistration ? (
          <button type="button" className="btn btn--primary" onClick={onRegister}>
            Register this id
          </button>
        ) : null}
        {outcome.kind === 'unavailable' ? (
          <button type="button" className="btn" onClick={onRetry}>
            Try that id again
          </button>
        ) : null}
        {outcome.kind === 'retired' || outcome.kind === 'malformed' ? (
          <p className="field__hint">
            Clear the box above to identify a different label.{' '}
            {outcome.kind === 'retired' ? 'This one does not come back into service by being scanned.' : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}
