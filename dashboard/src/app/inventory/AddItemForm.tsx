/**
 * Registering an item without a serial cable.
 *
 * The cabinet's LCD and its reader are the usual way a volunteer puts food into
 * the device, and this form is the other way: `POST /api/v1/devices/:dev/items`
 * exists, so the walk-up workflow has a path that does not need a laptop in the
 * storeroom. The old identify panel used to claim the opposite — it rendered a
 * deliberately dead "Register Item" button on the stated grounds that "the
 * service has no route that adds an item". That was false, and it is exactly why
 * the dead control is gone: registration is not a missing capability, it is this
 * form.
 *
 * IT CAN BE OPENED PRE-FILLED AND LOCKED, BY THE IDENTIFY FLOW
 * -----------------------------------------------------------------------------
 * `prefillUid` and `lockUid` exist for SRS L105-108's "retrieved or updated":
 * a scanned id is either already registered (update its details) or answered
 * `unknown_uid` (register it), and in both cases the id arrived from a LABEL.
 * Passing it in rather than asking for it again is the point — a volunteer who
 * retypes sixteen hexadecimal characters will eventually mistype one, and the
 * result is an item registered under an id that is not the one in their hand.
 *
 * WHAT THIS FORM IS NOT ALLOWED TO DO
 * -----------------------------------------------------------------------------
 * It must never show the item as stored. The service dispatches an intent and
 * answers `state: "dispatched"`; the device has confirmed nothing at that moment
 * and there is no row anywhere — the backend module has no database handle at
 * all, by design. The item becomes visible in `inventory[]` only when the device
 * reports it in a later snapshot, which arrives over the SSE stream this page is
 * already listening to. So:
 *
 *   - the form never writes into the list, and `onDispatched` is named for what
 *     it carries (a dispatch) rather than for what an operator wishes it meant;
 *   - the confirmation says "awaiting the device", and the page below the table
 *     turns that into "the device has reported it" only when the uid is really
 *     in the snapshot, read from the same data the table reads.
 *
 * A row that appeared before the device sent it would be the one lie this
 * dashboard exists not to tell: a volunteer would count an item in the cabinet
 * that is not in the cabinet.
 *
 * THE 503 IS A SEPARATE SCREEN, NOT A RED VERSION OF "SAVE FAILED"
 * -----------------------------------------------------------------------------
 * The service answers 503 for two different transport faults and they are not
 * interchangeable, because the operator's next move is not the same:
 *
 *   transport_unavailable  the broker connection is down, so the command never
 *                          left the process. Nothing happened. Retry once the
 *                          transport is up.
 *   command_unconfirmed    the publish was handed to a client that never
 *                          acknowledged it. Delivery is genuinely unknown.
 *
 * Both are rendered as "not registered", neither is allowed to say the item is
 * in, and neither is allowed to borrow a food verdict's colour to make a point
 * about an MQTT socket — the project already removed tones from service failures
 * for exactly that reason (see `Notices.tsx`), so they take `data-kind="service"`.
 *
 * ZERO IS A VALUE, NOT A BLANK
 * -----------------------------------------------------------------------------
 * On this wire `expiry_epoch: 0` means "use `duration_days` instead" and
 * `manufacture_epoch: 0` means "unknown" — neither is the same as omitting the
 * field, and neither is the same as an empty input. That is why expiry is a
 * two-way choice with two explicit meanings rather than a date box that may be
 * left empty, why "Unknown" is a real option for manufacture rather than the
 * absence of a date, and why `toRequest` always sends both epochs explicitly
 * instead of spreading a possibly-undefined value into the body.
 *
 * THE CLIENT MIRRORS A FEW RULES AND IS NOT THE AUTHORITY
 * -----------------------------------------------------------------------------
 * Required fields, the length caps and `duration_days`' range are checked here
 * so an obvious mistake costs a keystroke instead of a round trip. That is the
 * entire extent of the client's authority. The service enforces the real schema
 * and its 400 is what decides, and because the two are separately maintained
 * they are allowed to disagree: when they do, the service's own field-named
 * message is the one shown (`rejectedFields` overlays the local problems), so a
 * dashboard built against an older backend learns what the backend actually
 * thinks rather than what this file believes. The client adds no rule the service
 * would not enforce, and it removes none of the service's either.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, hasAdminToken } from '../../api/client';
import { registerItem } from '../../api/endpoints';
import {
  ITEM_FIELD_CAPS,
  MAX_DURATION_DAYS,
  MAX_EPOCH_YEAR_2100,
  type ItemRegisterRequest,
  type ItemRegisterResponse,
} from '../../api/types';
import { Mark } from '../../components/Mark';

/**
 * The food categories the architecture's own food-threshold matrix (§15.2) names.
 *
 * A suggestion list, never a constraint. The service caps the field at 32
 * characters and otherwise accepts anything, and a storeroom will hold things
 * none of these seven cover — so this is a `<datalist>` behind a text input
 * rather than a `<select>`. A select would have made "Condiments" the only
 * possible spelling of a category the operator is thinking of as "Sauce", and
 * the category is free text on the wire.
 */
const CATEGORIES: readonly string[] = [
  'Dairy',
  'Vegetables',
  'Fruits',
  'Meat & poultry',
  'Cooked / leftovers',
  'Frozen',
  'Condiments',
];

/**
 * The request field each form control writes, used as the key for validation
 * problems AND for the paths in the service's 400 `details`. They are the same
 * strings on purpose: `detail.path` comes back as `duration_days`, and matching
 * it against this table puts the service's sentence next to the input that
 * caused it instead of in a list at the top of the page.
 */
type FieldKey =
  | 'uid'
  | 'name'
  | 'category'
  | 'quantity'
  | 'location'
  | 'duration_days'
  | 'expiry_epoch'
  | 'manufacture_epoch';

const FIELD_LABELS: Record<FieldKey, string> = {
  uid: 'Tag UID',
  name: 'Name',
  category: 'Category',
  quantity: 'Quantity',
  location: 'Location',
  duration_days: 'Storage duration',
  expiry_epoch: 'Expiry',
  manufacture_epoch: 'Date of manufacture',
};

type Problems = Partial<Record<FieldKey, string>>;

/** A shared empty value, so an un-attempted form does not allocate one per render. */
const EMPTY_PROBLEMS: Problems = {};

/** Which of the two SRS forms of expiry is in play. */
type ExpiryMode = 'duration' | 'date';
/** Manufacture is unknown or a date; "unknown" is a choice, never a blank. */
type ManufactureMode = 'unknown' | 'date';

interface Draft {
  uid: string;
  name: string;
  category: string;
  quantity: string;
  location: string;
  durationDays: string;
  expiryMode: ExpiryMode;
  expiryDate: string;
  manufactureMode: ManufactureMode;
  manufactureDate: string;
}

/**
 * Expiry defaults to the storage-duration form and manufacture to unknown,
 * because those are the two answers an operator can give without a date in front
 * of them — and both are then SENT as an explicit 0 rather than omitted.
 */
const EMPTY_DRAFT: Draft = {
  uid: '',
  name: '',
  category: '',
  quantity: '',
  location: '',
  durationDays: '',
  expiryMode: 'duration',
  expiryDate: '',
  manufactureMode: 'unknown',
  manufactureDate: '',
};

/**
 * `YYYY-MM-DD` to Unix seconds at 00:00 UTC on that date, or null.
 *
 * The UTC is the whole point of this function, so it is written out rather than
 * left to a parser:
 *
 *   - `new Date('2026-03-14')` is specified as UTC midnight, but `new
 *     Date(y, m, d)` is LOCAL midnight. A form that used the second one would
 *     register an expiry shifted by the operator's own UTC offset, and every
 *     sign on it would be right — the picker said 14 March, the dashboard
 *     rendered 14 March, and the item went off a day early or a day late. A date
 *     picker that silently shifts a day is worse than no date picker, so the
 *     conversion is explicit and the chosen instant is printed back to the
 *     operator in the hint for exactly this reason.
 *   - `Date.UTC` ROLLS an impossible day into the next month: 31 February becomes
 *     3 March, silently, which would store an expiry three days past the one an
 *     operator could see. The components are round-tripped rather than trusted.
 *   - `Date.UTC` also remaps a two-digit year into the 1900s, so 0099 would
 *     quietly become 1999. A pre-1970 date is refused outright, which is honest
 *     anyway: epoch 0 IS 1970-01-01, so the command cannot express anything
 *     earlier.
 */
function dateToUtcEpoch(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const at = Date.UTC(year, month - 1, day);
  const round = new Date(at);
  if (round.getUTCFullYear() !== year || round.getUTCMonth() !== month - 1 || round.getUTCDate() !== day) {
    return null;
  }
  return Math.floor(at / 1000);
}

/** The instant as the service will receive it, spelled the way it will store it. */
const asUtcStamp = (epoch: number): string => new Date(epoch * 1000).toISOString().replace('.000Z', 'Z');

/**
 * A whole number of days, or a sentence saying why not.
 *
 * The digit test rather than `Number.isInteger`, because `Number('7.0')` is 7 and
 * `Number('7e0')` is 7000 — a form that quietly did that arithmetic would be
 * choosing a storage window the operator never entered. Digits in, integer out.
 */
function readDays(raw: string): { readonly days: number } | { readonly problem: string } {
  const text = raw.trim();
  if (text === '') return { days: 0 };
  if (!/^\d+$/.test(text)) {
    return { problem: `Storage duration is a whole number of days; “${text}” is not one.` };
  }
  const days = Number(text);
  if (days > MAX_DURATION_DAYS) {
    return { problem: `Storage duration may be at most ${MAX_DURATION_DAYS} days (ten years); this one is ${days}.` };
  }
  return { days };
}

function dateProblem(raw: string): string | null {
  if (raw.trim() === '') return 'Choose the date, or switch back to the other option.';
  if (dateToUtcEpoch(raw) === null) {
    return 'That is not a date this command can carry. Use 1970-01-01 or later, as YYYY-MM-DD.';
  }
  if ((dateToUtcEpoch(raw) ?? 0) > MAX_EPOCH_YEAR_2100) {
    return 'A date past the year 2100 is refused by the service as a mis-scaled value.';
  }
  return null;
}

/**
 * Every problem an operator can hit by typing, keyed by request field.
 *
 * Lengths are measured on the TRIMMED value, because that is the value that goes
 * on the wire and therefore the value the cap applies to. Validating the padded
 * one instead would let a 64-character name with a stray trailing space pass here
 * and be rejected by the service — a local pass that predicts a remote failure,
 * which is the thing this function exists to prevent.
 */
function validate(draft: Draft, lockUid: boolean): Problems {
  const out: Problems = {};

  // A locked uid came from a label the service was asked about, not from a human
  // typing, so it is exempt. That exemption is deliberate and is the reason the
  // lock is safe: the value is either the one on the label or the one the service
  // already refused, and neither is something editing this form can fix.
  if (!lockUid) {
    const uid = draft.uid.trim();
    if (uid === '') {
      out.uid = 'A tag UID is required — the hexadecimal code the reader printed.';
    } else if (!/^[0-9A-Fa-f]+$/.test(uid)) {
      out.uid = 'A UID is hexadecimal only (0-9 and A-F). Remove any “:” or “-” separators.';
    } else if (uid.length > ITEM_FIELD_CAPS.uid) {
      out.uid = `A UID may be at most ${ITEM_FIELD_CAPS.uid} characters; this one is ${uid.length}.`;
    }
  }

  const name = draft.name.trim();
  if (name === '') {
    out.name = 'A name is required — it is what the item is called in the inventory.';
  } else if (name.length > ITEM_FIELD_CAPS.name) {
    out.name = `A name may be at most ${ITEM_FIELD_CAPS.name} characters; this one is ${name.length}.`;
  }

  const capped: readonly (readonly ['category' | 'quantity' | 'location', number])[] = [
    ['category', ITEM_FIELD_CAPS.category],
    ['quantity', ITEM_FIELD_CAPS.quantity],
    ['location', ITEM_FIELD_CAPS.location],
  ];
  for (const [key, cap] of capped) {
    const value = draft[key].trim();
    if (value.length > cap) {
      out[key] = `${FIELD_LABELS[key]} may be at most ${cap} characters; this one is ${value.length}.`;
    }
  }

  const days = readDays(draft.durationDays);
  if ('problem' in days) out.duration_days = days.problem;

  if (draft.expiryMode === 'date') {
    const problem = dateProblem(draft.expiryDate);
    if (problem !== null) out.expiry_epoch = problem;
  }
  if (draft.manufactureMode === 'date') {
    const problem = dateProblem(draft.manufactureDate);
    if (problem !== null) out.manufacture_epoch = problem;
  }

  return out;
}

/**
 * The request body, or null if a chosen date does not convert.
 *
 * Null is returned rather than asserting: `validate` has already reported the
 * same problem by the time this is reachable, and a cast here would be a promise
 * the form could not keep.
 */
function toRequest(draft: Draft): ItemRegisterRequest | null {
  const category = draft.category.trim();
  const quantity = draft.quantity.trim();
  const location = draft.location.trim();
  const days = readDays(draft.durationDays);
  if ('problem' in days) return null;

  const expiry = draft.expiryMode === 'date' ? dateToUtcEpoch(draft.expiryDate) : 0;
  const manufacture = draft.manufactureMode === 'date' ? dateToUtcEpoch(draft.manufactureDate) : 0;
  if (expiry === null || manufacture === null) return null;

  return {
    uid: draft.uid.trim(),
    name: draft.name.trim(),
    // Conditional spreads, so an untouched field is ABSENT from the body rather
    // than present and empty. Blank means "the device applies its own default",
    // which is a different instruction from 0 ("no limit").
    ...(category === '' ? {} : { category }),
    ...(quantity === '' ? {} : { quantity }),
    ...(location === '' ? {} : { location }),
    ...(draft.durationDays.trim() === '' ? {} : { duration_days: days.days }),
    // Both epochs are ALWAYS present, because both are always an answer. 0 here is
    // the service's own vocabulary for "use the storage duration instead" and
    // "unknown" respectively — an omission would ask the device to guess.
    expiry_epoch: expiry,
    manufacture_epoch: manufacture,
  };
}

/** The service's 400 `details`, mapped onto the field each path names. */
function rejectedByService(error: ApiError): Problems {
  const out: Problems = {};
  for (const detail of error.details ?? []) {
    // A root-level issue (a body that is not an object, an unrecognised key) has
    // an empty path and belongs in the notice, not next to an input.
    if (detail.path === '') continue;
    const key = detail.path as FieldKey;
    if (key in FIELD_LABELS) out[key] = detail.message;
  }
  return out;
}

interface FailureView {
  /** `service` is the instrument-caution family; `admin` is a refused write. */
  readonly kind: 'service' | 'admin';
  readonly label: string;
  readonly title: string;
  readonly body: ReactNode;
}

/**
 * What the operator is told, per failure.
 *
 * The two 503s are separated because the facts differ, and neither may imply the
 * item is stored. Everything else keeps the service's own sentence: this function
 * adds the framing the service cannot know (whether this build had a token) and
 * never replaces a reason the service gave with one it did not.
 */
function describeFailure(error: ApiError, dev: string): FailureView {
  if (error.code === 'transport_unavailable') {
    return {
      kind: 'service',
      label: 'Not sent',
      title: 'The device command transport is not connected',
      body: (
        <>
          <p>
            The command never left the service, so <strong>nothing was registered</strong> on{' '}
            <span className="num">{dev}</span> and nothing needs undoing. This is the MQTT link down, not a fault in
            what you typed and not a verdict about any food.
          </p>
          <p>There is no queue behind this: a command that cannot be sent is lost, and the service does not retry it for you. Press register again once the transport is up.</p>
        </>
      ),
    };
  }

  if (error.code === 'command_unconfirmed') {
    return {
      kind: 'service',
      label: 'Delivery unknown',
      title: 'The broker did not confirm the command',
      body: (
        <>
          <p>
            The service handed the command to the broker and the broker did not acknowledge it, so it may or may not have
            reached the device. <strong>Nothing is shown as registered.</strong> If it did arrive, the row will appear in
            the table below on its own.
          </p>
          <p>Retrying is safe: the device re-registers the same UID, and the service revives that row rather than creating a second one.</p>
        </>
      ),
    };
  }

  if (error.status === 401) {
    // `postAdminJSON` has already composed this one: it is the only layer that
    // knows whether a token was sent, and the message says which of the two
    // problems this is.
    return {
      kind: 'admin',
      label: 'Not authorised',
      title: 'The service refused the write',
      body: <p>{error.message}</p>,
    };
  }

  if (error.isRateLimited) {
    return {
      kind: 'admin',
      label: 'Rate limited',
      title: 'The service is rate limiting writes',
      body: (
        <p>
          Nothing was registered and nothing was sent. This is the service refusing to answer this quickly, not a
          problem with the item — wait a few seconds and press register again.
        </p>
      ),
    };
  }

  if (error.code === 'network_unreachable') {
    return {
      kind: 'service',
      label: 'No answer',
      title: 'The dashboard could not reach the FreshGuard service',
      body: (
        <>
          <p>
            Whether the command reached the service is <strong>unknown</strong>, so nothing is shown as registered. If
            the item appears in the table below it was registered; if it does not, register it again — re-registering
            the same UID updates that row rather than creating a second one.
          </p>
          <p>{error.message}</p>
        </>
      ),
    };
  }

  if (error.status === 400) {
    const named = error.details ?? [];
    return {
      kind: 'admin',
      label: 'Rejected by the service',
      title: 'The service would not accept this registration',
      body: (
        <>
          <p>
            {named.length === 0
              ? error.message
              : 'The service named the fields it refused, and the reason is beside each one above.'}
          </p>
          {named.length === 0 ? null : (
            <ul className="notice__list">
              {named.map((detail) => (
                <li key={`${detail.path}:${detail.code}`}>
                  <strong>{detail.path === '' ? 'the request as a whole' : FIELD_LABELS[detail.path as FieldKey] ?? detail.path}</strong>{' '}
                  — {detail.message}
                </li>
              ))}
            </ul>
          )}
        </>
      ),
    };
  }

  return {
    kind: 'service',
    label: 'Save failed',
    title: 'The service reported a problem',
    body: (
      <>
        <p>Nothing is shown as registered. The service said: {error.message}</p>
        <p>This is not a verdict about the food — it is a fault in the request path, and the food monitoring on this page is unaffected.</p>
      </>
    ),
  };
}

export interface AddItemFormProps {
  readonly dev: string;
  /**
   * A command the service accepted for delivery. Not an item, and not a row.
   *
   * The request body comes back with it, and that is not a convenience. The
   * service resolves the command over minutes rather than milliseconds, so the
   * page is the thing that has to keep the body around to answer the operator's
   * next two questions — "what happened to it" and "send it again" — and the
   * only body that can be safely re-sent is the one the service accepted. Rebuilding
   * it from the form later would risk a retry carrying fields the operator has
   * since changed, which for a locked uid is a different command wearing the same
   * id.
   */
  readonly onDispatched: (response: ItemRegisterResponse, body: ItemRegisterRequest) => void;
  readonly onClose: () => void;
  /** Lets the page's "Register item" button point `aria-controls` at this panel. */
  readonly id?: string;
  /**
   * A uid to put in the field, arriving from outside the form.
   *
   * Set by the identify flow, for the case SRS L105-108 calls "retrieved or
   * updated" and for an id the service answered `unknown_uid` for. The point of
   * passing it rather than asking for it again is that the id came from a LABEL —
   * read by a camera or reported by the cabinet's reader — and retyping sixteen
   * hexadecimal characters is how an item ends up registered under an id that is
   * not the one in the person's hand. The form never re-derives it.
   */
  readonly prefillUid?: string | undefined;
  /**
   * Make the uid field read-only.
   *
   * Set together with `prefillUid`, and only then. `readOnly` rather than
   * `disabled` for three reasons: a disabled control is skipped by some screen
   * readers entirely, so the operator would not be told WHICH id is about to be
   * registered; it cannot be selected and copied, which is exactly what somebody
   * checking a label will want to do; and it drops the value out of the submitted
   * form. A read-only field is focusable, announced, copyable and submitted, so
   * the locked value is visible, verifiable and still sent.
   */
  readonly lockUid?: boolean | undefined;
}

export function AddItemForm({ dev, onDispatched, onClose, id, prefillUid, lockUid = false }: AddItemFormProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  /** The service's answer to the last submit. Kept until the next one. */
  const [transport, setTransport] = useState<ApiError | null>(null);
  /**
   * Field-scoped complaints from the service, kept apart from `transport` so that
   * editing a field can clear them while the notice above it stays. Clearing both
   * on every keystroke would take the 503 away from an operator who is still
   * reading it.
   */
  const [rejected, setRejected] = useState<Problems>({});
  /**
   * Whether the operator has tried to send this. Until they have, nothing is
   * flagged: a form that opens already shouting "Tag UID is required" and "Name
   * is required" is describing a fault that does not exist yet, and it teaches a
   * reader to ignore red text. Problems appear on the first attempt and are then
   * live, and the submit button is a real one rather than a permanently disabled
   * control, because a button that cannot be pressed cannot tell the operator
   * what is wrong with it.
   */
  const [attempted, setAttempted] = useState(false);

  const canWrite = hasAdminToken();
  const uidId = useId();
  const datalistId = useId();
  const noTokenId = useId();
  const lockedUidId = useId();

  /**
   * Adopt an id the identify flow found, whenever it changes.
   *
   * `attempted` is deliberately reset, so adopting a uid does not immediately
   * paint the rest of the form with problems the operator has not caused yet.
   * The uid itself is exempt from validation noise in the locked case below, and
   * that exemption is the whole point: a locked, service-originated uid is not a
   * thing a human can have got wrong.
   */
  useEffect(() => {
    if (prefillUid === undefined) return;
    setDraft((previous) => (previous.uid === prefillUid ? previous : { ...previous, uid: prefillUid }));
    setAttempted(false);
    setRejected({});
  }, [prefillUid]);

  const fields = useMemo(
    () => ({
      uid: `${uidId}-uid`,
      name: `${uidId}-name`,
      category: `${uidId}-category`,
      quantity: `${uidId}-quantity`,
      location: `${uidId}-location`,
      duration_days: `${uidId}-duration`,
      expiry_epoch: `${uidId}-expiry`,
      manufacture_epoch: `${uidId}-manufacture`,
    }),
    [uidId],
  );

  // The panel's own title id, so `aria-controls` from the page's toggle and the
  // heading a screen reader lands on are the same element.
  const titleId = `${uidId}-title`;

  // Refs rather than `querySelector('#' + id)`: `useId` returns a string
  // containing colons, which is a legal id and a fatal CSS selector, so the only
  // safe way to move focus to a named field is to hold the node.
  const nodes = useRef<Partial<Record<FieldKey, HTMLElement | null>>>({});
  const focusField = useCallback((key: FieldKey) => {
    nodes.current[key]?.focus();
  }, []);

  /**
   * Where the caret should land when this panel opens.
   *
   * The first EDITABLE field, not merely the first one. A locked uid came off a
   * label and is not going to be typed, so parking the caret there invites the
   * one thing the lock exists to prevent — typing over it — while skipping the
   * name field means the operator starts by tabbing past where they were going
   * to type anyway. An unlocked form starts on the uid, because typing an id is
   * what it was opened to do.
   */
  const firstEditable = lockUid ? 'name' : 'uid';

  /**
   * OPENING THE FORM MEANS BEING PUT IN FRONT OF IT.
   * ---------------------------------------------------------------------------
   * The form is opened by a button at the top of a long page, so without this the
   * operator presses "Register an item", nothing appears to happen, and the
   * panel they are now looking at is somewhere below the fold. Two separate
   * corrections, in this order:
   *
   *   1. Scroll the panel to the top of the viewport. `.panel` already carries
   *      `scroll-margin-block-start: 4.5rem` in `layout.css`, which is what leaves
   *      room for the 68px sticky header — without that margin the panel's own
   *      heading lands underneath the header and the operator is shown a form with
   *      its title hidden. Scrolling the element rather than the window is
   *      deliberate for the same reason: the header is `position: sticky`, so it
   *      occupies flow space only at the top, and scrolling the document would
   *      fight the layout for whatever else is in the flow.
   *   2. Focus the first editable field, so the next keystroke goes there rather
   *      than being dropped on the body — where it would be typed into nothing and
   *      would scroll the page back to the top on some browsers.
   *
   * `preventScroll` on the focus is what keeps the two from fighting. Browsers
   * scroll focused elements into view themselves, and a second scroll landing a
   * few pixels from the first is how a form ends up half-hidden under the header.
   *
   * REDUCED MOTION. `smooth` is skipped entirely when the reader has asked for
   * reduced motion, rather than being shortened: the movement here carries no
   * information, so the accessible version is the version that does not move.
   */
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (panel !== null) {
      const reduced =
        typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    }
    nodes.current[firstEditable]?.focus({ preventScroll: true });
    // Mount only. The panel is conditionally rendered by the page, so mounting IS
    // "the form was opened", and re-running on a prefill change would yank the
    // caret out of a field the operator was in the middle of typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The service's answer wins on any field it names, because it is the authority
  // and this file is a convenience. Two independently maintained views of the
  // schema are allowed to disagree; when they do, the service is the one the
  // operator is shown, which is how a dashboard built against an older backend
  // learns what the backend actually thinks.
  const detected = useMemo<Problems>(() => ({ ...validate(draft, lockUid), ...rejected }), [draft, lockUid, rejected]);
  const problems = attempted ? detected : EMPTY_PROBLEMS;
  const blocked = Object.keys(detected).length > 0;

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setRejected({});
  }, []);

  /**
   * Empty the form, keeping a locked uid.
   *
   * The uid is the one field a locked form must not lose: it is the value the
   * identify flow handed over, and clearing it would leave the operator staring
   * at a registration form with no id, which is the state the pre-fill exists to
   * avoid. Used by both the Clear control and the reset after a successful
   * dispatch, so those two can never disagree about what "reset" means.
   */
  const reset = useCallback(() => {
    setDraft(lockUid && prefillUid !== undefined ? { ...EMPTY_DRAFT, uid: prefillUid } : EMPTY_DRAFT);
    setAttempted(false);
    setRejected({});
  }, [lockUid, prefillUid]);

  const expiryEpoch = draft.expiryMode === 'date' ? dateToUtcEpoch(draft.expiryDate) : 0;
  const manufactureEpoch = draft.manufactureMode === 'date' ? dateToUtcEpoch(draft.manufactureDate) : 0;

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      // Guarded rather than relied upon: the button is `aria-disabled` (not
      // `disabled`, so it keeps its place in the tab order and can explain itself)
      // when this build has no credential, and the handler still runs.
      if (busy || !hasAdminToken()) return;

      setAttempted(true);
      const first = Object.keys(detected)[0] as FieldKey | undefined;
      if (first !== undefined) {
        focusField(first);
        return;
      }
      const body = toRequest(draft);
      if (body === null) return;

      setBusy(true);
      setTransport(null);
      setRejected({});
      try {
        const response = await registerItem(dev, body);
        // Reset, not "kept": the form is ready for the next item and there is no
        // half-filled state that could be submitted twice by accident — except the
        // locked uid, which `reset` deliberately carries over. The dispatch itself
        // is reported by the page, next to the table the item will eventually
        // appear in, together with the body that has to be kept to re-send it.
        reset();
        onDispatched(response, body);
      } catch (error) {
        const failure =
          error instanceof ApiError
            ? error
            : new ApiError({
                status: 0,
                code: 'unknown',
                message: error instanceof Error ? error.message : String(error),
              });
        setTransport(failure);
        setRejected(rejectedByService(failure));
      } finally {
        setBusy(false);
      }
    },
    [busy, dev, detected, draft, focusField, onDispatched, reset],
  );

  const failure = transport === null ? null : describeFailure(transport, dev);

  return (
    <section className="panel" ref={panelRef} aria-labelledby={titleId} {...(id === undefined ? {} : { id })}>
      <div className="panel__head">
        <h2 className="panel__title" id={titleId}>
          Register an item
        </h2>
        <p className="panel__sub">
          Sends a command to <span className="num">{dev}</span>. The device decides whether to keep it.
        </p>
        <div className="panel__tools">
          <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>

      <div className="panel__body">
        <p className="note">
          <strong>This does not put the item in the cabinet.</strong> It asks the device to register a UID, and the
          device answers by reporting the item in a later snapshot. The table below gains the row on its own, from the
          live feed — nothing is added here the moment you press the button.
        </p>

        {!canWrite ? (
          <div className="notice" data-tone="admin" id={noTokenId} role="note">
            <Mark shape="circle" className="mark--lg" />
            <div>
              <p className="notice__kind">This build cannot register items</p>
              <p className="notice__title">No admin token is configured</p>
              <div className="notice__body">
                <p>
                  Registering an item is an administrator route, and the service answers <span className="num">401</span>{' '}
                  without a credential. This dashboard was built without{' '}
                  <code className="num">VITE_ADMIN_TOKEN</code>, so the button below is disabled rather than letting
                  you find out by getting a refusal after filling the form in.
                </p>
                <p>
                  Set it in the dashboard environment and reload. Everything else on this page — the readings, the item
                  list, the live feed — works without it.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} noValidate>
          <div className="fields">
            <Field
              id={fields.uid}
              label={FIELD_LABELS.uid}
              problem={lockUid ? undefined : problems.uid}
              required
              hint={
                lockUid
                  ? 'Locked. This is the exact id that was identified, carried over from the label rather than retyped, so it cannot be mistyped into a different item. Clear the form to enter a different one by hand.'
                  : 'Hexadecimal, the way the reader printed it. Sent exactly as typed: neither the case nor a missing separator is corrected for you, because guessing would register the item under a UID the device does not hold.'
              }
              input={
                <input
                  id={fields.uid}
                  ref={(node) => {
                    nodes.current.uid = node;
                  }}
                  className="field__input"
                  type="text"
                  value={draft.uid}
                  onChange={(event) => update({ uid: event.target.value })}
                  placeholder="04A31B2C"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  enterKeyHint="next"
                  aria-required="true"
                  readOnly={lockUid}
                  aria-readonly={lockUid ? true : undefined}
                  aria-describedby={
                    lockUid
                      ? `${fields.uid}-hint ${lockedUidId}`
                      : `${fields.uid}-hint${problems.uid === undefined ? '' : ` ${fields.uid}-problem`}`
                  }
                />
              }
            />

            {lockUid ? (
              <p className="field__hint" id={lockedUidId}>
                Locked to the unique id that was identified, carried over from the label. It is read-only rather than
                disabled so it can be read aloud and selected for checking, and it is still sent with the command.
              </p>
            ) : null}

            <Field
              id={fields.name}
              label={FIELD_LABELS.name}
              problem={problems.name}
              required
              hint={`What the item is called in the inventory. Up to ${ITEM_FIELD_CAPS.name} characters.`}
              input={
                <input
                  id={fields.name}
                  ref={(node) => {
                    nodes.current.name = node;
                  }}
                  className="field__input"
                  type="text"
                  value={draft.name}
                  onChange={(event) => update({ name: event.target.value })}
                  placeholder="Milk"
                  autoComplete="off"
                  aria-required="true"
                  aria-invalid={problems.name === undefined ? undefined : true}
                  aria-describedby={`${fields.name}-hint${problems.name === undefined ? '' : ` ${fields.name}-problem`}`}
                />
              }
            />
          </div>

          <div className="fields">
            <Field
              id={fields.category}
              label={FIELD_LABELS.category}
              problem={problems.category}
              hint={`Suggested, not required — type anything the storeroom calls it. Up to ${ITEM_FIELD_CAPS.category} characters.`}
              input={
                <>
                  <input
                    id={fields.category}
                    ref={(node) => {
                      nodes.current.category = node;
                    }}
                    className="field__input"
                    type="text"
                    list={datalistId}
                    value={draft.category}
                    onChange={(event) => update({ category: event.target.value })}
                    autoComplete="off"
                    aria-invalid={problems.category === undefined ? undefined : true}
                    aria-describedby={`${fields.category}-hint${problems.category === undefined ? '' : ` ${fields.category}-problem`}`}
                  />
                  <datalist id={datalistId}>
                    {CATEGORIES.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </>
              }
            />

            <Field
              id={fields.quantity}
              label={FIELD_LABELS.quantity}
              problem={problems.quantity}
              hint={`How much, in whatever unit makes sense here. Up to ${ITEM_FIELD_CAPS.quantity} characters.`}
              input={
                <input
                  id={fields.quantity}
                  ref={(node) => {
                    nodes.current.quantity = node;
                  }}
                  className="field__input"
                  type="text"
                  value={draft.quantity}
                  onChange={(event) => update({ quantity: event.target.value })}
                  placeholder="2 x 250 g"
                  autoComplete="off"
                  aria-invalid={problems.quantity === undefined ? undefined : true}
                  aria-describedby={`${fields.quantity}-hint${problems.quantity === undefined ? '' : ` ${fields.quantity}-problem`}`}
                />
              }
            />

            <Field
              id={fields.location}
              label={FIELD_LABELS.location}
              problem={problems.location}
              hint={`Which part of the cabinet, if it matters. Up to ${ITEM_FIELD_CAPS.location} characters.`}
              input={
                <input
                  id={fields.location}
                  ref={(node) => {
                    nodes.current.location = node;
                  }}
                  className="field__input"
                  type="text"
                  value={draft.location}
                  onChange={(event) => update({ location: event.target.value })}
                  placeholder="Top shelf"
                  autoComplete="off"
                  aria-invalid={problems.location === undefined ? undefined : true}
                  aria-describedby={`${fields.location}-hint${problems.location === undefined ? '' : ` ${fields.location}-problem`}`}
                />
              }
            />
          </div>

          <div className="fields">
            <Field
              id={fields.duration_days}
              label={FIELD_LABELS.duration_days}
              unit="days"
              problem={problems.duration_days}
              hint={`How long the device should treat it as good for, counted from the store date IT stamps. 0 means no limit; leaving it blank leaves the choice to the device.`}
              input={
                <input
                  id={fields.duration_days}
                  ref={(node) => {
                    nodes.current.duration_days = node;
                  }}
                  className="field__input"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={0}
                  max={MAX_DURATION_DAYS}
                  value={draft.durationDays}
                  onChange={(event) => update({ durationDays: event.target.value })}
                  placeholder="7"
                  aria-invalid={problems.duration_days === undefined ? undefined : true}
                  aria-describedby={`${fields.duration_days}-hint${problems.duration_days === undefined ? '' : ` ${fields.duration_days}-problem`}`}
                />
              }
            />

            <div className="field">
              <span className="field__label" id={`${fields.expiry_epoch}-label`}>
                Expiry
              </span>
              <div className="chip-group" role="group" aria-labelledby={`${fields.expiry_epoch}-label`}>
                <button
                  type="button"
                  className="chip chip--plain"
                  aria-pressed={draft.expiryMode === 'duration'}
                  onClick={() => update({ expiryMode: 'duration' })}
                >
                  Use the storage duration
                </button>
                <button
                  type="button"
                  className="chip chip--plain"
                  aria-pressed={draft.expiryMode === 'date'}
                  onClick={() => update({ expiryMode: 'date' })}
                >
                  On a date
                </button>
              </div>
              {draft.expiryMode === 'date' ? (
                <input
                  id={fields.expiry_epoch}
                  ref={(node) => {
                    nodes.current.expiry_epoch = node;
                  }}
                  className="field__input"
                  type="date"
                  min="1970-01-01"
                  max="2100-01-01"
                  value={draft.expiryDate}
                  onChange={(event) => update({ expiryDate: event.target.value })}
                  aria-label="Expiry date"
                  aria-invalid={problems.expiry_epoch === undefined ? undefined : true}
                  aria-describedby={`${fields.expiry_epoch}-hint${problems.expiry_epoch === undefined ? '' : ` ${fields.expiry_epoch}-problem`}`}
                />
              ) : null}
              <p className="field__hint" id={`${fields.expiry_epoch}-hint`}>
                {draft.expiryMode === 'duration'
                  ? 'Sent as 0, which the device reads as "use the storage duration instead". Choose a date instead if this item has a printed expiry.'
                  : expiryEpoch === null
                    ? 'Enter a date. It is sent as Unix seconds at 00:00 UTC on that day — not local midnight, which would shift it by your own UTC offset.'
                    : `Sent as Unix seconds at 00:00 UTC on that day: ${asUtcStamp(expiryEpoch)} (epoch ${expiryEpoch}).`}
              </p>
              {problems.expiry_epoch === undefined ? null : (
                <p className="field__hint" id={`${fields.expiry_epoch}-problem`}>
                  {problems.expiry_epoch}
                </p>
              )}
            </div>

            <div className="field">
              <span className="field__label" id={`${fields.manufacture_epoch}-label`}>
                Date of manufacture
              </span>
              <div className="chip-group" role="group" aria-labelledby={`${fields.manufacture_epoch}-label`}>
                <button
                  type="button"
                  className="chip chip--plain"
                  aria-pressed={draft.manufactureMode === 'unknown'}
                  onClick={() => update({ manufactureMode: 'unknown' })}
                >
                  Unknown
                </button>
                <button
                  type="button"
                  className="chip chip--plain"
                  aria-pressed={draft.manufactureMode === 'date'}
                  onClick={() => update({ manufactureMode: 'date' })}
                >
                  On a date
                </button>
              </div>
              {draft.manufactureMode === 'date' ? (
                <input
                  id={fields.manufacture_epoch}
                  ref={(node) => {
                    nodes.current.manufacture_epoch = node;
                  }}
                  className="field__input"
                  type="date"
                  min="1970-01-01"
                  max="2100-01-01"
                  value={draft.manufactureDate}
                  onChange={(event) => update({ manufactureDate: event.target.value })}
                  aria-label="Date of manufacture"
                  aria-invalid={problems.manufacture_epoch === undefined ? undefined : true}
                  aria-describedby={`${fields.manufacture_epoch}-hint${problems.manufacture_epoch === undefined ? '' : ` ${fields.manufacture_epoch}-problem`}`}
                />
              ) : null}
              <p className="field__hint" id={`${fields.manufacture_epoch}-hint`}>
                {draft.manufactureMode === 'unknown'
                  ? 'Sent as 0, which means unknown. That is a real answer, not a missing one — an item you did not buy yourself often has no readable date.'
                  : manufactureEpoch === null
                    ? 'Enter a date. It is sent as Unix seconds at 00:00 UTC on that day — not local midnight, which would shift it by your own UTC offset.'
                    : `Sent as Unix seconds at 00:00 UTC on that day: ${asUtcStamp(manufactureEpoch)} (epoch ${manufactureEpoch}).`}
              </p>
              {problems.manufacture_epoch === undefined ? null : (
                <p className="field__hint" id={`${fields.manufacture_epoch}-problem`}>
                  {problems.manufacture_epoch}
                </p>
              )}
            </div>
          </div>

          {blocked ? (
            <div className="notice" data-tone="admin">
              <Mark shape="circle" className="mark--lg" />
              <div>
                <p className="notice__kind">Not sent yet</p>
                <p className="notice__title">This cannot be registered until the following is fixed</p>
                <ul className="notice__body notice__list">
                  {(Object.keys(problems) as FieldKey[]).map((key) => (
                    <li key={key}>
                      <strong>{FIELD_LABELS[key]}</strong> — {problems[key]}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {failure === null ? null : (
            <div className="notice" data-kind={failure.kind} role="alert">
              {/* A plain diamond: the shape no verdict uses, which is the whole
                  point of the `service` treatment — a dead broker must never wear
                  the mark that means "throw this food out". */}
              <Mark shape="diamond" className="mark--lg" />
              <div>
                <p className="notice__kind">{failure.label}</p>
                <p className="notice__title">{failure.title}</p>
                <div className="notice__body">
                  {failure.body}
                  <span className="notice__meta">
                    service code {transport?.code}
                    {transport !== null && transport.status > 0 ? ` · HTTP ${transport.status}` : ''}
                    {transport?.requestId != null ? ` · request ${transport.requestId}` : ''}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="panel__tools">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              aria-disabled={busy || !canWrite}
              aria-describedby={canWrite ? undefined : noTokenId}
            >
              {busy ? 'Dispatching…' : 'Register item'}
            </button>
            {/* With a locked uid there is nothing for a Clear control to do that
                does not destroy the one value this form was opened for, so the
                button is not rendered at all. The head's Close remains, and the
                page opens a fresh unlocked form for a different item. */}
            {lockUid ? (
              <p className="field__hint">
                The unique id is locked to the one that was identified. Close this form to register a different item.
              </p>
            ) : (
              <button type="button" className="btn btn--quiet" onClick={reset} disabled={busy}>
                Clear the form
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="panel__foot">
        <p className="hint">
          Registering the same UID again is safe: the device re-registers it and the service revives that row rather
          than creating a second one. That is what makes a retry after an uncertain delivery the correct response
          rather than a risk of duplicates.
        </p>
      </div>
    </section>
  );
}

/**
 * One labelled control with its hint and, when it has one, its problem.
 *
 * The problem is a second `.field__hint` rather than a new class: the vocabulary
 * this form reuses is fixed, and a validation sentence that reads as an
 * instruction ("Remove any “:” separators") does not need a colour to be
 * understood — it is named in the `aria-describedby` chain and repeated in the
 * summary notice above, so it is announced whether or not the operator can see
 * a style difference.
 */
function Field({
  id,
  label,
  unit,
  hint,
  problem,
  required = false,
  input,
}: {
  readonly id: string;
  readonly label: string;
  readonly unit?: string | undefined;
  readonly hint: string;
  /** Explicitly `| undefined` because this project sets exactOptionalPropertyTypes. */
  readonly problem?: string | undefined;
  readonly required?: boolean;
  readonly input: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label} {required ? <span className="field__unit">(required)</span> : null}
        {unit === undefined ? null : <span className="field__unit"> ({unit})</span>}
      </label>
      {input}
      <p className="field__hint" id={`${id}-hint`}>
        {hint}
      </p>
      {problem === undefined ? null : (
        <p className="field__hint" id={`${id}-problem`}>
          {problem}
        </p>
      )}
    </div>
  );
}
