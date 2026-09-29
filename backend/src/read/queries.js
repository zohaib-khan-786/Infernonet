/**
 * Read-side queries. All statements are prepared once at construction.
 *
 * Interface: `createReadStore(db)` -> `{ listDevices, getDevice, getLatestReading,
 * listInventory, getInventoryByUid, countReadings, readRawReadings,
 * readBucketedReadings, listEvents, listAcks, putAck, deleteAck }`.
 *
 * Nothing here interprets the data. Interpretation lives in `projections.js`,
 * which is pure, so the SQL and the domain reasoning can each be tested alone.
 */
export const READING_FIELDS = [
  'temperature_c',
  'humidity_pct',
  'pressure_hpa',
  'gas_input_mv',
  'gas_delta_mv',
];

export const BUCKETS = {
  raw: null,
  '1m': 60,
  '5m': 300,
  '1h': 3600,
};

export const BUCKET_ORDER = ['raw', '1m', '5m', '1h'];

export function createReadStore(db) {
  const statements = {
    listDevices: db.prepare(`
      SELECT d.*,
             (SELECT COUNT(*) FROM inventory_item i WHERE i.device_id = d.id AND i.retired = 0) AS inventory_active,
             (SELECT COUNT(*) FROM inventory_item i WHERE i.device_id = d.id AND i.retired = 1) AS inventory_retired,
             (SELECT COUNT(*) FROM event e WHERE e.device_id = d.id) AS event_count
        FROM device d
       ORDER BY d.dev
    `),
    getDevice: db.prepare('SELECT * FROM device WHERE dev = ?'),
    getDeviceById: db.prepare('SELECT * FROM device WHERE id = ?'),
    latestReading: db.prepare(`
      SELECT * FROM reading WHERE device_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1
    `),
    activeInventory: db.prepare(`
      SELECT * FROM inventory_item
       WHERE device_id = ? AND retired = 0
       ORDER BY name, uid
    `),
    allInventory: db.prepare(`
      SELECT * FROM inventory_item WHERE device_id = ? ORDER BY retired, name, uid
    `),
    // The identification lookup. Retired rows are included on purpose: whether a
    // tag is in service is a question the CALLER has to be told, not one this
    // query may answer by omission. Hiding retired rows here would collapse
    // "withdrawn from service" into "never registered", which are different
    // answers with different operator actions.
    //
    // Served by `UNIQUE (device_id, uid)` from migration 001, so this is a single
    // index seek and cannot return more than one row.
    inventoryByUid: db.prepare('SELECT * FROM inventory_item WHERE device_id = ? AND uid = ?'),
    countReadings: db.prepare(
      'SELECT COUNT(*) AS n FROM reading WHERE device_id = ? AND recorded_at >= ? AND recorded_at < ?',
    ),
    // The event history: one device's rows, newest first, optionally everything
    // older than a cursor.
    //
    // Sort AND cursor are the ROW ID, not `event_id`, and that is a consequence
    // of migration 005 rather than a style choice. `event_id` is the device's own
    // per-boot counter: unique within a boot and restarting at 1 in the next one,
    // so ordering a device's whole history by it interleaves boots, and a
    // `before` cursor taken from it SKIPS every row whose event_id collides
    // across a reboot - rows that are in the table and can never be paged to,
    // which is a quieter version of the data loss the boot-scoped key exists to
    // prevent. The row id is AUTOINCREMENT: strictly increasing as rows arrive,
    // never reused, indifferent to any device counter, so "newest first, then
    // everything older than this one" is a total order on it. Each row still
    // reports the `event_id` the device assigned; only the ordering follows the
    // server's own monotone sequence. `next_before` therefore hands back a row
    // id, and it is meant to be passed straight back as `before`.
    listEvents: db.prepare(`
      SELECT * FROM event
       WHERE device_id = @device_id
         AND (@before_id IS NULL OR id < @before_id)
       ORDER BY id DESC
       LIMIT @limit
    `),
    countEvents: db.prepare('SELECT COUNT(*) AS n FROM event WHERE device_id = ?'),
    listAcks: db.prepare('SELECT * FROM condition_ack WHERE device_id = ?'),
    putAck: db.prepare(`
      INSERT INTO condition_ack (device_id, condition_key, acknowledged_at, acknowledged_by, note)
      VALUES (@device_id, @condition_key, @acknowledged_at, @acknowledged_by, @note)
      ON CONFLICT (device_id, condition_key) DO UPDATE SET
        acknowledged_at = excluded.acknowledged_at,
        acknowledged_by = excluded.acknowledged_by,
        note = excluded.note
    `),
    deleteAck: db.prepare(
      'DELETE FROM condition_ack WHERE device_id = ? AND condition_key = ?',
    ),
  };

  // Aggregation is built from a fixed whitelist of column names; no request
  // value is ever concatenated into SQL.
  const rawColumns = READING_FIELDS.map((field) => `r.${field}`).join(', ');
  const avgColumns = READING_FIELDS.map((field) => `AVG(r.${field}) AS ${field}`).join(', ');

  const readRawReadings = db.prepare(`
    SELECT r.recorded_at, r.reported_at, r.time_valid, r.seq, ${rawColumns}
      FROM reading r
     WHERE r.device_id = @device_id AND r.recorded_at >= @from AND r.recorded_at < @to
     ORDER BY r.recorded_at, r.id
  `);

  // AVG ignores NULLs, so a bucket with no available sample in a field stays
  // NULL. That is the whole point: an aggregated gap must not become a number.
  const readBucketedReadings = db.prepare(`
    SELECT CAST(strftime('%s', r.recorded_at) / @bucket_seconds AS INTEGER) * @bucket_seconds AS bucket_epoch,
           MIN(r.time_valid) AS time_valid,
           COUNT(*) AS samples,
           ${avgColumns}
      FROM reading r
     WHERE r.device_id = @device_id AND r.recorded_at >= @from AND r.recorded_at < @to
     GROUP BY bucket_epoch
     ORDER BY bucket_epoch
  `);

  return {
    READING_FIELDS,
    BUCKETS,
    BUCKET_ORDER,
    listDevices: () => statements.listDevices.all(),
    getDevice: (dev) => statements.getDevice.get(dev) ?? null,
    getDeviceById: (id) => statements.getDeviceById.get(id) ?? null,
    getLatestReading: (deviceId) => statements.latestReading.get(deviceId) ?? null,
    listInventory: (deviceId, { includeRetired = false } = {}) =>
      (includeRetired ? statements.allInventory : statements.activeInventory).all(deviceId),
    getInventoryByUid: (deviceId, uid) => statements.inventoryByUid.get(deviceId, uid) ?? null,
    countReadings: (deviceId, from, to) => statements.countReadings.get(deviceId, from, to).n,
    countEvents: (deviceId) => statements.countEvents.get(deviceId).n,
    readRawReadings: (args) => readRawReadings.all(args),
    readBucketedReadings: (args) => readBucketedReadings.all(args),
    listEvents: (args) => statements.listEvents.all(args),
    listAcks: (deviceId) => statements.listAcks.all(deviceId),
    putAck: (args) => statements.putAck.run(args),
    deleteAck: (deviceId, conditionKey) => statements.deleteAck.run(deviceId, conditionKey),
  };
}
