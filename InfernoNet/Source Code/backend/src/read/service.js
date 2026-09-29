/**
 * Read service: the deep module behind every read route and the SSE snapshot.
 *
 * A route handler's whole job is to parse a request and call one of these
 * methods; the 500-point cap, the bucket ladder, the device-clock rule and the
 * acknowledgement semantics all live here so there is exactly one place to get
 * them right.
 */
import { ApiError } from '../ingest/errors.js';
import { MAX_UID_CHARS, uidField } from '../ingest/contract.js';
import { BUCKET_ORDER, BUCKETS, READING_FIELDS, createReadStore } from './queries.js';
import { buildCurrentView, deriveInventory, joinAcks, deriveActiveConditions, projectDevice, projectTransport } from './projections.js';
import { createFreshnessService } from '../freshness/service.js';

const MAX_EVENT_PAGE = 200;

/**
 * Identification-lookup error codes.
 *
 * Defined here rather than added to the `CODES` map in ingest/errors.js, for the
 * same reason item-registration.js defines its own: that map is the DEVICE-facing
 * vocabulary, and a failed identification lookup is an operator-facing failure
 * that a snapshot never reports.
 *
 * THREE ANSWERS, THREE CODES. The operator's next action differs for each, and
 * none of them can be recovered from prose:
 *
 *   bad_request  400  the value is not a uid at all. The caller's bug.
 *   unknown_uid  404  well-formed, never registered on this device. Either the
 *                        wrong tag or a tag that has not been registered yet.
 *   uid_retired  409  registered once, then withdrawn from service.
 *
 * The 404/409 split is the point. A tag withdrawn from service and a tag that was
 * never registered are different answers to the same question, and an operator
 * standing in a kitchen with a reader in one hand needs to be able to tell them
 * apart without reading English: "retired, here is when" and "we have never seen
 * this" call for different next steps - restore the tag's registration, or go and
 * register it. Collapsing both into 404 makes the second one invisible, and
 * collapsing the first into 200 would present a withdrawn tag as a usable item.
 */
export const UNKNOWN_UID = 'unknown_uid';
export const UID_RETIRED = 'uid_retired';

const parseEpoch = (value, fallback, field) => {
  if (value === undefined || value === '') return fallback;
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new ApiError('bad_request', `${field} must be unix seconds or an ISO-8601 timestamp`);
  return Math.floor(parsed / 1000);
};

/**
 * Pick the smallest bucket at or above the requested one that keeps the
 * response within the point cap. A caller that asks for `raw` over a week gets
 * 1m buckets rather than a hard error, and the response says what it did.
 */
function resolveBucket(store, { deviceId, from, to, spanSeconds, requested, cap }) {
  const startIndex = Math.max(0, BUCKET_ORDER.indexOf(requested));
  for (let index = startIndex; index < BUCKET_ORDER.length; index += 1) {
    const bucket = BUCKET_ORDER[index];
    const seconds = BUCKETS[bucket];
    // An upper bound on group count from the span, which is exact for buckets
    // and replaced by a real count for raw.
    const points = seconds === null ? store.countReadings(deviceId, from, to) : Math.ceil(spanSeconds / seconds);
    if (points <= cap) return { bucket, seconds, points };
  }
  throw new ApiError(
    'range_too_wide',
    `no bucket keeps this range within ${cap} points; narrow from/to or use a 30-day retention window`,
  );
}

const CSV_COLUMNS = [
  'dev', 'uid', 'name', 'category', 'quantity', 'location',
  'store_date_epoch', 'store_date_iso', 'expiry_epoch', 'expiry_iso', 'duration_limit_days',
  'deadline_source', 'deadline_epoch', 'deadline_iso', 'window_seconds',
  'elapsed_seconds', 'remaining_seconds', 'progress_percent',
  'status_code', 'status',
  'freshness_status', 'freshness_forced_by', 'date_status', 'date_driving_field',
  'cabinet_condition', 'item_temperature_measured',
  'retired', 'retired_at_revision', 'clock_trusted', 'note',
];

/**
 * The cabinet-level half of the freshness document, attached to /inventory.
 *
 * Deliberately NOT the whole document. The per-item verdicts are already on each
 * item, and repeating all twelve of them here as well would give a consumer two
 * copies that could disagree. What belongs at the top of an inventory response
 * is what is true of the cabinet itself.
 */
function summarise(fresh) {
  if (!fresh) return null;
  return {
    computed_at: fresh.computed_at,
    clock_trusted: fresh.clock_trusted,
    thresholds: {
      revision: fresh.thresholds.revision,
      source: fresh.thresholds.source,
      basis: fresh.thresholds.basis,
      reference: fresh.thresholds.reference,
    },
    cabinet: fresh.cabinet,
    counts: fresh.items.reduce(
      (counts, entry) => ({ ...counts, [entry.status]: counts[entry.status] + 1 }),
      { fresh: 0, use_soon: 0, check_food: 0, insufficient_data: 0 },
    ),
    disclaimer: fresh.disclaimer,
  };
}

/** Neutralise spreadsheet formula injection; item names come from the device. */
const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

export function createReadService({
  db,
  now = () => new Date(),
  staleAfterSeconds,
  maxPoints = 500,
  freshnessWindowMinutes = 360,
  freshnessClockMaxSkewSeconds = 900,
  commandStore,
}) {
  if (!commandStore || typeof commandStore.listByUid !== 'function') {
    throw new TypeError('createReadService requires a commandStore');
  }
  const store = createReadStore(db);
  // Built here rather than injected so the freshness block, the /current payload
  // and the SSE frame can never come from two different engine instances with
  // two different windows. Both are functions of the same `db` and the same
  // `now`, which is what makes a recompute-on-ingest verdict comparable with the
  // one the dashboard is already holding.
  const freshness = createFreshnessService({
    db,
    now,
    windowMinutes: freshnessWindowMinutes,
    clockMaxSkewSeconds: freshnessClockMaxSkewSeconds,
  });

  const requireDevice = (dev) => {
    const device = store.getDevice(dev);
    if (!device) throw new ApiError('unknown_device', `no snapshot has been received for device '${dev}'`);
    return device;
  };

  const inventoryFor = (device) => store.listInventory(device.id, { includeRetired: true });
  const nowEpoch = () => Math.floor(now().getTime() / 1000);

  /**
   * THE item shape, in one place.
   *
   * `/inventory` and the identification lookup both answer with this, and they
   * call this rather than each assembling their own - so the two cannot disagree
   * about what an item looks like, and a consumer that learned the shape from the
   * list endpoint needs to learn nothing new for the lookup. That is the whole
   * reason the lookup exists: one response carrying the item's details AND its
   * server-computed freshness, instead of a caller having to find the item in a
   * list and then fetch a verdict separately and hope the two came from the same
   * instant.
   *
   * `fresh` is passed in rather than computed here so a caller that also needs the
   * cabinet summary (that is `inventory()`) evaluates the engine once and both
   * outputs come from the same evaluation.
   */
  const inventoryItems = (device, rows, fresh) => {
    const at = nowEpoch();
    const clockTrusted = Boolean(device.time_valid) && device.reported_at !== null;
    const byUid = new Map((fresh?.items ?? []).map((entry) => [entry.uid, entry]));
    return deriveInventory(rows, { nowEpoch: at, clockTrusted }).map((view) => ({
      ...view,
      freshness: byUid.get(view.uid) ?? null,
    }));
  };

  /**
   * The freshness document, or null for a device this service has never seen.
   *
   * Returns null rather than throwing so `current()` can attach it without a
   * second `requireDevice`, and so the absence of the block is visible rather
   * than being an exception the caller has to guess how to swallow.
   */
  const freshnessFor = (device, items) => freshness.evaluate(device.dev, { inventory: items });

  return {
    store,
    freshness,

    listDevices() {
      const at = nowEpoch();
      return store.listDevices().map((device) => ({
        ...projectDevice(device),
        transport: projectTransport(device, { nowEpoch: at, staleAfterSeconds }),
        counts: {
          inventory_active: device.inventory_active,
          inventory_retired: device.inventory_retired,
          events: device.event_count,
        },
      }));
    },

    current(dev) {
      const device = requireDevice(dev);
      const inventory = inventoryFor(device);
      return {
        ...buildCurrentView({
          device,
          reading: store.getLatestReading(device.id),
          inventory,
          acks: store.listAcks(device.id),
          nowEpoch: nowEpoch(),
          staleAfterSeconds,
        }),
        // Recomputed on every call, and `current()` is what the ingest path
        // publishes - so a new snapshot re-judges the cabinet and pushes the
        // result over the existing SSE stream. No browser polling anywhere.
        freshness: freshnessFor(device, inventory.filter((item) => !item.retired)),
      };
    },

    /**
     * The freshness document on its own, for a dashboard that wants the verdict
     * without the rest of the aggregate.
     */
    freshness(dev) {
      const device = requireDevice(dev);
      return freshnessFor(device, inventoryFor(device).filter((item) => !item.retired));
    },

    inventory(dev, { includeRetired = false } = {}) {
      const device = requireDevice(dev);
      const items = inventoryFor(device).filter((item) => includeRetired || !item.retired);
      // Evaluated over the same active subset that is being returned, so a
      // retired item can never appear in the engine's output.
      const fresh = freshnessFor(device, items);
      const summary = summarise(fresh);

      return {
        dev: device.dev,
        inv_revision: device.inv_revision,
        full_snapshot: Boolean(device.full),
        clock_trusted: Boolean(device.time_valid) && device.reported_at !== null,
        // Two additive blocks. Nothing below this line changed shape, and no
        // existing field was renamed, removed or retyped: `status` is still the
        // device's own verdict and `derived` is still the same arithmetic. A
        // consumer that ignores both additions keeps working untouched.
        freshness: summary,
        items: inventoryItems(device, items, fresh),
      };
    },

    /**
     * Identify one item from its unique id, and return it in the `/inventory`
     * shape with its server-computed freshness attached.
     *
     * SRS: "Scanning the QR code should allow the food item to be identified and
     * its details to be retrieved or updated." This is the "retrieved" half -
     * `POST /devices/:dev/items` remains the only write path, and it still
     * dispatches to the device rather than writing a row (see item-registration.js).
     *
     * THE UID IS THE ONLY INPUT, AND IT IS NOT NAMED AFTER ANY READER. The route
     * is `/devices/:dev/inventory/:uid`, the response keys are `dev`, `uid` and
     * `item`, and the failure codes are `unknown_uid` and `uid_retired` - no
     * `rfid`, `tag`, `scan` or `qr` anywhere in any of them, deliberately. The
     * SRS requires identification through a unique id on a sticker (L105-108,
     * L157, L305-308) and treats RFID tracking as OPTIONAL (L542), so the id is
     * the contract and the reader is one way of obtaining it. A camera-based QR
     * scanner feeding this backend will call this exact route with the exact same
     * payload and get the exact same answers; nothing here needs to know which
     * peripheral produced the string. That is the reason for the naming, and it
     * is also why a second lookup route per reader must not be added later.
     *
     * WHAT A SCAN DOES NOT MEAN. The uid resolves to an item and that item's own
     * dates, device status and cabinet-referenced freshness come back - which is
     * the whole request. It does not resolve a CONDITION to an item, and nothing
     * in this response says a sensor reading belongs to this item. SRS L227
     * forbids exactly that: the gas sensor is not used to identify which specific
     * food item caused a condition. The carried `freshness` block is the
     * engine's existing per-item verdict, which references the cabinet condition
     * rather than inheriting it, and `item_temperature_measured` is a hard false
     * because no sensor in this design measures an item.
     *
     * `uid` is validated here as well as in the route, so this method is safe to
     * call from anywhere. A malformed uid is a 400 and is decided BEFORE the
     * device is looked up, so a bad value can never be reported as "not found" -
     * the two failures have different causes and different fixes.
     */
    itemByUid(dev, uid) {
      const parsed = uidField.safeParse(uid);
      if (!parsed.success) {
        throw new ApiError('bad_request', `uid must be 1-${MAX_UID_CHARS} hexadecimal characters (0-9, A-F)`);
      }
      const wanted = parsed.data;

      const device = requireDevice(dev);
      const row = store.getInventoryByUid(device.id, wanted);
      if (!row) {
        throw new ApiError(UNKNOWN_UID, `no item is registered under uid '${wanted}' on device '${device.dev}'`, {
          status: 404,
        });
      }
      if (row.retired) {
        // "When" is `updated_at`: the server time of the snapshot in which the
        // device reported the tag gone, i.e. when this backend learned of it. It
        // is stated as that rather than as the retirement itself, because the
        // device holds the authority clock and the only fact available on this
        // side is our own receipt time. `retired_at_revision` is the device's own
        // inventory revision at that moment, which is the number an operator
        // will actually match against the dashboard.
        throw new ApiError(
          UID_RETIRED,
          `uid '${wanted}' is registered but was retired at ${row.updated_at} `
            + `(inventory revision ${row.retired_at_revision}) and is not in service`,
          {
            status: 409,
            context: {
              uid: wanted,
              retired: true,
              retired_at: row.updated_at,
              retired_at_revision: row.retired_at_revision,
            },
          },
        );
      }

      // Evaluated over the single row being returned, so the engine cannot
      // produce a verdict for some other item, and only this item's verdict comes
      // back. This method writes nothing: identifying a tag is a read, and it
      // does not bring a retired row back into service - that is a device-side
      // registration, dispatched through POST /devices/:dev/items.
      const fresh = freshnessFor(device, [row]);
      return {
        dev: device.dev,
        uid: wanted,
        item: inventoryItems(device, [row], fresh)[0],
      };
    },

    inventoryCsv(dev) {
      const device = requireDevice(dev);
      const at = nowEpoch();
      const clockTrusted = Boolean(device.time_valid) && device.reported_at !== null;
      const all = inventoryFor(device);
      const fresh = freshnessFor(device, all);
      const byUid = new Map((fresh?.items ?? []).map((entry) => [entry.uid, entry]));
      const rows = all.map((item) => {
        const view = deriveInventory([item], { nowEpoch: at, clockTrusted })[0];
        const entry = byUid.get(item.uid);
        return {
          dev: device.dev,
          uid: view.uid,
          name: view.name,
          category: view.category,
          quantity: view.quantity,
          location: view.location,
          store_date_epoch: view.store_date_epoch,
          store_date_iso: view.store_date,
          expiry_epoch: view.expiry_epoch,
          expiry_iso: view.expiry,
          duration_limit_days: view.duration_limit_days,
          deadline_source: view.derived.deadline_source,
          deadline_epoch: view.derived.deadline_epoch,
          deadline_iso: view.derived.deadline,
          window_seconds: view.derived.window_seconds,
          elapsed_seconds: view.derived.elapsed_seconds,
          remaining_seconds: view.derived.remaining_seconds,
          progress_percent: view.derived.progress_percent,
          status_code: view.status.code,
          status: view.status.label,
          // Additive. The two layers are exported separately so a spreadsheet
          // can be sorted by one without the other silently rewriting it, and
          // `freshness_status` is never confused with the device's `status`.
          freshness_status: entry?.status ?? null,
          freshness_forced_by: entry?.forced_by ?? null,
          date_status: entry?.evidence?.date_derived?.status ?? null,
          date_driving_field: entry?.evidence?.date_derived?.driving_field ?? null,
          cabinet_condition: entry?.evidence?.cabinet_derived?.condition ?? null,
          item_temperature_measured: entry?.item_temperature_measured ?? false,
          retired: view.revisions.retired,
          retired_at_revision: view.revisions.retired_at_revision,
          clock_trusted: clockTrusted,
          note: view.derived.note,
        };
      });

      const lines = [CSV_COLUMNS.join(',')];
      for (const row of rows) lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(','));
      return { csv: `${lines.join('\n')}\n`, count: rows.length };
    },

    readings(dev, { from, to, bucket = 'raw', fields } = {}) {
      const device = requireDevice(dev);
      if (!BUCKET_ORDER.includes(bucket)) {
        throw new ApiError('bad_request', `bucket must be one of ${BUCKET_ORDER.join(', ')}`);
      }

      const selected = fields === undefined
        ? READING_FIELDS
        : fields.map((field) => {
            if (!READING_FIELDS.includes(field)) {
              throw new ApiError('bad_request', `unknown field '${field}'; allowed: ${READING_FIELDS.join(', ')}`);
            }
            return field;
          });

      // Bounds keep millisecond precision. Flooring to whole seconds would put
      // `to` *before* a reading recorded during the same second, and the default
      // "last hour" window would silently omit the newest sample.
      const toEpochValue = parseEpoch(to, now().getTime() / 1000, 'to');
      const fromEpochValue = parseEpoch(from, toEpochValue - 3600, 'from');
      if (fromEpochValue >= toEpochValue) throw new ApiError('bad_request', 'from must be earlier than to');

      const fromIso = new Date(fromEpochValue * 1000).toISOString();
      const toIso = new Date(toEpochValue * 1000).toISOString();
      const chosen = resolveBucket(store, {
        deviceId: device.id,
        from: fromIso,
        to: toIso,
        spanSeconds: toEpochValue - fromEpochValue,
        requested: bucket,
        cap: maxPoints,
      });

      const rows = chosen.seconds === null
        ? store.readRawReadings({ device_id: device.id, from: fromIso, to: toIso })
        : store.readBucketedReadings({
            device_id: device.id,
            from: fromIso,
            to: toIso,
            bucket_seconds: chosen.seconds,
          });

      const points = rows.map((row) => {
        const base = chosen.seconds === null
          ? { t: row.recorded_at, reported_at: row.reported_at, time_valid: Boolean(row.time_valid), samples: 1 }
          : { t: new Date(row.bucket_epoch * 1000).toISOString(), time_valid: Boolean(row.time_valid), samples: row.samples };
        for (const field of selected) base[field] = row[field] ?? null;
        return base;
      });

      return {
        dev: device.dev,
        from: fromIso,
        to: toIso,
        bucket: chosen.bucket,
        requested_bucket: bucket,
        downgraded: chosen.bucket !== bucket,
        max_points: maxPoints,
        fields: selected,
        points: points.length,
        series: points,
      };
    },

    events(dev, { limit = 50, before } = {}) {
      const device = requireDevice(dev);
      const capped = Math.min(Math.max(Number(limit) || 50, 1), MAX_EVENT_PAGE);
      const beforeId = before === undefined || before === '' ? null : Number(before);
      // The cursor is a row id, not a `event_id`: event_id restarts with each
      // boot (migration 005) and is therefore not an order across a device's
      // history. The message names the thing that must be non-negative rather
      // than the column, because a caller only ever echoes back `next_before`.
      if (beforeId !== null && (!Number.isInteger(beforeId) || beforeId < 0)) {
        throw new ApiError('bad_request', 'before must be a non-negative event row id');
      }
      const rows = store.listEvents({ device_id: device.id, before_id: beforeId, limit: capped + 1 });
      const page = rows.slice(0, capped);
      return {
        dev: device.dev,
        limit: capped,
        count: page.length,
        has_more: rows.length > capped,
        // The row id of the last row on this page, so the next request's filter
        // and this response's order are the same sequence (see queries.js).
        next_before: page.length > 0 ? page[page.length - 1].id : null,
        events: page.map((row) => ({
          // The SERVER's sequence, and the only id here a client may use to
          // decide "is this event new?". `event_id` is the device's per-boot
          // counter: migration 005 scoped it to (device, boot_generation) and it
          // restarts at 1 after a reflash, so a high-water mark kept across one
          // compares every later event as OLDER and the newness filter starves
          // silently - no error, the panel just never fires again. `id` is the
          // AUTOINCREMENT row id that the sort, the `before` cursor and
          // `next_before` already use (see queries.js), so exposing it gives the
          // client one monotone sequence for ordering, paging and newness, and
          // `event_id` stays what the API documents it as: the device's own
          // counter, reported verbatim, never an order.
          id: row.id,
          event_id: row.event_id,
          type: row.type,
          message: row.message,
          // The tag, for the events that carry one. Null on every event type
          // that is a condition rather than an observation, and on any device
          // build that predates the field. Reported as stored: it is what the
          // reader actually read, not something re-derived from the message, and
          // not evidence that the tag names any particular item.
          uid: row.uid ?? null,
          timestamp: row.event_epoch ? new Date(row.event_epoch * 1000).toISOString() : null,
          time_valid: Boolean(row.time_valid),
          received_at: row.received_at,
        })),
      };
    },

    /**
     * The history and resolved state of every `item.register` command ever
     * dispatched to a device for one uid.
     *
     * FOUR FACTS ARE ANSWERED BY ONE READ, AND THE OPERATOR'S NEXT STEP
     * DIFFERS FOR EACH:
     *   null      no command for this uid was ever dispatched - or it expired
     *             and this device has never reported, which the device-absent
     *             404 below keeps distinct.
     *   dispatched  the command went out but nothing has confirmed it yet. Poll
     *             again, or look at /inventory: the item may simply not have
     *             been echoed back.
     *   confirmed   an accepted snapshot carried the uid (see ingestion). The
     *             command did its job; the item is in the device's registry.
     *   expired     the command's window closed (COMMAND_TTL_SECONDS) without a
     *             confirmation. Re-dispatch if the item is still wanted.
     *   failed      the transport refused the publish and the operator was
     *             answered 503. Retry.
     *
     * WHY THE EXPIRY IS RESOLVED READ-TIME. `expired` matters only to this
     * read - there is no batch job, no retention sweep and no other consumer -
     * so the read first resolves what it is about to report: one index-backed
     * UPDATE that marks every overdue `dispatched` row for this device, then
     * the SELECT. That keeps the transition in front of the query that needs
     * it, needs no background writer, and means the first status read after a
     * long gap already answers honestly instead of showing "dispatched" until
     * some unrelated process runs. A command the device DID apply past its
     * window still reports `expired` here - and the item it created still
     * appears in /inventory; the two facts are separate and this is the one
     * about the command.
     *
     * WHY THIS READ DOES NOT REQUIRE A DEVICE ROW. A dispatch is legal for a
     * device the backend has never met (it is often the command that brings
     * the device online), so the command history is keyed by the dev string,
     * exactly as dispatched. The 404 is kept for the genuinely empty case: no
     * command AND no device row means "this device does not exist yet on
     * either side", which is a different answer from "device known, nothing
     * dispatched for this uid" (an empty history).
     */
    commandStatus(dev, uid) {
      const parsed = uidField.safeParse(uid);
      if (!parsed.success) {
        throw new ApiError('bad_request', `uid must be 1-${MAX_UID_CHARS} hexadecimal characters (0-9, A-F)`);
      }
      const wanted = parsed.data;

      // Read-time resolution: overdue `dispatched` rows become `expired` before
      // they are listed, so the response is the truth the moment it is served.
      commandStore.expireOverdueForDevice(dev, nowEpoch());
      const rows = commandStore.listByUid(dev, wanted);

      if (rows.length === 0 && !store.getDevice(dev)) {
        throw new ApiError('unknown_device', `no snapshot has been received for device '${dev}'`);
      }

      const commands = rows.map((row) => ({
        // The server's row id; also the only stable order (cmd_seq advances per
        // dispatch, but a failed or retried command legitimately leaves gaps).
        id: row.id,
        op: row.op,
        uid: row.uid,
        cmd_seq: row.cmd_seq,
        expires_at_epoch: row.expires_at_epoch,
        expires_at: new Date(row.expires_at_epoch * 1000).toISOString(),
        dispatched_at: row.dispatched_at,
        status: row.status,
        confirmed_at: row.confirmed_at,
        failed_at: row.failed_at,
      }));

      return {
        dev,
        uid: wanted,
        // The latest command's state. Null when nothing was ever dispatched:
        // there is no fact to report, so no state is invented.
        state: commands[0]?.status ?? null,
        count: commands.length,
        commands,
      };
    },

    alerts(dev) {
      const device = requireDevice(dev);
      const active = store.listInventory(device.id, { includeRetired: false });
      const conditions = joinAcks(deriveActiveConditions(device, active), store.listAcks(device.id));
      return { dev: device.dev, count: conditions.length, alerts: conditions };
    },

    acknowledge(dev, conditionKey, { acknowledged_by: acknowledgedBy = null, note = null } = {}) {
      const device = requireDevice(dev);
      const acknowledgedAt = now().toISOString();
      store.putAck({
        device_id: device.id,
        condition_key: conditionKey,
        acknowledged_at: acknowledgedAt,
        acknowledged_by: acknowledgedBy,
        note,
      });
      return { dev: device.dev, condition_key: conditionKey, acknowledged: true, acknowledged_at: acknowledgedAt };
    },

    unacknowledge(dev, conditionKey) {
      const device = requireDevice(dev);
      const result = store.deleteAck(device.id, conditionKey);
      if (result.changes === 0) {
        throw new ApiError('not_found', `condition '${conditionKey}' is not acknowledged`);
      }
      return { dev: device.dev, condition_key: conditionKey, acknowledged: false };
    },

    health() {
      return { status: 'ok', uptime_s: Math.round(process.uptime()) };
    },

    ready() {
      db.prepare('SELECT 1').get();
      return { status: 'ready', migrations: db.prepare('SELECT COUNT(*) AS n FROM migration').get().n };
    },
  };
}
