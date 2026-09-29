/**
 * HTTP client for the FreshGuard read API.
 *
 * Three jobs, and nothing else:
 *
 *   1. Turn the backend's `{ error: { code, message, request_id, context } }`
 *      envelope into a typed `ApiError` so no screen can ever be a silent blank.
 *   2. Deduplicate in-flight GETs. Two components that ask for the same URL in
 *      the same tick share one request; a second caller gets the same promise.
 *   3. Cache GET responses for a short window, keyed by full URL, so a
 *      re-mount or a device switch back does not re-hit the service. The
 *      service is rate limited, and a volunteer switching tabs should not spend
 *      the budget.
 *
 * Deliberately not a state library. There is no SWR here, no key serialisation
 * beyond the URL, and no mutation cache: snapshots arrive over SSE and replace
 * state outright, so a client cache only has to serve first paint and range
 * switches.
 */

/**
 * Same origin by default: the API is reached as a relative path and the dev
 * server (or whatever serves the built bundle) proxies it.
 *
 * The previous default of `http://127.0.0.1:8080` is a trap on anything that is
 * not the development machine. In a phone's browser it silently resolves to the
 * phone itself, so every request fails while the same build works fine on the
 * desktop that served it - a failure that looks like a dead backend rather than
 * a wrong URL. An absolute value is still supported for a genuinely separate API
 * host via VITE_API_BASE_URL.
 */
const DEFAULT_BASE_URL = '';

/** Read API prefix. `/healthz` and `/readyz` live at the server root, not here. */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

export const API_V1 = `${API_BASE}/api/v1`;

/**
 * The administrator credential, or the empty string when this build has none.
 *
 * Read once, at module scope, and Vite-replaced at build time. Two details:
 *
 *   - `.trim()`. A token pasted out of a terminal, a password manager or a
 *     `.env` file routinely arrives with a trailing newline, and a header
 *     carrying `\n` is rejected by the service as a bad token. The operator then
 *     sees a 401 while reading their own config and concludes the token is
 *     wrong, when it is one invisible character. A blank value trims to empty and
 *     is therefore treated as unset rather than sent as `Bearer `.
 *   - Absent is a supported state, not an error. Reads and the live feed need no
 *     credential, so a build without this variable is a perfectly good read-only
 *     dashboard. It is only writes that are refused, and `putJSON` is the single
 *     place that has to know.
 */
const ADMIN_TOKEN = (import.meta.env.VITE_ADMIN_TOKEN ?? '').trim();

/**
 * The `Authorization` header for a route that requires the admin credential.
 *
 * Returns an empty object when no token is configured, so the header is then
 * absent rather than present and empty - a request that carries
 * `Authorization: Bearer ` is a 401 that looks like a broken token rather than
 * a missing one.
 */
function adminAuthHeader(): Record<string, string> {
  return ADMIN_TOKEN === '' ? {} : { Authorization: `Bearer ${ADMIN_TOKEN}` };
}

/**
 * Resolve a path against the API origin.
 *
 * Endpoints are written as service-relative paths (`/api/v1/devices`), which is
 * the right place to author them. They must be resolved here, in one place:
 * handing a bare path to `fetch` resolves it against the *page* origin, so the
 * dev server answers 404 for every request and the dashboard looks broken while
 * the API is perfectly healthy. Absolute URLs pass through untouched so a
 * caller can point one request elsewhere.
 */
export function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Default freshness for a cached GET. Long enough for a re-mount, short enough to be honest. */
const DEFAULT_TTL_MS = 5_000;

export interface ApiErrorDetail {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/**
 * The service's `error.context`, carried through by reference and unchanged.
 *
 * WHY THIS IS AN OPAQUE MAP AND NOT A TYPE PER FAILURE
 * -----------------------------------------------------------------------------
 * `context` is the service's own second bounded fact on a failure, and the
 * service owns its shape. `middleware/error-handler.js` documents the rule
 * itself: `details` holds field paths and reasons but never values, while
 * `context` is "only present where a failure has a second bounded fact a caller
 * must be able to read without parsing prose". So the shape belongs to whichever
 * route attached it, and a new failure can carry a context this build has never
 * seen. Declaring a type here would put a second, hand-kept copy of the
 * service's vocabulary in the client, and the failure mode of that is the
 * opposite of what this field is for: a value the service sent, asserted to be
 * something else or dropped because it did not fit.
 *
 * So this is a pass-through with a documented type and no schema. What is
 * stored is the parsed object the service sent. A caller that knows which
 * failure it is looking at narrows the fields it needs itself - see
 * `retirementFromContext` in `src/app/inventory/identify.ts`, which reads the
 * two `uid_retired` values it displays and ignores the rest, rather than
 * re-deriving an object shaped like the service's.
 */
export type ApiErrorContext = Readonly<Record<string, unknown>>;

/**
 * A failed API call, carrying the backend's own vocabulary. `code` is the
 * stable part; `message` is prose the backend chose and is safe to show.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: readonly ApiErrorDetail[] | null;
  /**
   * `error.context` as sent, or null when the service sent none.
   *
   * Optional on the wire and therefore `| null` here rather than `{}`: "this
   * failure carries no second fact" and "this failure carries an empty object"
   * are different states, and the service only emits the former.
   */
  readonly context: ApiErrorContext | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    requestId?: string | null;
    details?: readonly ApiErrorDetail[] | null;
    context?: ApiErrorContext | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId ?? null;
    this.details = init.details ?? null;
    this.context = init.context ?? null;
  }

  /** True when the failure is a rate limit rather than a fault worth shouting about. */
  get isRateLimited(): boolean {
    return this.code === 'rate_limited' || this.status === 429;
  }

  /** True when the browser could not reach the API at all. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

interface CacheEntry {
  readonly value: unknown;
  readonly at: number;
}

const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, CacheEntry>();

/**
 * Drop cached GETs whose URL contains `fragment`. Called after a write so the
 * next read cannot serve a pre-write value.
 */
export function invalidate(fragment: string): void {
  for (const key of cache.keys()) {
    if (key.includes(fragment)) cache.delete(key);
  }
}

/** Drop everything. Used when the selected device changes. */
export function invalidateAll(): void {
  cache.clear();
}

const isEnvelope = (value: unknown): value is { error: { code: string; message: string; request_id?: string; details?: ApiErrorDetail[]; context?: unknown } } =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as { error: unknown }).error === 'object' &&
  (value as { error: unknown }).error !== null;

/**
 * Whether a value can be `error.context` at all, as distinct from what is in it.
 *
 * This decides only "is this a keyed object", never what the keys mean, and the
 * value is then stored by reference: the service renders a plain object here
 * (`middleware/error-handler.js` checks `typeof === 'object'` and that it has
 * keys), and an array or a bare string reaching this point would be a service
 * change rather than a real answer. Narrowing here keeps the declared type
 * `ApiErrorContext` honest without a schema, which is the point.
 */
function isContext(value: unknown): value is ApiErrorContext {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a thrown value is a cancellation rather than a failure.
 *
 * A cancelled `fetch` rejects with a `DOMException` named `AbortError`, and that
 * is the only shape a browser is specified to produce. The `instanceof` test
 * covers engines that throw a plain `Error` carrying the same name, and it is
 * guarded because `DOMException` is not a global in every environment this code
 * is type-checked against.
 */
function isAbort(cause: unknown): boolean {
  if (cause instanceof Error && cause.name === 'AbortError') return true;
  return typeof DOMException !== 'undefined' && cause instanceof DOMException && cause.name === 'AbortError';
}

async function readError(response: Response): Promise<ApiError> {
  let code = `http_${response.status}`;
  let message = `the service answered ${response.status} ${response.statusText}`.trim();
  let requestId = response.headers.get('X-Request-Id');
  let details: readonly ApiErrorDetail[] | null = null;
  let context: ApiErrorContext | null = null;

  try {
    const body: unknown = await response.json();
    if (isEnvelope(body)) {
      code = body.error.code;
      message = body.error.message;
      requestId = body.error.request_id ?? requestId;
      details = body.error.details ?? null;
      // Carried, not interpreted. Nothing here reads a key out of it, so a
      // context this build has never seen costs nothing and loses nothing.
      context = isContext(body.error.context) ? body.error.context : null;
    }
  } catch {
    // A non-JSON error body is not worth more than the status line above.
  }

  return new ApiError({ status: response.status, code, message, requestId, details, context });
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveUrl(url), {
      ...init,
      // No cookies, ever. Reads and the live feed are unauthenticated and the one
      // authenticated route carries a bearer header rather than a session, so a
      // cookie would add nothing but would widen the CORS requirements: with
      // `omit` the browser never sends credentials cross-origin, and a page
      // served from this origin still behaves identically to a page served from
      // anywhere else.
      credentials: 'omit',
    });
  } catch (cause) {
    // A cancellation is reported as its own failure rather than as a network
    // one, because the two mean opposite things to every caller: `isNetwork`
    // drives "cannot reach the service", and a request the browser dropped
    // because the component went away says nothing about whether the service is
    // reachable. It is still an `ApiError` so no screen has to know about
    // `DOMException`.
    if (isAbort(cause)) throw new ApiError({ status: 0, code: 'aborted', message: 'the request was cancelled' });
    throw new ApiError({
      status: 0,
      code: 'network_unreachable',
      message:
        cause instanceof Error && cause.message
          ? `could not reach the FreshGuard service: ${cause.message}`
          : 'could not reach the FreshGuard service',
    });
  }

  if (!response.ok) throw await readError(response);

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({
      status: response.status,
      code: 'invalid_response',
      message: 'the service returned a body that is not valid JSON',
      requestId: response.headers.get('X-Request-Id'),
    });
  }
}

export interface GetOptions {
  /** How long a resolved value may be reused. `0` disables caching, not dedupe. */
  readonly ttlMs?: number;
  /**
   * Cancels the request. `fetch` rejects with an `AbortError` and nothing is
   * cached, so a caller that walks away mid-flight leaves nothing behind.
   *
   * ABORTING AN IN-FLIGHT GET REMOVES IT FROM THE DEDUPE MAP SYNCHRONOUSLY,
   * which is the whole reason this option is safe to expose. React StrictMode
   * mounts, unmounts and remounts an effect, and if the shared promise were
   * still registered when the second mount asked for it, that second mount
   * would inherit the first mount's abort and render a cancellation as a
   * failure. Evicting inside the abort listener — not in a `finally`, which
   * runs a microtask later — means the remount issues its own request.
   */
  readonly signal?: AbortSignal | undefined;
}

/**
 * GET with in-flight dedupe and a short cache.
 *
 * Dedupe is keyed on the absolute URL and holds for the life of the request, so
 * StrictMode's double effect, a re-mount, or two panels needing the same range
 * all cost exactly one round trip.
 *
 * A CALLER THAT CANCELS DOES NOT CANCEL ANYONE ELSE. The dedupe entry belongs to
 * the promise, and only the caller that started the request holds a signal, so
 * aborting removes the entry synchronously and the next caller gets its own
 * request instead of an already-rejected one. See `GetOptions.signal`.
 */
export function getJSON<T>(url: string, { ttlMs = DEFAULT_TTL_MS, signal }: GetOptions = {}): Promise<T> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < ttlMs) return Promise.resolve(hit.value as T);

  const existing = inFlight.get(url);
  if (existing) return existing as Promise<T>;

  // Already cancelled: never open a request the caller has given up on, and
  // never occupy the dedupe map with one.
  if (signal?.aborted === true) {
    return Promise.reject(new ApiError({ status: 0, code: 'aborted', message: 'the request was cancelled' }));
  }

  // Assigned before the listener can fire, and read by it: an abort is delivered
  // synchronously from the caller's cleanup, and the entry it has to evict is
  // this promise. The identity check is belt-and-braces — the listener is removed
  // in `detach()` the moment the request finishes, so while it is still attached
  // this URL's entry is necessarily ours.
  let current: Promise<T> | undefined;
  let detach = (): void => undefined;

  const cancelled = new Promise<never>((_resolve, reject) => {
    if (signal === undefined) return;
    const onAbort = (): void => {
      if (current !== undefined && inFlight.get(url) === current) inFlight.delete(url);
      reject(new ApiError({ status: 0, code: 'aborted', message: 'the request was cancelled' }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    detach = () => signal.removeEventListener('abort', onAbort);
  });

  const fetched = request<T>(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  }).then((value) => {
    cache.set(url, { value, at: Date.now() });
    return value;
  });

  // `cancelled` is raced in rather than left alone so its rejection is always
  // handled. It never settles on its own: with no signal it is pending forever,
  // which costs one promise per request and no timer, and the race has already
  // taken the real answer by then.
  current = Promise.race([fetched, cancelled]).finally(() => {
    detach();
    if (inFlight.get(url) === current) inFlight.delete(url);
  });

  inFlight.set(url, current);
  return current;
}

/**
 * POST. Sent without the admin credential: the routes that use it (alert
 * acknowledgement) are not behind one, and see the note on `putJSON`.
 */
export function postJSON<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * What an operator is told when an admin route refuses the write.
 *
 * `PUT /api/v1/devices/:dev/thresholds` requires `Authorization: Bearer`. The
 * service's own 401 prose is written for a developer reading a log, and on its
 * own it is a dead end at the worst possible moment: the person saving a limit
 * needs to know which of two very different things is wrong, because the fix
 * differs and neither of them is "try again".
 *
 *   - no token in this build   -> the build is read-only; set the variable
 *   - token present, refused  -> this build's token does not match the service
 *
 * That distinction is the client's to make and the view's to render, because the
 * client is the only layer that knows whether a token was sent. The composed
 * message also states plainly that nothing was written, so a refused save can
 * never be read as a saved one, and that reads and the live feed still work -
 * which is true, and is the thing an operator with a rejected token needs to
 * hear, since the rest of the dashboard is fine.
 *
 * The service's own sentence is kept as the last clause rather than discarded:
 * it is the authoritative statement of which rule was actually broken, and
 * throwing it away to make room for ours would be trading a fact for a nicer
 * sentence.
 */
function adminAuthMessage(sentToken: boolean, serviceMessage: string): string {
  const cause = sentToken
    ? 'The admin token in this build was rejected. Check that VITE_ADMIN_TOKEN matches the token the service was started with.'
    : 'This dashboard has no admin token, so it cannot save configuration. Set VITE_ADMIN_TOKEN in the dashboard environment and reload.';
  return (
    `${cause} Nothing was written and the device was not sent anything; ` +
    `reading data and the live feed are unaffected. ` +
    `The service said: ${serviceMessage}`
  );
}

/**
 * Rewrite a refused admin write into something actionable. Anything else is
 * passed straight through, so a 400 with field-level detail or a 429 keeps the
 * service's own words.
 */
function explainAdminFailure(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.status !== 401) return error;
  return new ApiError({
    status: error.status,
    code: error.code,
    message: adminAuthMessage(ADMIN_TOKEN !== '', error.message),
    requestId: error.requestId,
    details: error.details,
    // Only the prose is replaced. Every other fact the service sent survives the
    // rewrite, so a caller that learned to read `context` on a 401 does not find
    // it missing for the one failure this file rewords.
    context: error.context,
  });
}

/**
 * PUT, used for saving administrator configuration.
 *
 * Deliberately not folded into postJSON with a method parameter: a save is not
 * a "post", and a reader scanning the call sites should be able to tell a read
 * from a mutation without expanding an options bag.
 *
 * This is also the ONLY helper that attaches the admin credential, and that is a
 * decision rather than an oversight. The contract puts a bearer token on the
 * thresholds route; reads and the live feed stay unauthenticated, and the
 * acknowledgement routes were not changed. Attaching an administrator secret to
 * a request that does not need one would widen the blast radius of this file
 * for no gain, and `getJSON` deliberately never sees the variable at all - a
 * token in a GET belongs in a query string, in a log line, and in a
 * `Referer` header on any redirect.
 */
export async function putJSON<T>(url: string, body: unknown): Promise<T> {
  try {
    return await request<T>(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...adminAuthHeader() },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw explainAdminFailure(error);
  }
}

export function deleteJSON<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'DELETE', headers: { Accept: 'application/json' } });
}

/**
 * Whether this build carries an administrator credential at all.
 *
 * Exists so a form can say "this build cannot save" *before* the operator types
 * anything, rather than letting them discover it as a 401 after filling in nine
 * fields. A refused write is a worse place to learn a fact the page already
 * knows: the client read the variable at module scope, the view did not, and
 * `adminAuthHeader` is quite happy to send no `Authorization` header at all.
 *
 * The variable is never returned. A boolean is the only thing any caller needs,
 * and a getter that handed back the secret would find a use eventually.
 */
export function hasAdminToken(): boolean {
  return ADMIN_TOKEN !== '';
}

/**
 * POST behind the admin credential, for the mutating admin routes.
 *
 * A second helper rather than a flag on `postJSON`, and the reason is the same
 * one that keeps `getJSON` from ever seeing `ADMIN_TOKEN`: this file attaches an
 * administrator secret, and the narrower the set of requests that can do it, the
 * smaller the blast radius of a mistake here. `postJSON` serves alert
 * acknowledgement, which is not behind a credential - folding the header into
 * the generic helper would have started shipping a bearer token to a route that
 * does not want one, and a token in a request is a token in whatever logs that
 * request lands in.
 *
 * It reuses `explainAdminFailure`, so a 401 here produces the same distinction a
 * refused threshold save does: a build with no token and a build whose token was
 * rejected are different problems with different fixes, and the operator needs to
 * be told which one they have. That matters more on this route than on the
 * thresholds one - here the 401 comes after someone has filled in a form, and an
 * unexplained refusal would read as "the device rejected my item".
 */
export async function postAdminJSON<T>(url: string, body: unknown): Promise<T> {
  try {
    return await request<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...adminAuthHeader() },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw explainAdminFailure(error);
  }
}

/** Absolute URL for a downloadable endpoint. Used for the CSV link, never fetched. */
export function fileUrl(path: string): string {
  return `${API_BASE}${path}`;
}
