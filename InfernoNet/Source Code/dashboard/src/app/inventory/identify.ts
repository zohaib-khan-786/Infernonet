/**
 * Identifying a food item from its unique id. The whole decision surface.
 *
 * SRS GROUNDING, BECAUSE THE FOUR OUTCOMES ARE AN ARGUMENT AND NOT A LIST
 * -----------------------------------------------------------------------------
 *   L105-108 / L157 / L305-308  Identification is MANDATORY, and it is mandatory
 *       through a unique identification ID on a label — a QR-code sticker
 *       "containing or linking details such as the food name, date of
 *       manufacture, expiry date, and a unique identification ID", so that
 *       scanning it lets the item be "identified and its details to be
 *       retrieved or updated".
 *   L542  "The system may include recipe suggestions, QR or RFID tracking…"
 *       RFID is therefore OPTIONAL, and so is the reader that produces the uid.
 *
 * So the uid is the contract and the reader is only one way to obtain it. A
 * camera reading a printed code, a reader presenting a tag, and a human typing
 * what is printed on the label are three sources of the SAME string, and they all
 * end up in `classifyLookup`. Nothing in this file — or in any file that uses it —
 * is named after a reader, and no `rfid`, `tag`, `scan` or `qr` appears in a
 * route, a response key or a failure code. The backend asserts that, and so does
 * this file's contract with it.
 *
 * WHY THIS IS A MODULE WITH NO REACT IN IT
 * -----------------------------------------------------------------------------
 * Everything a caller needs to get wrong is in here: which of the four answers
 * the service gave, which treatment that answer earns, what a label is allowed
 * to be believed to contain, and what the screen reader is told. A mapping is
 * the easiest thing in a codebase to get quietly wrong by hand-editing a JSX
 * ternary, and a flow whose branches are scattered across a component and a
 * fetch wrapper will drift from its own documentation within one release. Kept
 * pure, it is one screen, it imports nothing from React, and every rule below can
 * be read and checked without rendering anything.
 *
 * THE FOUR RULES THIS FILE ENFORCES
 * -----------------------------------------------------------------------------
 *   1. A VERDICT IS NEVER INVENTED. `found` carries the item the service sent
 *      and nothing else. There is no arithmetic, no threshold and no "probably
 *      means" here, and `freshness` is rendered from the engine's own words.
 *   2. A LABEL IS NOT A SOURCE OF FACTS. SRS L105-108 says the sticker may
 *      "contain" details as well as link to them, so a payload can arrive
 *      carrying a name and a date. `extractUidCandidate` reads the uid out of it
 *      and DISCARDS the rest. A name printed on a label is a claim by whoever
 *      printed it, and showing it beside a server-verified item would put an
 *      unverified claim inside a verified record. So the panel says what the
 *      label said, separately, and the item is only ever the server's.
 *   3. AN UNRECOGNISED CODE IS NOT "NOT FOUND". Branch on the code, never on the
 *      prose, and a code this build has never seen becomes a service failure
 *      rather than a claim that an item is missing.
 *   4. A RETIRED ID IS NOT A MISSING ID. They are different answers to the same
 *      question and only the 404/409 split tells them apart.
 */
import type { ApiError, ApiErrorContext } from '../../api/client';
import type { EventType, InventoryItem } from '../../api/types';
import type { Shape, Tone } from '../../lib/status';

// ---------------------------------------------------------------------------
// The wire vocabulary
// ---------------------------------------------------------------------------

/**
 * The one event type that means "a label was presented to the cabinet's reader".
 *
 * This is the FIRMWARE's word, quoted because it is the string on the wire —
 * `EVENT_TYPES` in `backend/src/ingest/contract.js` closes over it and the
 * service stores it verbatim. Matching it is consuming a foreign vocabulary, not
 * inventing one: nothing here is named after it, and the dashboard never puts it
 * in a route, a response key or a lookup failure code. (The one place it leaks
 * into a user-facing string is the event log, which shows every type's raw token
 * by design — see the note on `src/lib/events.ts`.)
 *
 * Typed as `EventType` — the service's enum, mirrored in `api/types.ts` — so this
 * token and that list cannot drift apart. A rename or a removal on either side is
 * a compile error here rather than a reader panel that silently stops matching.
 */
export const READER_OBSERVATION_EVENT: EventType = 'rfid_scanned';

/**
 * What a FreshGuard id IS, in the words the service uses.
 *
 * Quoted from `read/routes.js` so the malformed-answer screen and the manual
 * entry hint say exactly what the service will accept, rather than a paraphrase
 * that might be slightly wrong about the bound.
 */
export const ID_SHAPE_RULE = '1 to 64 hexadecimal characters (the digits 0-9 and the letters A-F), with nothing else in between';

// ---------------------------------------------------------------------------
// Where a uid came from
// ---------------------------------------------------------------------------

/**
 * The three ways a uid reaches this page. Named for what the operator did, not
 * for what device produced it — a reader is optional (L542) and a camera is not.
 */
export type IdentifyOrigin = 'camera' | 'typed' | 'device';

const ORIGIN: Readonly<Record<IdentifyOrigin, string>> = {
  camera: 'read from the label with this device’s camera',
  typed: 'typed or pasted by hand',
  device: 'reported by the cabinet’s own reader',
};

/** "Identified as 1778F106, read from the label with this device's camera." */
export function originSentence(origin: IdentifyOrigin): string {
  return ORIGIN[origin];
}

/**
 * One identification attempt: the exact string that will be sent, and how it was
 * obtained. `uid` is sent VERBATIM — see `extractUidCandidate` for why nothing
 * here is normalised.
 */
export interface IdentifyRequest {
  readonly uid: string;
  readonly origin: IdentifyOrigin;
  /**
   * The whole text the camera decoded, kept only so the panel can show what the
   * label said and say plainly that only the id was taken from it. It is never
   * parsed again and never rendered as a value belonging to the item.
   */
  readonly labelText?: string;
}

// ---------------------------------------------------------------------------
// Reading a label
// ---------------------------------------------------------------------------

/** Which shape of label the id was taken from. Presentation only. */
export type LabelForm = 'bare' | 'json' | 'url-path' | 'url-query';

const LABEL_FORM: Readonly<Record<LabelForm, string>> = {
  bare: 'the id on its own',
  json: 'a label carrying a JSON object, of which only the id was read',
  'url-path': 'the last segment of a link on the label',
  'url-query': 'the id in the link on the label',
};

export function labelFormSentence(form: LabelForm): string {
  return LABEL_FORM[form];
}

export type UidExtraction =
  | { readonly kind: 'uid'; readonly uid: string; readonly form: LabelForm }
  | { readonly kind: 'none'; readonly reason: NoUidReason };

/** Why no id could be taken from a label. Each one has a different fix. */
export type NoUidReason = 'empty' | 'not-json' | 'no-id-field' | 'empty-link';

/**
 * Pull the unique id out of whatever a label carries, and nothing else.
 *
 * SRS L105-108 allows the sticker to either CONTAIN the details or LINK to
 * them, so this accepts the three shapes a printed label realistically takes:
 *
 *   bare      `1778F106` — the id and nothing else.
 *   json      `{"uid":"1778F106","name":"Milk", …}` — the "contains" form. ONLY
 *             the id is lifted out. The name, the dates and everything else the
 *             label carries are dropped on the floor, because they are claims by
 *             whoever printed the sticker and this dashboard does not show an
 *             unverified claim inside a verified record.
 *   url       `https://…/i/1778F106` or `…?uid=1778F106` — the "linking" form,
 *             which is the one that lets details be UPDATED without reprinting
 *             labels, because the printed thing is an id and the details live on
 *             the service.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * -----------------------------------------------------------------------------
 * It does not change case, strip separators, upper-case, trim inner whitespace
 * or otherwise "help". The service's uid column is compared with a plain
 * case-sensitive match, and a value that is silently rewritten into a different
 * one would look up a different item than the label names — or, worse, report
 * `unknown_uid` about a label that is perfectly correct. The old RFID panel
 * promised "separators are ignored; case does not matter" while matching
 * case-insensitively against a locally-held list; that promise was true of the
 * client and false of the service, and the difference is exactly the kind of gap
 * that ships a feature that works on the author's machine.
 *
 * So: whatever comes out of here is what goes on the wire, and if the service
 * rejects it the operator is told what the rule is and what was sent.
 */
export function extractUidCandidate(raw: string): UidExtraction {
  const text = raw.trim();
  if (text === '') return { kind: 'none', reason: 'empty' };

  if (text.startsWith('{') || text.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: 'none', reason: 'not-json' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { kind: 'none', reason: 'not-json' };
    }
    const field = (parsed as { readonly uid?: unknown }).uid;
    if (typeof field !== 'string' || field.trim() === '') return { kind: 'none', reason: 'no-id-field' };
    return { kind: 'uid', uid: field.trim(), form: 'json' };
  }

  // `new URL` needs a scheme, and a protocol-relative link (`//host/path`) is
  // a real thing to find on a printed label, so it is given one to parse with.
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith('//');
  if (looksLikeUrl) {
    let url: URL;
    try {
      url = new URL(looksLikeUrl ? text : `https:${text}`);
    } catch {
      return { kind: 'none', reason: 'empty-link' };
    }
    const param = url.searchParams.get('uid') ?? url.searchParams.get('id');
    if (param !== null && param.trim() !== '') return { kind: 'uid', uid: param.trim(), form: 'url-query' };
    const segments = url.pathname.split('/').filter((segment) => segment !== '');
    const last = segments[segments.length - 1];
    if (last === undefined || last.trim() === '') return { kind: 'none', reason: 'empty-link' };
    return { kind: 'uid', uid: last, form: 'url-path' };
  }

  return { kind: 'uid', uid: text, form: 'bare' };
}

/** Why no id could be taken from a label, in a sentence a person can act on. */
export function extractionProblem(reason: NoUidReason): string {
  switch (reason) {
    case 'empty':
      return 'The label decoded to nothing at all.';
    case 'not-json':
      return 'The label looked like a JSON object but could not be read as one, so no id was taken from it.';
    case 'no-id-field':
      return `The label is a JSON object, but it has no "uid" field, so there is nothing to look up. A FreshGuard id is ${ID_SHAPE_RULE}.`;
    case 'empty-link':
      return 'The label is a link, but it carries no id in its query string and none in its last path segment, so there is nothing to look up.';
  }
}

// ---------------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------------

/**
 * Why a lookup did not produce an answer about the label.
 *
 * `no-such-device` is separated from the rest because the service DID answer it:
 * a 404 saying the cabinet is not known is a different fact from a request that
 * never completed, and the two want different sentences. Folding them together
 * would have produced "the service did not answer" beside a 404 that says
 * otherwise, which is the kind of small untruth this dashboard is not for.
 */
export type UnavailableReason = 'no-such-device' | 'no-answer' | 'rate-limited' | 'unknown-code';

/**
 * What an identification attempt produced. Exactly one of these, always.
 *
 * `found` carries the item and nothing else — no summary, no "shorter" shape, so
 * there is no way for a caller to render something the service did not send.
 */
export type IdentifyOutcome =
  | { readonly kind: 'found'; readonly request: IdentifyRequest; readonly item: InventoryItem }
  | {
      readonly kind: 'retired';
      readonly request: IdentifyRequest;
      /**
       * The service's `retired_at`, from `error.context` where the service sent
       * it. `null` when neither the context nor the message states one — never a
       * guess. See `readRetirement`.
       */
      readonly retiredAt: string | null;
      readonly retiredAtRevision: number | null;
      /** The service's own `error.code`, shown verbatim. */
      readonly code: string;
      readonly message: string;
    }
  | { readonly kind: 'unknown'; readonly request: IdentifyRequest; readonly code: string; readonly message: string }
  | { readonly kind: 'malformed'; readonly request: IdentifyRequest; readonly code: string; readonly message: string }
  | {
      readonly kind: 'unavailable';
      readonly request: IdentifyRequest;
      readonly reason: UnavailableReason;
      readonly code: string;
      readonly message: string;
    };

/**
 * The two `uid_retired` facts this screen shows, and nothing else.
 *
 * `null` in a field means "not stated", which the panel renders as an explicit
 * absence. Nothing here can invent a date: a value only reaches this type if the
 * service sent it, in a field the service documented.
 */
export interface RetirementFacts {
  readonly at: string | null;
  readonly revision: number | null;
}

/**
 * Read the `uid_retired` context — the PRIMARY path.
 *
 * `read/service.js` attaches `{ uid, retired: true, retired_at,
 * retired_at_revision }` to the 409 precisely so a caller does not have to parse
 * its own prose to learn when an id was withdrawn, and `api/client.ts` now
 * carries `error.context` through untouched. So the two values the panel prints
 * are read here, from the machine-readable field the service deliberately sends.
 *
 * This NARROWS, it does not reshape. What is on `error.context` stays exactly
 * what the service put there; this function only asks whether two named fields
 * are present and of the type the service documents, and reads no others. A
 * context that is absent, or that is from a service whose `uid_retired` has
 * changed shape, yields `null` and the fallback below decides — which is the
 * right way round: a service that changed its context is still a service whose
 * message the screen can show, and a service whose prose changed is not
 * something a regex can rescue.
 *
 * `retired_at` is NOT re-parsed or checked for being a real instant. That check
 * exists on the fallback path because there it is scraping arbitrary words; a
 * machine-readable timestamp is either the service's value or it is not there,
 * and re-validating it here would reintroduce the exact failure this fix removes
 * — a value the service sent being discarded because this build did not like its
 * shape. `dateTime()` already renders an unparseable string as an explicit `-`.
 */
function retirementFromContext(context: ApiErrorContext | null): RetirementFacts | null {
  if (context === null) return null;
  const { retired_at: at, retired_at_revision: revision } = context;
  if (typeof at !== 'string' || at === '') return null;
  return {
    at,
    // Nullable on the wire by the service's own definition, and absent on a
    // service that does not send it. Both are "not stated"; neither is a zero.
    revision: typeof revision === 'number' ? revision : null,
  };
}

/**
 * When a retired id was withdrawn: the service's `error.context` first, and only
 * then the service's own sentence.
 *
 * WHY THE REGEX IS A FALLBACK AND NOT THE PRIMARY PATH
 * -----------------------------------------------------------------------------
 * It is not the primary path because the information is available in a form
 * built for reading. `read/service.js` sends `context.retired_at` and
 * `context.retired_at_revision`; the HTTP client now carries that object
 * through; so the timestamp is a field, and reading a field cannot break because
 * somebody reworded a sentence. A regex is a bet on prose: the moment the
 * service phrases the message differently the pattern stops matching, and the
 * honest outcome of that is "not stated", never a plausible-looking fragment.
 *
 * It is KEPT because the cost of having no second path is a real regression and
 * the cost of keeping this one is nothing. A service older than the
 * `error.context` field sends no context, and a dashboard with only the
 * machine-readable path would show "the service did not state when" beside a
 * message that states it in plain sight. So: context first, and only a context
 * that is absent or does not carry the field falls through to the message.
 *
 * The pattern is deliberately hard to get wrong, because it is the thing that
 * could be wrong:
 *
 *   - it requires a full ISO-8601 instant, not "whatever is next after the word
 *     at", so a differently-worded message yields `null` rather than a fragment;
 *   - the candidate is then run through `Date.parse` and dropped unless it is a
 *     real instant, so a malformed string cannot be rendered as a date;
 *   - the revision is a digit run and nothing else.
 */
export function readRetirement(context: ApiErrorContext | null, message: string): RetirementFacts {
  const fromContext = retirementFromContext(context);
  if (fromContext !== null) return fromContext;

  const at = /retired at\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i.exec(message)?.[1] ?? null;
  const revision = /inventory revision\s+(\d+)/i.exec(message)?.[1] ?? null;
  return {
    at: at !== null && Number.isFinite(Date.parse(at)) ? at : null,
    revision: revision === null ? null : Number.parseInt(revision, 10),
  };
}

/**
 * Turn a failed lookup into exactly one outcome.
 *
 * THE ORDER BELOW IS THE DECISION, AND IT IS NOT ARBITRARY
 * -----------------------------------------------------------------------------
 *   400 bad_request      first, before the device is even looked up. A value that
 *                        is not a uid is the caller's problem and must never be
 *                        dressed up as "not found" — the backend's own comment on
 *                        this route says the two failures have different causes
 *                        and different fixes.
 *   409 uid_retired      before the 404s, because a withdrawn id is neither a
 *                        usable item nor one that was never registered.
 *   404 unknown_uid      the only 404 that means "this id is not registered".
 *   404 unknown_device   ALSO a 404, and a different problem with a different
 *                        fix: the cabinet is not known at all. Branching on the
 *                        status alone would tell an operator to go and register
 *                        a label on a cabinet that does not exist.
 *   0  / 429 / anything else
 *                        a service failure, and NOT a claim about the label.
 *                        Most importantly, a code this build has never seen lands
 *                        here rather than in `unknown`: an unrecognised answer is
 *                        not evidence that an item is missing.
 */
export function classifyLookupFailure(request: IdentifyRequest, error: ApiError): IdentifyOutcome {
  // 400 first, and before anything else matters. A value that is not a uid is
  // the caller's problem, and the backend checks it before it even looks the
  // device up — so a malformed label can never be reported as "not found".
  if (error.code === 'bad_request' || error.status === 400) {
    return { kind: 'malformed', request, code: error.code, message: error.message };
  }

  // 409 before the 404s: a withdrawn id is neither a usable item nor one that
  // was never registered, and only the 404/409 split tells those two apart.
  //
  // Branched on `code` and not on status or prose, which is what keeps this
  // answer distinct from `unknown_uid` (also a "this id is not in service"
  // story, but a 404 meaning it was NEVER registered) and from `bad_request`
  // (a 400 meaning no lookup was made at all). The `code` travels out on the
  // outcome and the panel prints it, so the distinction is visible to the
  // operator and not only to this function.
  if (error.code === 'uid_retired') {
    // `context` first, the message only if it carries no context. Both nulls
    // mean "not stated", and the panel shows the service's sentence either way.
    const retirement = readRetirement(error.context, error.message);
    return {
      kind: 'retired',
      request,
      retiredAt: retirement.at,
      retiredAtRevision: retirement.revision,
      code: error.code,
      message: error.message,
    };
  }

  if (error.code === 'unknown_uid') {
    return { kind: 'unknown', request, code: error.code, message: error.message };
  }

  // Also a 404, and a different problem with a different fix: the cabinet is not
  // known at all. Branching on the status alone would send an operator off to
  // register a label on a cabinet that does not exist.
  if (error.code === 'unknown_device') {
    return { kind: 'unavailable', request, reason: 'no-such-device', code: error.code, message: error.message };
  }

  if (error.isRateLimited) {
    return { kind: 'unavailable', request, reason: 'rate-limited', code: error.code, message: error.message };
  }

  if (error.isNetwork) {
    return { kind: 'unavailable', request, reason: 'no-answer', code: error.code, message: error.message };
  }

  // Everything else, INCLUDING a code this build has never seen, is a service
  // failure and not a claim about the label. This is the important one: an
  // unrecognised answer is not evidence that an item is missing, and a
  // dashboard that answered "not found" here would be telling a volunteer that
  // food is unregistered on the strength of a vocabulary mismatch.
  return { kind: 'unavailable', request, reason: 'unknown-code', code: error.code, message: error.message };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export interface IdentifyPresentation {
  readonly tone: Tone;
  readonly shape: Shape;
  /** The eyebrow: what kind of answer this is, before any detail. */
  readonly kind: string;
  readonly title: string;
  /**
   * The one sentence sent to the live region.
   *
   * Short on purpose. The outcome block below it carries the full explanation,
   * the id, the service's code and whatever else belongs there; a live region
   * that reads all of that out would talk over a screen-reader user instead of
   * telling them what happened.
   */
  readonly live: string;
  /**
   * True for anything that is a SERVICE failure rather than a statement about
   * the label or the item.
   *
   * The caller keys `data-kind="service"` off this rather than a tone, because
   * this codebase does not paint a failed request in a verdict colour: a red
   * square on this page would be the `check_food` annunciator, and nothing about
   * an HTTP 429 is a judgement about any food in the cabinet.
   */
  readonly serviceFailure: boolean;
  /** Whether offering to register this id makes sense. */
  readonly offersRegistration: boolean;
  /** Whether offering to update the found item makes sense (SRS: "or updated"). */
  readonly offersUpdate: boolean;
}

/**
 * The treatment one outcome earns.
 *
 * `found` is deliberately NEUTRAL and wears a plain circle, even though it is
 * the good news. "The service found the item you asked for" is not a statement
 * about the food, and painting the identification itself green would put a
 * verdict colour on a lookup. The item's actual verdict arrives separately,
 * carrying its own tone and its own shape, from the engine's own word — the two
 * are never merged into one signal.
 *
 * `retired` takes the administrative slate and a plain diamond: the id is out of
 * service, which is an administrative state. It is emphatically NOT `crit`
 * (which means throw this food out) and NOT `unknown` (which means nobody could
 * tell) — an item withdrawn from the registry has a definite, boring, answerable
 * status and the screen says so in those terms.
 *
 * `malformed` shares that family, which is right: it is a refusal of the
 * request rather than a fact about any food, and the two are the only outcomes
 * here that are about the input.
 */
export function identifyPresentation(outcome: IdentifyOutcome): IdentifyPresentation {
  switch (outcome.kind) {
    case 'found':
      return {
        tone: 'neutral',
        shape: 'circle',
        kind: 'Identified',
        title: outcome.item.name,
        live: `Identified. ${outcome.item.name}. The service's verdict for this item is shown below.`,
        serviceFailure: false,
        offersRegistration: false,
        offersUpdate: true,
      };

    case 'retired':
      return {
        tone: 'admin',
        shape: 'diamond',
        kind: 'Registered, then withdrawn from service',
        title: `This id is retired, not missing`,
        live: 'This id was registered and has since been retired. It is not in service.',
        serviceFailure: false,
        offersRegistration: false,
        offersUpdate: false,
      };

    case 'unknown':
      return {
        tone: 'neutral',
        shape: 'slashed-circle',
        kind: 'Not registered on this device',
        title: 'No item is registered under this id here',
        live: 'Not found. No item on this device is registered under this id.',
        serviceFailure: false,
        offersRegistration: true,
        offersUpdate: false,
      };

    case 'malformed':
      return {
        tone: 'admin',
        shape: 'diamond',
        kind: 'Not a FreshGuard id',
        title: 'This label does not contain a FreshGuard id',
        live: 'That is not a FreshGuard id, so no lookup was made.',
        serviceFailure: false,
        offersRegistration: false,
        offersUpdate: false,
      };

    case 'unavailable':
      return UNAVAILABLE_PRESENTATION[outcome.reason];
  }
}

/**
 * The four service failures, told apart.
 *
 * None of them borrows a verdict colour, and none of them says "not found" —
 * every one of these reached the client without the service naming the label at
 * all, and a screen that reported any of them as a missing item would be
 * inventing the one fact the operator actually needs.
 */
const UNAVAILABLE_PRESENTATION: Readonly<Record<UnavailableReason, IdentifyPresentation>> = {
  'no-such-device': {
    tone: 'neutral',
    shape: 'diamond',
    kind: 'The service answered, about a different thing',
    title: 'The service has never received a snapshot from this device',
    live: 'No lookup was made. The service does not know this device.',
    serviceFailure: true,
    offersRegistration: false,
    offersUpdate: false,
  },
  'no-answer': {
    tone: 'neutral',
    shape: 'diamond',
    kind: 'The service did not answer',
    title: 'The lookup could not be completed',
    live: 'The lookup could not be completed. The service did not answer it.',
    serviceFailure: true,
    offersRegistration: false,
    offersUpdate: false,
  },
  'rate-limited': {
    tone: 'neutral',
    shape: 'diamond',
    kind: 'The service is rate limiting this dashboard',
    title: 'The service is answering too slowly to look this up now',
    live: 'The service is rate limiting requests. Nothing was looked up.',
    serviceFailure: true,
    offersRegistration: false,
    offersUpdate: false,
  },
  'unknown-code': {
    tone: 'neutral',
    shape: 'slashed-circle',
    kind: 'An answer this dashboard does not recognise',
    title: 'The service gave an answer this build has no wording for',
    live: 'The service sent an unrecognised answer. Nothing is claimed about this label.',
    serviceFailure: true,
    offersRegistration: false,
    offersUpdate: false,
  },
};
