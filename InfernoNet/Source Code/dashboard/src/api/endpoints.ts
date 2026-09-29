/**
 * Typed endpoint functions.
 *
 * One function per backend route, so no component ever assembles a URL or
 * knows a query-parameter name. `dev` is validated against the backend's own
 * device-id rule (`[A-Za-z0-9][A-Za-z0-9._-]*`, 1-64) before it reaches a
 * path segment, and `conditionKey` against the ack route's stricter rule.
 */
import { deleteJSON, fileUrl, getJSON, postAdminJSON, postJSON, putJSON, resolveUrl, type GetOptions } from './client';
import type {
  AlertsResponse,
  AckResponse,
  Bucket,
  CommandStatusResponse,
  CurrentResponse,
  DeviceListResponse,
  EventsResponse,
  FreshnessResponse,
  InventoryResponse,
  ItemLookupResponse,
  ItemRegisterRequest,
  ItemRegisterResponse,
  ReadingField,
  ReadingsResponse,
  ThresholdHistoryResponse,
  ThresholdProfile,
  ThresholdScope,
  ThresholdUpdate,
  ThresholdViewResponse,
} from './types';

const DEV_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CONDITION_KEY_RE = /^[A-Za-z0-9:_.-]{1,160}$/;

function assertDev(dev: string): string {
  if (!DEV_RE.test(dev)) throw new Error(`invalid device id: ${dev}`);
  return encodeURIComponent(dev);
}

function assertConditionKey(key: string): string {
  if (!CONDITION_KEY_RE.test(key)) throw new Error(`invalid condition key: ${key}`);
  return encodeURIComponent(key);
}

const v1 = (dev: string, suffix: string) => `/api/v1/devices/${assertDev(dev)}${suffix}`;

export function listDevices(options?: GetOptions): Promise<DeviceListResponse> {
  return getJSON<DeviceListResponse>('/api/v1/devices', options);
}

export function getCurrent(dev: string, options?: GetOptions): Promise<CurrentResponse> {
  return getJSON<CurrentResponse>(v1(dev, '/current'), { ttlMs: 2_000, ...options });
}

export function getInventory(
  dev: string,
  { retired = false }: { retired?: boolean } = {},
  options?: GetOptions,
): Promise<InventoryResponse> {
  const query = retired ? '?retired=true' : '';
  return getJSON<InventoryResponse>(v1(dev, `/inventory${query}`), { ttlMs: 10_000, ...options });
}

/**
 * Identify one item from its unique id.
 *
 * `GET /devices/:dev/inventory/:uid` -> `{ dev, uid, item }`, where `item` is the
 * same projection `/inventory` returns, freshness included.
 *
 * SRS L105-108 / L157 / L305-308 make identification mandatory, and make it
 * mandatory through a unique identification id on the label rather than through
 * any one piece of hardware; L542 lists QR or RFID tracking as optional. So this
 * is the identification route: a camera that reads a printed QR code and a
 * reader that presents a tag produce the same string and call this one function.
 * There is deliberately no second lookup per reader, and the path segment, the
 * response keys and the failure codes all say `uid` and never `rfid`, `tag`,
 * `scan` or `qr`.
 *
 * FOUR ANSWERS, AND THE CALLER BRANCHES ON THE CODE
 * -----------------------------------------------------------------------------
 *   400 bad_request  the value is not a uid at all. The caller's bug, or a label
 *                    printed with something a uid is not.
 *   200              found and in service, with the item and its freshness.
 *   409 uid_retired  registered once, then withdrawn from service. NOT "not found".
 *   404 unknown_uid  well-formed, never registered on this device.
 *   404 unknown_device  the cabinet is not known at all — also a 404, and a
 *                    different problem with a different fix.
 *
 * THE UID IS DELIBERATELY NOT VALIDATED HERE
 * -----------------------------------------------------------------------------
 * `assertDev` throws for a bad device id, and this does not throw for a bad uid,
 * and the difference is the whole point. A bad `dev` is a programming error in
 * this codebase: no operator types it, and failing loudly at the call site is
 * right. A bad `uid` arrives from a camera, from a reader and from a human
 * typing, and the service's own 400 names the rule it broke — "uid must be 1-64
 * hexadecimal characters (0-9, A-F)". A client-side regex that pre-empted that
 * would replace the service's diagnosis with this file's opinion, and would make
 * the malformed-label case — a real and common one — indistinguishable from a
 * bug. So the value is encoded, sent, and answered.
 *
 * `ttlMs: 0` — deliberately uncached. In-flight DEDUPE still applies, so two
 * components asking at once cost one round trip; the resolved value is not
 * reused, because the common case for this route is "an item was just
 * registered and the device has just reported it", and a 10-second warm cache
 * would answer `unknown_uid` about an item that demonstrably exists. The
 * dedupe is the part that helps; the cache would actively lie.
 */
export function getItemByUid(dev: string, uid: string, options?: GetOptions): Promise<ItemLookupResponse> {
  return getJSON<ItemLookupResponse>(v1(dev, `/inventory/${encodeURIComponent(uid)}`), { ttlMs: 0, ...options });
}

/**
 * The server-computed freshness verdict, on its own.
 *
 * THE FALLBACK, NOT THE PRIMARY PATH
 * -----------------------------------------------------------------------------
 * `getCurrent()` already carries the same document on `freshness`, and the store
 * holds that snapshot on every SSE frame — so a view with a snapshot in hand
 * needs no request at all, and a verdict change arrives by push. This function
 * exists for the two cases that is not true of: a snapshot that came from a
 * service build predating the engine (`freshness: null`), and an explicit
 * operator-triggered re-read.
 *
 * It is never called on a timer. The 2 s cache is not a refresh interval; it is
 * the same short window `getCurrent` uses so a re-mount or a StrictMode double
 * effect costs one round trip rather than two.
 */
export function getFreshness(dev: string, options?: GetOptions): Promise<FreshnessResponse> {
  return getJSON<FreshnessResponse>(v1(dev, '/freshness'), { ttlMs: 2_000, ...options });
}

export interface ReadingsQuery {
  /** Unix seconds or ISO-8601. Defaults server-side to the last hour. */
  readonly from?: string | number;
  readonly to?: string | number;
  readonly bucket?: Bucket;
  readonly fields?: readonly ReadingField[];
}
/**
 * Buckets the dashboard asks for per time range.
 *
 * `read/queries.js` implements exactly `raw`, `1m`, `5m` and `1h`; anything
 * else is a `bad_request`. Each range below is the finest implemented bucket
 * that keeps the point count under the service's `max_points` (500) at the
 * device's ~5 s reporting interval.
 */
export const RANGE_BUCKET: Record<string, Bucket> = {
  '1h': '1m',
  '6h': '5m',
  '24h': '1h',
  '7d': '1h',
};

export function getReadings(dev: string, query: ReadingsQuery, options?: GetOptions): Promise<ReadingsResponse> {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set('from', String(query.from));
  if (query.to !== undefined) params.set('to', String(query.to));
  if (query.bucket !== undefined) params.set('bucket', query.bucket);
  if (query.fields !== undefined) params.set('fields', query.fields.join(','));
  const search = params.toString();
  return getJSON<ReadingsResponse>(v1(dev, `/readings${search ? `?${search}` : ''}`), {
    ttlMs: 15_000,
    ...options,
  });
}

export function getEvents(
  dev: string,
  { limit = 25, before }: { limit?: number; before?: number | null } = {},
  options?: GetOptions,
): Promise<EventsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined && before !== null) params.set('before', String(before));
  return getJSON<EventsResponse>(v1(dev, `/events?${params.toString()}`), { ttlMs: 10_000, ...options });
}

export function getAlerts(dev: string, options?: GetOptions): Promise<AlertsResponse> {
  return getJSON<AlertsResponse>(v1(dev, '/alerts'), { ttlMs: 2_000, ...options });
}

export function acknowledge(
  dev: string,
  conditionKey: string,
  body: { acknowledged_by?: string; note?: string } = {},
): Promise<AckResponse> {
  return postJSON<AckResponse>(v1(dev, `/alerts/${assertConditionKey(conditionKey)}/ack`), body);
}

export function unacknowledge(dev: string, conditionKey: string): Promise<AckResponse> {
  return deleteJSON<AckResponse>(v1(dev, `/alerts/${assertConditionKey(conditionKey)}/ack`));
}

/**
 * The CSV is a download, not a fetch. Returned as a URL for an `<a download>`;
 * the service sets `Content-Disposition: attachment`, so the browser saves it
 * even though the API is on another origin.
 */
export const inventoryCsvUrl = (dev: string): string => fileUrl(v1(dev, '/inventory/export.csv'));

/**
 * Register an item on a device, by asking the device to.
 *
 * An admin route, so it goes out with the bearer credential: the service answers
 * 401 without one, and a form that had filled itself in deserves better than
 * discovering that on submit.
 *
 * The response says `state: "dispatched"` and nothing more. That is the whole
 * contract, and it is the reason this function returns the response rather than
 * discarding it: the command reached the broker, and the device has confirmed
 * nothing. The item becomes visible in `inventory[]` only when the device reports
 * it in a later snapshot over the existing SSE stream, so no caller may treat
 * this resolving as the item existing. There is no cache to invalidate either —
 * nothing local changed, because nothing was stored.
 *
 * A service that also has migration 006 adds `command_id`, `cmd_seq` and
 * `expires_at_epoch` to that response. They are read where present and never
 * required, so this still works against an older service — see
 * `ItemRegisterResponse` for why that is not a hypothetical.
 *
 * FAILURE IS MEANINGFUL, NOT TRANSPARENT. The service publishes to MQTT
 * synchronously inside the request, and a broker that refuses answers 503 with
 * the dispatch already recorded as `failed` — the uid was never published, so no
 * retry is implied and the command will sit at `failed` until something else
 * changes. That 503 is a real answer about the command and is deliberately
 * surfaced as a rejection rather than flattened into a generic "did not work":
 * callers that want to show the operator which uid is stuck, and why, have to
 * be able to tell this apart from a network error where nothing is known.
 */
export function registerItem(dev: string, body: ItemRegisterRequest): Promise<ItemRegisterResponse> {
  return postAdminJSON<ItemRegisterResponse>(v1(dev, '/items'), body);
}

/**
 * Resolve a registration: what actually happened to the command for one uid.
 *
 * `GET /api/v1/devices/:dev/commands/:uid`, and the read half of the durable
 * command record. `registerItem` can only ever say "sent"; this says "applied",
 * "never arrived", or "never left", which is the difference between an operator
 * being able to trust a registration and having to refresh and hope.
 *
 * UNAUTHENTICATED ON PURPOSE. Every read on the service is public, and this one
 * exposes no more than the operator's own dispatch already recorded: a uid, a
 * timestamp, and a word. Routing it through `postAdminJSON` for symmetry would
 * put the admin secret in a query string, a proxy log and a `Referer` header to
 * buy nothing. The asymmetry with the POST above is intended.
 *
 * NOT CACHED, AND THE `ttlMs` IS PINNED TO ZERO. The default 5s cache in
 * `getJSON` exists so that three components mounting together cost one request;
 * for a poll whose entire job is to notice a device confirming within seconds,
 * a cached answer is a wrong answer, and a cached "dispatched" is wrong for the
 * whole cache window. `options` is still accepted so a caller can pass a
 * `signal` — cancelling is how a poll stops when its component unmounts, and it
 * is not a cache concern — but it is spread BEFORE the pinned zero, so nothing a
 * caller passes can put a stale answer back into a poll.
 */
export function getCommandStatus(
  dev: string,
  uid: string,
  options?: GetOptions,
): Promise<CommandStatusResponse> {
  return getJSON<CommandStatusResponse>(v1(dev, `/commands/${encodeURIComponent(uid)}`), {
    ...options,
    ttlMs: 0,
  });
}

/**
 * Administrator-configured limits (SRS requirement xii).
 *
 * `in_sync` is the field that matters: saving a limit is not the same as the
 * device applying it. `null` means the device does not report a revision, which
 * is neither agreement nor disagreement and is rendered as "unknown" rather than
 * optimistically as "in sync".
 */
export function getThresholds(
  dev: string,
  { scope = 'zone' }: { scope?: ThresholdScope } = {},
  options?: GetOptions,
): Promise<ThresholdViewResponse> {
  return getJSON<ThresholdViewResponse>(v1(dev, `/thresholds?scope=${scope}`), {
    ttlMs: 5_000,
    ...options,
  });
}

export function putThresholds(dev: string, body: ThresholdUpdate): Promise<ThresholdProfile> {
  return putJSON<ThresholdProfile>(v1(dev, '/thresholds'), body);
}

export function getThresholdHistory(
  dev: string,
  { scope = 'zone', limit = 25 }: { scope?: ThresholdScope; limit?: number } = {},
  options?: GetOptions,
): Promise<ThresholdHistoryResponse> {
  return getJSON<ThresholdHistoryResponse>(
    v1(dev, `/thresholds/history?scope=${scope}&limit=${limit}`),
    { ttlMs: 5_000, ...options },
  );
}

/**
 * SSE endpoint. Resolved to an absolute URL: `EventSource` takes a URL, and a
 * bare path would open the stream against the dev server instead of the API.
 */
export const streamUrl = (dev: string): string => resolveUrl(`/api/v1/stream?dev=${encodeURIComponent(dev)}`);

export const healthUrl = (): string => fileUrl('/healthz');
