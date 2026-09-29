/**
 * Wire types for the FreshGuard read API.
 *
 * These mirror the projections in `backend/src/read/projections.js` and
 * `backend/src/read/service.js` exactly. Two rules from the backend are
 * load-bearing and are encoded here rather than left to comment:
 *
 *   1. `null` means "the device did not report this", never a zero and never a
 *      sentinel. Every field that can be withheld by the backend is typed
 *      `| null` and must be rendered as an explicit absence.
 *   2. A status is an integer plus the label the backend chose. The UI renders
 *      the label. It never maps a code to a verdict of its own, because the
 *      device is the sole authority.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** Firmware `FreshnessStatus`. The backend labels these; the UI shows the label. */
export type FreshnessCode = 0 | 1 | 2 | 3;

export interface StatusBlock {
  readonly code: number;
  readonly label: string;
}

/** Alert `kind`, from `deriveActiveConditions` in projections.js. */
export type AlertKind =
  | 'sensor_unavailable'
  | 'storage_fault'
  | 'optional_fault'
  | 'sensor_fault'
  | 'door'
  | 'status'
  | 'item';

export type AlertSeverity = 'error' | 'warning' | 'info';

/** Bit class from the firmware fault map. Decides how a condition is presented. */
export type FaultClass = 'sensor' | 'storage' | 'optional';

export interface FaultBit {
  readonly bit: number;
  readonly name: string;
  readonly class: FaultClass;
}

/** Gas path state. `warming_up` / `capturing_baseline` are expected for ~90 s. */
export type GasState = 'warming_up' | 'capturing_baseline' | 'ready' | 'faulted';

export type GasStateResponse = GasState | string;

/** Device-configured prototype thresholds, echoed from the snapshot's config block. */
export interface Thresholds {
  readonly temperature_min_c: number;
  readonly temperature_max_c: number;
  readonly humidity_min_pct: number;
  readonly humidity_max_pct: number;
  readonly gas_delta_abnormal_mv: number;
  readonly gas_delta_clear_mv: number;
  readonly use_soon_percent: number;
}

export interface Provenance {
  readonly source: string;
  readonly note: string | null;
  readonly reference: string | null;
}

// ---------------------------------------------------------------------------
// GET /devices
// ---------------------------------------------------------------------------

export interface DeviceListEntry extends DeviceBlock {
  readonly transport: Transport;
  readonly counts: {
    readonly inventory_active: number;
    readonly inventory_retired: number;
    readonly events: number;
  };
}

export interface DeviceListResponse {
  readonly devices: readonly DeviceListEntry[];
}

// ---------------------------------------------------------------------------
// Device block
// ---------------------------------------------------------------------------

export interface DeviceBlock {
  readonly dev: string;
  readonly contract_version: number;
  readonly first_seen_at: string;
  readonly last_ingest_at: string;
  /** Device clock, or null when the device clock is not trusted. */
  readonly reported_at: string | null;
  readonly time_valid: boolean;
  readonly seq: number;
  readonly uptime_s: number;
  readonly boot_count: number;
  readonly inv_revision: number;
  /** Samples queued on the device awaiting server acknowledgement. */
  readonly pending_count: number | null;
  readonly full_snapshot: boolean;
  readonly zone_status: StatusBlock;
  readonly overall_status: StatusBlock;
  readonly confirmed_fault_mask: number;
  readonly confirmed_faults: readonly FaultBit[];
  readonly availability_mask: number;
  readonly unavailable: readonly FaultBit[];
  readonly door: { readonly open: boolean; readonly stale: boolean };
  readonly gas: { readonly state: GasStateResponse; readonly warming_or_baselining: boolean };
  readonly firmware: string | null;
  readonly door_timeout_ms: number | null;
  readonly consecutive_samples: number | null;
  readonly thresholds: Thresholds | null;
  readonly provenance: Provenance | null;
}

// ---------------------------------------------------------------------------
// The server-computed freshness verdict
// ---------------------------------------------------------------------------
//
// Mirrors `backend/src/freshness/service.js` and `rules.js`. Three rules are
// encoded in these types rather than left to a comment, because a type error is
// the only thing in this codebase that can stop a wrong claim being rendered:
//
//   1. `item_temperature_measured` is typed as the LITERAL `false`. The backend
//      emits it from a literal for exactly this reason (`buildItem` in
//      `freshness/service.js`), and there is no sensor that could support the
//      opposite claim. A component that tried to render an item measurement
//      would not compile.
//   2. The two evidence layers are two separate, separately-typed blocks. Nothing
//      in this file lets them merge, so a view cannot accidentally present the
//      cabinet half as if it were a property of the item.
//   3. Every number the engine can withhold is `| null` and every field a
//      channel may not carry at all is OPTIONAL (`ChannelEvidence`). `null` and
//      "the backend did not send this" are different states, and `0` is never a
//      stand-in for either.

/** The four blended per-item statuses. The one computed verdict. */
export type FreshnessItemStatus = 'fresh' | 'use_soon' | 'check_food' | 'insufficient_data';

/** Layer 1 outcomes. `expired` is a date fact; the blend maps it to `check_food`. */
export type DateEvidenceStatus = 'fresh' | 'use_soon' | 'expired' | 'insufficient_data';

/** The four cabinet conditions. The condition is of the CABINET, never of an item. */
export type CabinetCondition = 'in_range' | 'warning' | 'critical' | 'insufficient_data';

/** Which layer forced the blended status. `null` means neither did on its own. */
export type EvidenceLayerId = 'date_derived' | 'cabinet_derived';

/**
 * Where the limits the engine measured against came from.
 *
 * `built_in_assumption` is the backend's own prototype defaults and is never a
 * cited food-safety limit. `authoritative` and `prototype_assumption` are the two
 * values a configured `threshold_profile.source` may hold. Widened with
 * `& {}` so a profile written with a source this build has never seen is
 * reported as it is instead of being asserted as one of the three.
 */
export type FreshnessThresholdSource = 'authoritative' | 'prototype_assumption' | 'built_in_assumption' | (string & {});

export interface FreshnessClock {
  readonly trusted: boolean;
  readonly device_time_valid: boolean;
  readonly device_reported_at: string | null;
  readonly server_time: string;
  /** Measured disagreement between the device clock and the server, in seconds. */
  readonly skew_seconds: number | null;
  readonly max_skew_seconds: number;
  /** Why the clock was rejected, in the backend's vocabulary. Empty when trusted. */
  readonly reasons: readonly string[];
  /** Layers the engine refused to compute. `date_derived` whenever untrusted. */
  readonly untrustworthy_layers: readonly string[];
  readonly trustworthy_layers: readonly string[];
  /** The backend's own sentence. Shown rather than paraphrased. */
  readonly note: string;
}

/** The seven limits, in the shape `BUILT_IN_THRESHOLDS` declares. */
export interface FreshnessThresholdValues {
  readonly temperature_min_c: number | null;
  readonly temperature_max_c: number | null;
  readonly humidity_min_pct: number | null;
  readonly humidity_max_pct: number | null;
  readonly gas_delta_abnormal_mv: number | null;
  readonly gas_delta_clear_mv: number | null;
  readonly use_soon_percent: number | null;
}

/**
 * What the DEVICE says it is applying. Reported beside the used values and
 * never used to judge: the backend refuses to second-guess the device, so two
 * answers can differ and the response shows both.
 */
export interface FreshnessDeviceThresholds {
  readonly values: Partial<FreshnessThresholdValues> | null;
  readonly revision: number | null;
}

export interface FreshnessThresholds {
  readonly revision: number | null;
  /** `built_in_assumption` when no zone profile is configured. Never normalise away. */
  readonly source: FreshnessThresholdSource;
  readonly basis: string;
  readonly scope: string;
  readonly reference: string | null;
  readonly note: string | null;
  readonly values: FreshnessThresholdValues;
  readonly device_applied: FreshnessDeviceThresholds | null;
  /** null = unknown, which is neither agreement nor disagreement. */
  readonly device_in_sync: boolean | null;
}

export interface ChannelLimits {
  readonly min: number | null;
  readonly max: number | null;
}

/**
 * How one channel was graded.
 *
 * `excluded` (the MQ-135 warming up) carries statistics but was not judged, and
 * `not_evaluated` (the operator cleared the limit) carries neither. So the
 * statistics are OPTIONAL here, and the view renders an explicit absence for
 * each one rather than a zero.
 */
export interface ChannelEvidence {
  readonly channel: string;
  readonly label: string;
  /** `degC`, `pct_rh` or `mV`. The MQ-135 is millivolts and never ppm. */
  readonly unit: string;
  readonly limits: ChannelLimits;
  readonly measured: boolean;
  readonly severity: 'no_data' | 'in_range' | 'warning' | 'critical' | 'excluded' | 'not_evaluated' | (string & {});
  readonly reason: string;
  readonly samples?: number;
  readonly min?: number | null;
  readonly max?: number | null;
  readonly avg?: number | null;
  readonly out_of_band_samples?: number;
  readonly worst_deviation?: number | null;
  readonly minutes_out_of_range?: number;
  readonly exposure_basis?: string;
  readonly last_sample_at?: string | null;
  readonly unobserved_after_seconds?: number | null;
}

/** A channel that is reported and aggregated but explicitly NOT judged. */
export interface ObservedChannelStats {
  readonly label: string;
  readonly unit: string;
  readonly samples: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly avg: number | null;
}

export interface CabinetWindow {
  readonly minutes: number | null;
  readonly from_epoch: number;
  readonly to_epoch: number;
  /** First and last reading ACTUALLY seen, which need not span the window. */
  readonly from: string;
  readonly to: string;
  /** The instant the judgement was made. */
  readonly requested_to: string;
  readonly samples: number;
  readonly time_base: string;
}

export interface CabinetDoorEvidence {
  readonly known: boolean;
  /** null when the reed is stale: an unknown door is never reported as closed. */
  readonly open: boolean | null;
  readonly stale: boolean;
  readonly timeout_ms: number | null;
  readonly measured?: string;
  readonly note: string;
}

/**
 * The MQ-135 block. `unit` is `mV` in the service and is typed as the literal so
 * a ppm rendering cannot compile. `note` is the SRS 1.6 (x) sentence about why,
 * and it travels with the block rather than living in a comment.
 */
export interface CabinetGasEvidence {
  readonly unit: 'mV';
  readonly state: string | null;
  readonly judged: boolean;
  readonly abnormal_threshold_mv: number | null;
  readonly clear_below_mv: number | null;
  readonly at_or_above_abnormal: boolean;
  readonly note: string;
}

/**
 * The warning band's magnitude.
 *
 * `source` is the literal `'built_in_assumption'`: a configured band has two
 * edges, so the third "warning" state needs a stated magnitude, and that
 * magnitude is the backend's own assumption rather than an operator-cited limit
 * (SRS 1.6 (x)). Typed as a literal so a view that shows the warning band is
 * forced to label it that way.
 */
export interface CabinetSeverityRules {
  readonly source: 'built_in_assumption';
  readonly note: string;
  readonly margins: Readonly<Record<string, number>>;
  readonly gas_crossing: string;
}

export interface CabinetEvidence {
  readonly window: CabinetWindow;
  readonly per_measurement: Readonly<Record<string, ChannelEvidence>>;
  readonly observed_only: Readonly<Record<string, ObservedChannelStats>>;
  readonly minutes_out_of_range: number | null;
  /** `none` / `partial` / `complete`. Partial blocks "within limits". */
  readonly coverage: 'none' | 'partial' | 'complete' | (string & {});
  readonly active_channels: readonly string[];
  readonly missing_inputs: readonly { readonly channel: string; readonly reason: string }[];
  readonly inactive_channels: readonly { readonly channel: string; readonly reason: string }[];
  /** The gap since the newest sample. Never folded into exposure minutes. */
  readonly unobserved_after_seconds: number | null;
  readonly last_sample_at: string | null;
  readonly door: CabinetDoorEvidence;
  readonly gas: CabinetGasEvidence;
  readonly severity_rules: CabinetSeverityRules;
}

/**
 * The measured half. `condition` is a fact about CABINET AIR, and this type
 * carries no item field at all — which is what makes it impossible to render it
 * as a per-item measurement by accident.
 */
export interface CabinetVerdict {
  readonly condition: CabinetCondition;
  readonly reason: string;
  readonly source: 'cabinet_measured' | (string & {});
  readonly evidence: CabinetEvidence;
}

/** Layer 1: the item's own dates. Sensor-free, and therefore certain. */
export interface DateEvidence {
  readonly status: DateEvidenceStatus;
  /** Which item field decided it. `null` when neither was registered. */
  readonly driving_field: 'expiry_epoch' | 'duration_limit_days' | null;
  readonly driving_rule: string;
  readonly store_date_epoch: number;
  readonly store_date: string | null;
  readonly expiry_epoch: number | null;
  readonly duration_limit_days: number | null;
  readonly deadline_epoch: number | null;
  readonly deadline: string | null;
  readonly window_seconds: number;
  readonly use_soon_percent: number | null;
  readonly clock_trusted: boolean;
  readonly progress_percent: number | null;
  readonly days_remaining: number | null;
  readonly days_overdue: number | null;
  readonly reason: string;
  /** The backend's sentence for a withheld block. Shown instead of the numbers. */
  readonly note: string | null;
}

/**
 * Layer 2: an inference about this item, drawn from the cabinet it shares.
 *
 * `measured` is typed `cabinet_air` and `attribution` is required, so the block
 * cannot exist without saying what the measurement is actually of.
 */
export interface CabinetDerivedEvidence {
  readonly applies: true;
  readonly condition: CabinetCondition;
  readonly reason: string;
  /** True when the cabinet layer forced the blended status. */
  readonly used_in_status: boolean;
  readonly measured: 'cabinet_air' | (string & {});
  /** The SRS 1.6 (x) sentence. Rendered in full, per item, every time. */
  readonly attribution: string;
  readonly note: string;
}

/**
 * The device's own per-item guess, carried for traceability.
 *
 * `authoritative` is the literal `false`: the backend states this field is
 * inferred from cabinet air, cannot distinguish one item from another in the
 * same cabinet, and never contributes to `status`. Typing it as `false` means a
 * view cannot present it as the verdict.
 */
export interface DeviceProvisionalStatus {
  readonly status_code: number | null;
  readonly label: string | null;
  readonly source: 'device' | (string & {});
  readonly authoritative: false;
  readonly basis: string;
  readonly note: string;
}

export interface FreshnessItemEvidence {
  readonly date_derived: DateEvidence;
  readonly cabinet_derived: CabinetDerivedEvidence;
}

export interface FreshnessItemVerdict {
  readonly uid: string;
  readonly name: string;
  /** The one computed verdict. The only status on this surface. */
  readonly status: FreshnessItemStatus;
  /** A hard constant on the wire. See rule 1 above. */
  readonly item_temperature_measured: false;
  readonly forced_by: EvidenceLayerId | null;
  readonly reason: string;
  readonly evidence: FreshnessItemEvidence;
  readonly device_provisional: DeviceProvisionalStatus;
}

/** The whole document: `GET /devices/:dev/freshness`, and `current().freshness`. */
export interface FreshnessResponse {
  readonly dev: string;
  readonly computed_at: string;
  /** Duplicated at the top level because it is the one flag not to read past. */
  readonly clock_trusted: boolean;
  readonly clock: FreshnessClock;
  readonly thresholds: FreshnessThresholds;
  readonly cabinet: CabinetVerdict;
  readonly items: readonly FreshnessItemVerdict[];
  /** SRS 1.4. Carried on the response because it is about THIS verdict. */
  readonly disclaimer: string;
  readonly engine: {
    readonly window_minutes: number | null;
    readonly clock_max_skew_seconds: number;
    readonly rule: string;
  };
}

/**
 * The cabinet-level half, attached to `/inventory`.
 *
 * Deliberately not the whole document: the per-item verdicts are already on each
 * item, and two copies of the same verdict could disagree.
 */
export interface FreshnessSummary {
  readonly computed_at: string;
  readonly clock_trusted: boolean;
  readonly thresholds: {
    readonly revision: number | null;
    readonly source: FreshnessThresholdSource;
    readonly basis: string;
    readonly reference: string | null;
  };
  readonly cabinet: CabinetVerdict;
  readonly counts: Readonly<Record<FreshnessItemStatus, number>>;
  readonly disclaimer: string;
}

/**
 * A fact about the *ingest link only*. `stale` here is emphatically not a
 * food-safety verdict and must never be rendered inside the food-danger list.
 */
export interface Transport {
  readonly last_received_at: string;
  readonly age_seconds: number;
  readonly stale: boolean;
  readonly stale_after_seconds: number;
  readonly note: string;
}

// ---------------------------------------------------------------------------
// GET /devices/:dev/current
// ---------------------------------------------------------------------------

export interface ReadingBlock {
  readonly recorded_at: string;
  /** Device clock, only when the reading's `time_valid` is true. */
  readonly reported_at: string | null;
  readonly time_valid: boolean;
  readonly seq: number;
  readonly temperature_c: number | null;
  readonly humidity_pct: number | null;
  readonly pressure_hpa: number | null;
  /** MQ-135 divider input, millivolts. Never ppm. */
  readonly gas_input_mv: number | null;
  /** MQ-135 delta from the stored baseline, millivolts. Never ppm. */
  readonly gas_delta_mv: number | null;
}

export type DeadlineSource = 'expiry' | 'duration' | 'none';

/**
 * Presentational timing the backend derives from an item's own epochs.
 *
 * Every numeric field is `| null` on purpose. The backend withholds the whole
 * group when the device clock is not trusted (R-13) or when the storage window
 * is zero-length, and it says why in `note`. A zero here would be a lie.
 */
export interface DerivedItem {
  readonly deadline: string | null;
  readonly deadline_epoch: number | null;
  readonly deadline_source: DeadlineSource;
  readonly window_seconds: number;
  readonly elapsed_seconds: number | null;
  readonly remaining_seconds: number | null;
  readonly progress_percent: number | null;
  readonly clock_trusted: boolean;
  readonly note: string | null;
}

export interface ItemRevisions {
  readonly first: number;
  readonly last: number;
  readonly retired: boolean;
  readonly retired_at_revision: number | null;
}

export interface InventoryItem {
  readonly uid: string;
  readonly name: string;
  readonly category: string | null;
  readonly quantity: string | null;
  readonly location: string | null;
  readonly store_date_epoch: number;
  readonly store_date: string | null;
  readonly expiry_epoch: number;
  readonly expiry: string | null;
  readonly duration_limit_days: number;
  /** The device's own per-item verdict. Rendered as given; never recomputed. */
  readonly status: StatusBlock;
  readonly derived: DerivedItem;
  readonly revisions: ItemRevisions;
  /**
   * The server-computed verdict for this item, when the inventory endpoint sent
   * one. Same object `GET /devices/:dev/freshness` returns in `items[]`, so a
   * view can show the verdict from a list it already has rather than issuing a
   * second request. Absent on a service older than the freshness engine, and
   * null for an item the engine did not evaluate.
   */
  readonly freshness?: FreshnessItemVerdict | null;
}

export interface Alert {
  readonly condition_key: string;
  readonly kind: AlertKind;
  readonly severity: AlertSeverity;
  readonly title: string;
  /** Backend-authored prose. It encodes the requirement rules; show it verbatim. */
  readonly detail: string;
  readonly bit?: number;
  readonly uid?: string;
  readonly acknowledged: boolean;
  readonly acknowledged_at: string | null;
  readonly acknowledged_by: string | null;
  readonly acknowledgement_note: string | null;
}

export interface CurrentResponse {
  readonly device: DeviceBlock;
  readonly transport: Transport;
  readonly readings: ReadingBlock | null;
  /** Active items only. Retired items come from the inventory endpoint. */
  readonly inventory: readonly InventoryItem[];
  readonly alerts: readonly Alert[];
  /**
   * The server-computed freshness document, recomputed on every call.
   *
   * `current()` is what the ingest path publishes, so this is how a changed
   * verdict reaches an open dashboard over the existing SSE stream with no
   * polling anywhere. Null only for a device the service has never seen, which
   * cannot happen on a page that already has a snapshot — so a view may treat
   * `null` as "this build is against a service that does not send it" and fall
   * back to the standalone endpoint.
   */
  readonly freshness: FreshnessResponse | null;
  readonly counts: {
    readonly inventory_active: number;
    readonly inventory_retired: number;
    readonly alerts_active: number;
    readonly alerts_unacknowledged: number;
  };
}

// ---------------------------------------------------------------------------
// GET /devices/:dev/inventory
// ---------------------------------------------------------------------------

export interface InventoryResponse {
  readonly dev: string;
  readonly inv_revision: number;
  readonly full_snapshot: boolean;
  readonly clock_trusted: boolean;
  /** The cabinet half of the verdict. The per-item half is on each item. */
  readonly freshness: FreshnessSummary | null;
  readonly items: readonly InventoryItem[];
}

// ---------------------------------------------------------------------------
// GET /devices/:dev/inventory/:uid
// ---------------------------------------------------------------------------
//
// The identification route, and the whole of it. SRS L105-108 / L157 / L305-308
// make identification mandatory, and make it mandatory through a unique
// identification id on a label rather than through any one piece of hardware;
// L542 lists QR or RFID tracking as optional. So the parameter is a `uid` and
// the parameter is called `uid`, and a camera reading a printed code and a
// reader presenting a tag produce the same string and call this same endpoint.
//
// Every name in this block is deliberately free of `rfid`, `tag`, `scan` and
// `qr` — the path segment, the response keys, and (see `src/api/endpoints.ts`
// and `src/app/inventory/identify.ts`) the failure vocabulary the dashboard
// branches on. A second reader-specific lookup must not be added: there is one
// identification, and the reader is only a way of obtaining the id.

/**
 * One item, identified.
 *
 * `item` is the SAME projection `/inventory` returns, byte for byte, including
 * `item.freshness`. That is the point of it: a caller that learned the item
 * shape from the list endpoint learns nothing new here, so the identify flow can
 * hand the item straight to the existing drawer and verdict components instead
 * of a second item shape that could drift from the first.
 */
export interface ItemLookupResponse {
  readonly dev: string;
  /** Echoed back, exactly as the route parsed it. The uid that was searched for. */
  readonly uid: string;
  readonly item: InventoryItem;
}

/**
 * The four answers the lookup can give, as the service's own `error.code`s.
 *
 * Not an exhaustiveness claim about the service — `ApiError.code` is a plain
 * string and a newer service may add codes — but the set this dashboard
 * distinguishes. `src/app/inventory/identify.ts` maps a code it does not
 * recognise onto a generic service failure and NEVER onto `unknownUid`: a code
 * this build has never seen is not evidence that an item is missing.
 */
export const ITEM_LOOKUP_CODES = ['uid_retired', 'unknown_uid', 'unknown_device', 'bad_request'] as const;
export type ItemLookupCode = (typeof ITEM_LOOKUP_CODES)[number];

/**
 * `error.context` on a `uid_retired` answer, per `read/service.js`.
 *
 * Declared here because the retired answer is the only one that carries it, and
 * a viewer needs it to say *when* rather than only *that*. It is READ, never
 * rebuilt: `ApiError.context` is the open map the service sent, and this
 * interface is the shape one caller knows that context to have - it is a
 * documentation of the service's field, not a copy the client produces.
 * `retirementFromContext()` in `identify.ts` narrows the two values that get
 * displayed and leaves the rest of the object alone.
 */
export interface ItemRetiredContext {
  readonly uid: string;
  readonly retired: true;
  /** Server time of the snapshot in which the device reported the uid gone. */
  readonly retired_at: string;
  /** The device's own inventory revision at that moment. */
  readonly retired_at_revision: number | null;
}

// ---------------------------------------------------------------------------
// GET /devices/:dev/readings
// ---------------------------------------------------------------------------

/**
 * Buckets the service actually implements (`BUCKETS` in read/queries.js).
 * Anything else is rejected with `bad_request`; the service then picks the
 * smallest supported bucket that fits under `max_points` and says so via
 * `requested_bucket` / `downgraded`.
 */
export const BUCKETS = ['raw', '1m', '5m', '1h'] as const;
export type Bucket = (typeof BUCKETS)[number];

export type ReadingField =
  | 'temperature_c'
  | 'humidity_pct'
  | 'pressure_hpa'
  | 'gas_input_mv'
  | 'gas_delta_mv';

export interface SeriesPoint {
  /** Server receipt time of the sample, or of the first sample in the bucket. */
  readonly t: string;
  /** Device clock, only for `raw` and only when the point's time is trusted. */
  readonly reported_at?: string | null;
  readonly time_valid: boolean;
  readonly samples: number;
  readonly temperature_c: number | null;
  readonly humidity_pct: number | null;
  readonly pressure_hpa: number | null;
  readonly gas_input_mv: number | null;
  readonly gas_delta_mv: number | null;
}

export interface ReadingsResponse {
  readonly dev: string;
  readonly from: string;
  readonly to: string;
  /** The bucket the service actually used. */
  readonly bucket: string;
  /** The bucket that was asked for. */
  readonly requested_bucket: string;
  /** True when `bucket` differs from `requested_bucket`. Must be surfaced. */
  readonly downgraded: boolean;
  readonly max_points: number;
  readonly fields: readonly string[];
  readonly points: number;
  readonly series: readonly SeriesPoint[];
}

// ---------------------------------------------------------------------------
// GET /devices/:dev/events
// ---------------------------------------------------------------------------

/**
 * The service's event-type enum, mirrored. `EVENT_TYPES` in
 * `backend/src/ingest/contract.js`, in the same order.
 *
 * WHY A MIRROR AND NOT AN IMPORT: the dashboard and the service are built and
 * deployed separately, and this file already mirrors `BUCKETS` and
 * `ITEM_LOOKUP_CAPS` for the same reason. The service is the authority; this
 * list is kept in step with it by hand, exactly as those are.
 *
 * WHY IT IS A LITERAL AND NOT A STRING ALIAS: the service closes the enum
 * (`z.enum([...EVENT_TYPES])` on `eventSchema`) and rejects a whole snapshot
 * whose event `type` is not in it, so the list can only change by a change to
 * the service — deliberately, visibly, and never by a device on its own. That
 * makes it a vocabulary this build can be held to, which is what `EVENT_LABELS`
 * in `src/lib/events.ts` needs: that map is typed `Record<EventType, string>`,
 * so a type added here without a label is a COMPILE ERROR rather than an event
 * the log renders as unknown. The two are one unit and are edited together.
 *
 * TO ADD A TYPE: add the string here, add a label to `EVENT_LABELS`, and — if it
 * is a transition rather than an observation — decide there whether it belongs
 * to a condition subject at all. `tsc -b` fails until the first two are done,
 * and `npm run build` runs `tsc -b` first, so the gap cannot reach a bundle.
 *
 * Eleven members, in the same order as the service's. Ten are the types
 * `FreshGuard.ino` raises from `raiseAlert()`; `rfid_scanned` is the eleventh
 * and is published by a path that deliberately does not go through
 * `raiseAlert()`, which is the right signal on its own — a scan is not a
 * condition. (The service's own comment on `EVENT_TYPES` says "the first
 * eleven" and "the twelfth" for these; it is one out, and the list there is
 * eleven long. Read the list, not the count in the prose.)
 */
export const EVENT_TYPES = [
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
  // Faults. Distinct from the latches above: a storage fault is an
  // administration problem and never affects a freshness verdict.
  'sensor_fault',
  'storage_fault',
  // A label was presented to the reader and its uid read. An OBSERVATION: a fact
  // about the cabinet, never a verdict and never a food-safety condition.
  'rfid_scanned',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface DeviceEvent {
  /**
   * The SERVER's row id. The only field on this record that may decide "is this
   * event new?", because it is the only one that still increases after the
   * device is reflashed.
   *
   * WHY IT IS NOT `event_id`: `event_id` is the DEVICE's own counter, and
   * backend migration `005_boot_generation.sql` scoped the dedupe key to
   * `(device_id, boot_generation, event_id)` — so a restart at 1 after every
   * flash is deliberate, not a fault. A high-water mark kept across one flash
   * therefore compares every genuinely new event as OLDER than everything
   * already seen, and the failure mode is silence: no error, no warning, no
   * failed request — the newness filter simply starves and the identify panel
   * never fires again for the life of the tab. That is the bug this field
   * exists to prevent, which is why nothing in this build may order, page or
   * compare events by `event_id`; it stays reported verbatim for display and
   * debug.
   *
   * `id` is the AUTOINCREMENT row id — the same sequence the service's `/events`
   * sort, its `before` cursor and `next_before` already use — monotonic within a
   * device forever, across boots and reflashes. Required rather than optional
   * because the service sends it on every row of `GET /devices/:dev/events`.
   * A caller that could be handed a response from a service older than this
   * field still checks it at runtime (see `IdentifyPanel`): the answer for a row
   * with no `id` is "not new", and never `event_id`, which would reinstate the
   * starvation above.
   */
  readonly id: number;
  /**
   * The device's own counter: unique within one boot, restarting at 1 after a
   * reflash (see `id` above). Display and debug only — never an order, never a
   * newness test, never a cursor.
   */
  readonly event_id: number;
  /**
   * The service's event type. Deliberately `string` rather than `EventType`: a
   * row is whatever the service stored, and a build talking to a service whose
   * enum has grown must still render it rather than refuse to type it. The
   * exhaustiveness this file is responsible for lives in `EVENT_TYPES` and
   * `EVENT_LABELS`; a caller that wants the narrowing asks `isKnownEventType`.
   */
  readonly type: string;
  readonly message: string;
  /**
   * The unique id, for the event types that are an observation of a label
   * rather than a condition. Null on every other type — and on a service older
   * than the column, which is why it is OPTIONAL rather than `| null`: absent
   * and "this event carried no id" are different states and neither is `""`.
   *
   * It is what the reader actually read, as stored. It is not evidence that the
   * id names any particular item, and SRS L227 (a sensor must not be used to
   * identify which item caused a condition) is not weakened by its presence
   * here: identifying an id and attributing a reading to an item are different
   * claims, and only the first is possible in this design.
   */
  readonly uid?: string | null;
  /** Device clock. Null when the event's `time_valid` is false. */
  readonly timestamp: string | null;
  readonly time_valid: boolean;
  /** Server receipt time. Always present. */
  readonly received_at: string;
}

export interface EventsResponse {
  readonly dev: string;
  readonly limit: number;
  readonly count: number;
  readonly has_more: boolean;
  readonly next_before: number | null;
  readonly events: readonly DeviceEvent[];
}

// ---------------------------------------------------------------------------
// GET /devices/:dev/alerts
// ---------------------------------------------------------------------------

export interface AlertsResponse {
  readonly dev: string;
  readonly count: number;
  readonly alerts: readonly Alert[];
}

// ---------------------------------------------------------------------------
// POST / DELETE /devices/:dev/alerts/:conditionKey/ack
// ---------------------------------------------------------------------------

export interface AckResponse {
  readonly dev: string;
  readonly condition_key: string;
  readonly acknowledged: boolean;
  readonly acknowledged_at?: string;
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly request_id: string;
    readonly details?: readonly { path: string; code: string; message: string }[];
    /**
     * The service's second bounded fact on a failure, when it sent one.
     *
     * Typed as the open map `ApiErrorContext` because the service owns the shape
     * per failure and this build must not narrow it: a newer service can attach
     * a context whose keys are unknown here, and the client carries it through
     * unchanged. See the type in `api/client.ts`.
     */
    readonly context?: Readonly<Record<string, unknown>>;
  };
}

// ---------------------------------------------------------------------------
// SSE frames
// ---------------------------------------------------------------------------

/** `GET /stream?dev=…` sends this as the opening frame and after every ingest. */
export interface StreamSnapshotFrame {
  readonly type: 'snapshot';
  readonly data: CurrentResponse;
}

export interface StreamErrorFrame {
  readonly type: 'error';
  readonly data: { readonly code: string; readonly message: string };
}

export interface StreamResyncFrame {
  readonly type: 'resync';
  readonly data: { readonly reason: string; readonly last_event_id: number };
}

export type StreamFrame = StreamSnapshotFrame | StreamErrorFrame | StreamResyncFrame;

// ---------------------------------------------------------------------------
// Administrator-configured limits (SRS requirement xii)
// ---------------------------------------------------------------------------

export type ThresholdScope = 'zone' | 'item';

/**
 * `authoritative` means the values came from a cited source. `prototype_assumption`
 * means they did not, and the note must say so. The dashboard shows this verbatim
 * rather than softening it, because a configured limit and a guess have very
 * different weight and collapsing them would misrepresent the evidence.
 */
export type ThresholdSource = 'authoritative' | 'prototype_assumption';

export interface ThresholdValues {
  readonly temperature_min_c: number | null;
  readonly temperature_max_c: number | null;
  readonly humidity_min_pct: number | null;
  readonly humidity_max_pct: number | null;
  readonly gas_delta_abnormal_mv: number | null;
  readonly gas_delta_clear_mv: number | null;
  readonly use_soon_percent: number | null;
  readonly door_timeout_ms: number | null;
}

export interface ThresholdProfile {
  readonly dev: string;
  readonly scope: ThresholdScope;
  readonly revision: number;
  readonly values: ThresholdValues;
  readonly source: ThresholdSource;
  readonly reference: string | null;
  readonly note: string | null;
  readonly changed_by: string | null;
  readonly changed_at: string;
}

export interface ThresholdDeviceReported {
  readonly values: Partial<ThresholdValues> | null;
  /** null on a device build too old to report one. */
  readonly revision: number | null;
}

export interface ThresholdViewResponse {
  readonly dev: string;
  readonly scope: ThresholdScope;
  readonly configured: ThresholdProfile | null;
  readonly device_reported: ThresholdDeviceReported | null;
  /**
   * true = the device is applying the configured revision.
   * false = it is not, and the operator should expect old limits until it does.
   * null = unknown, because the device does not report a revision. Never
   *   rendered as agreement.
   */
  readonly in_sync: boolean | null;
  readonly applied_by_device: Partial<ThresholdValues> | null;
  readonly note: string;
}

export interface ThresholdUpdate {
  readonly scope?: ThresholdScope;
  readonly temperature_min_c?: number | null;
  readonly temperature_max_c?: number | null;
  readonly humidity_min_pct?: number | null;
  readonly humidity_max_pct?: number | null;
  readonly gas_delta_abnormal_mv?: number | null;
  readonly gas_delta_clear_mv?: number | null;
  readonly use_soon_percent?: number | null;
  readonly door_timeout_ms?: number | null;
  readonly source: ThresholdSource;
  readonly reference?: string;
  readonly note?: string;
  readonly changed_by?: string;
}

export interface ThresholdChange {
  readonly revision: number;
  readonly changed_by: string | null;
  readonly changed_at: string;
  readonly before: { readonly values: ThresholdValues; readonly source: ThresholdSource } | null;
  readonly after: { readonly values: ThresholdValues; readonly source: ThresholdSource };
  readonly note: string | null;
}

export interface ThresholdHistoryResponse {
  readonly dev: string;
  readonly scope: ThresholdScope;
  readonly changes: readonly ThresholdChange[];
}

// ---------------------------------------------------------------------------
// POST /devices/:dev/items
// ---------------------------------------------------------------------------

/**
 * The command, minus `op`.
 *
 * `op` is deliberately absent and must stay absent: the service adds
 * `item.register` itself on the way out, and the route rejects a body carrying
 * one rather than ignoring it. A field that looks like it was honoured and was
 * not is worse than a refusal, and that rule cuts both ways — a dashboard that
 * sent `op` would get a 400 for a field it cannot see a reason to send.
 *
 * Everything except `uid` is optional and is OMITTED when the operator has not
 * filled it in, because absence is meaningful on this wire and `0` is not a
 * stand-in for it:
 *
 *   - `expiry_epoch: 0`            an explicit "use `duration_days` instead"
 *   - `manufacture_epoch: 0`       an explicit "unknown"
 *   - `duration_days: 0`           an explicit "no limit"
 *   - field absent                 the device applies its own default
 *
 * So the optional fields are `?:` rather than `| null`, and a view that wants
 * `0` has to say so deliberately. Defaulting an omitted field to 0 here would
 * destroy exactly the distinction the SRS asks the form to express.
 */
export interface ItemRegisterRequest {
  readonly uid: string;
  readonly name?: string;
  readonly category?: string;
  readonly quantity?: string;
  readonly location?: string;
  readonly duration_days?: number;
  readonly expiry_epoch?: number;
  readonly manufacture_epoch?: number;
}

/**
 * The one honest word for "the broker took it".
 *
 * Typed as the literal plus `string` rather than as the bare literal, so a
 * build that meets a NEWER service reports the word it was actually given
 * instead of a type asserting one that service would never send. The view keys
 * its wording off the real value: `dispatched` is a command on its way, and
 * nothing on this route has ever been a confirmation.
 */
export type ItemRegisterState = 'dispatched' | (string & {});

/**
 * The dispatch, and everything needed to resolve it later.
 *
 * `command_id`, `cmd_seq` and `expires_at_epoch` are ADDITIVE — migration 006
 * on the service added them to a response that already existed — so they are
 * OPTIONAL rather than required. A dashboard is built and deployed separately
 * from the service and this file already handles older services in three other
 * places (`freshness?` on an item, `uid?` on an event, `in_sync: boolean |
 * null` on a threshold), and this is the fourth: against a service that predates
 * the durable command record the POST answers `{ dev, uid, state }` and nothing
 * more. The view then says the service did not report a command identity rather
 * than printing `undefined` as if it were a sequence number.
 *
 * They are also what turns a registration from a one-line "sent" into a
 * trackable thing. `command_id` is the `admin_command` row the dispatch was
 * recorded as, `cmd_seq` is the sequence the device dedupes against, and
 * `expires_at_epoch` is when the command stops being valid — so an operator can
 * see that a real record exists and how long it is good for, instead of being
 * told only that a message left the process.
 */
export interface ItemRegisterResponse {
  readonly dev: string;
  readonly uid: string;
  readonly state: ItemRegisterState;
  /** The `admin_command` row id. Absent on a service older than migration 006. */
  readonly command_id?: number;
  /** Per-device dispatch sequence. Gaps are normal: a failed retry consumes one. */
  readonly cmd_seq?: number;
  /** Unix seconds. The command is refused by the device past this instant. */
  readonly expires_at_epoch?: number;
}

// ---------------------------------------------------------------------------
// GET /devices/:dev/commands/:uid
// ---------------------------------------------------------------------------
//
// The read that RESOLVES a dispatch. Before migration 006 the only answer a
// registration ever got was `state: "dispatched"`, which is the broker's word
// and not the device's, and a command the device never received was
// indistinguishable from one in flight — permanently. This route is the
// difference between "sent" and "applied", and it exists because the service
// persists every dispatch rather than holding it in memory.

/**
 * What the service knows about the latest command for one uid.
 *
 * Typed as the four known words plus `string`, for the same reason
 * `ItemRegisterState` is: a build must report the word it was actually given.
 * A word this build has never seen is NOT treated as a confirmation anywhere in
 * the UI — see `TERMINAL_COMMAND_STATES` for what has to be true before a
 * screen is allowed to stop saying "in flight".
 */
export type CommandStatus = 'dispatched' | 'confirmed' | 'expired' | 'failed' | (string & {});

/**
 * The states a poll may stop on.
 *
 *   confirmed  the device carried the uid in a later accepted snapshot, so it
 *              applied the command.
 *   expired    the command's window closed with no confirmation — the device
 *              almost certainly never received it.
 *   failed     the transport refused the publish, so the command never left.
 *
 * `dispatched` is deliberately absent. It is the one state that means "still
 * unknown", and a poll that stops on it is the bug this whole route exists to
 * fix.
 */
export const TERMINAL_COMMAND_STATES = ['confirmed', 'expired', 'failed'] as const;
export type TerminalCommandState = (typeof TERMINAL_COMMAND_STATES)[number];

/** Narrowing that a view can rely on, rather than a string comparison per call site. */
export function isTerminalCommandState(state: CommandStatus | null): state is TerminalCommandState {
  return state === 'confirmed' || state === 'expired' || state === 'failed';
}

/** One recorded dispatch, as stored. Newest first in `commands[]`. */
export interface DeviceCommand {
  /** The service's row id, and the only stable order. `cmd_seq` leaves gaps. */
  readonly id: number;
  /** `item.register` today. Carried rather than assumed, so a future op is visible. */
  readonly op: string;
  readonly uid: string;
  readonly cmd_seq: number;
  readonly expires_at_epoch: number;
  /** The same instant as an ISO-8601 string. Optional: only the epoch is relied on. */
  readonly expires_at?: string;
  readonly dispatched_at: string;
  readonly status: CommandStatus;
  /** Server clock at the confirmation. Null while merely dispatched. */
  readonly confirmed_at: string | null;
  /** Server clock at the refusal. Null unless `status` is `failed`. */
  readonly failed_at: string | null;
}

/**
 * `GET /api/v1/devices/:dev/commands/:uid`.
 *
 * `state` is the LATEST command's status, or `null` when nothing was ever
 * dispatched for this uid — which is a real answer ("no history"), not a gap,
 * and a view that renders it as "dispatched" would be inventing a fact.
 *
 * `commands` is newest-first and capped at 100 by the service, so it is a recent
 * history and not a complete one. Nothing in this build pages through it.
 *
 * Unauthenticated by design, like every other GET on the service's read router:
 * it exposes nothing the operator's own dispatch did not already record, and
 * attaching the admin credential to a GET would put the secret in a query
 * string, a log line and a `Referer` header. The asymmetry with the POST is
 * deliberate and must not be "fixed" from here.
 */
export interface CommandStatusResponse {
  readonly dev: string;
  readonly uid: string;
  readonly state: CommandStatus | null;
  readonly count: number;
  readonly commands: readonly DeviceCommand[];
}

/**
 * Length caps, mirroring `ITEM_FIELD_CAPS` in
 * `backend/src/read/item-registration.js`.
 *
 * Mirrored rather than imported because the dashboard and the service are built
 * and deployed separately, and the constants exist in the client for one reason
 * only: to turn a cap the operator is about to blow into an inline message
 * instead of a round trip. They are NOT a second source of truth. The service
 * enforces these and its 400 is what decides, and if the two ever disagree the
 * service's message is the one the operator is shown — see the form.
 */
export const ITEM_FIELD_CAPS = {
  uid: 64,
  name: 64,
  category: 32,
  quantity: 24,
  location: 64,
} as const;

/** 3650 days is ten years: `MAX_DURATION_DAYS` in the same module. */
export const MAX_DURATION_DAYS = 3650;

/**
 * 2100-01-01T00:00:00Z, in Unix seconds. `MAX_EPOCH_YEAR_2100` in the same
 * module, and a bound specific to this admin command: a real expiry is at most
 * a few years out, so anything past 2100 is a mis-scaled unit rather than a date.
 */
export const MAX_EPOCH_YEAR_2100 = 4_102_444_800;
