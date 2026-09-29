-- FreshGuard backend, migration 001: initial schema.
--
-- Two rules govern this schema:
--   1. The device is authoritative. Every status, mask, sequence number and
--      per-item verdict is stored exactly as reported and is never recomputed
--      here. Columns are named after what the device said, not after what we
--      concluded from it.
--   2. `null` means "the device did not have this value". It is never coerced
--      into a sentinel number.

CREATE TABLE device (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  dev                  TEXT    NOT NULL UNIQUE,
  contract_version     INTEGER NOT NULL,
  first_seen_at        TEXT    NOT NULL,
  last_ingest_at       TEXT    NOT NULL,
  reported_at          TEXT,
  time_valid           INTEGER NOT NULL,
  seq                  INTEGER NOT NULL,
  uptime_s             INTEGER NOT NULL,
  boot_count           INTEGER NOT NULL,
  inv_revision         INTEGER NOT NULL,
  pending_count        INTEGER,
  full                 INTEGER NOT NULL,
  zone_status          INTEGER NOT NULL,
  overall_status       INTEGER NOT NULL,
  confirmed_fault_mask INTEGER NOT NULL,
  availability_mask    INTEGER NOT NULL,
  door_open            INTEGER,
  door_stale           INTEGER,
  gas_state            TEXT,
  firmware             TEXT,
  door_timeout_ms      INTEGER,
  consecutive_samples  INTEGER,
  thresholds_json      TEXT,
  provenance_json      TEXT
);

CREATE INDEX idx_device_last_ingest ON device(last_ingest_at);

CREATE TABLE reading (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     INTEGER NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  recorded_at   TEXT    NOT NULL, -- server receipt time of an accepted snapshot
  reported_at   TEXT,             -- device clock, only when time_valid
  time_valid    INTEGER NOT NULL,
  seq           INTEGER NOT NULL,
  temperature_c REAL,             -- NULL = unavailable, never a sentinel
  humidity_pct  REAL,
  pressure_hpa  REAL,
  gas_input_mv  REAL,
  gas_delta_mv  REAL
);

CREATE INDEX idx_reading_device_recorded ON reading(device_id, recorded_at);
CREATE INDEX idx_reading_recorded ON reading(recorded_at);

CREATE TABLE inventory_item (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id           INTEGER NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  uid                 TEXT    NOT NULL,
  name                TEXT,
  category            TEXT,
  quantity            TEXT,
  location            TEXT,
  store_date_epoch    INTEGER,
  expiry_epoch        INTEGER,
  duration_limit_days INTEGER,
  status_code         INTEGER,     -- the device's own per-item verdict
  first_revision      INTEGER NOT NULL,
  last_revision       INTEGER NOT NULL,
  retired             INTEGER NOT NULL DEFAULT 0,
  retired_at_revision INTEGER,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  UNIQUE (device_id, uid)
);

CREATE INDEX idx_inventory_device_active ON inventory_item(device_id, retired);

CREATE TABLE event (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    INTEGER NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  event_id     INTEGER NOT NULL,
  type         TEXT    NOT NULL,
  message      TEXT    NOT NULL,
  event_epoch  INTEGER,            -- device clock, only when time_valid
  time_valid   INTEGER NOT NULL,
  received_at  TEXT    NOT NULL,
  UNIQUE (device_id, event_id)
);

CREATE INDEX idx_event_device_id ON event(device_id, event_id);
CREATE INDEX idx_event_received ON event(received_at);

-- Dashboard-side acknowledgements. These never reach the device: the firmware
-- has no acknowledgement path, and inventing one would be a lie.
CREATE TABLE condition_ack (
  device_id       INTEGER NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  condition_key   TEXT    NOT NULL,
  acknowledged_at TEXT    NOT NULL,
  acknowledged_by TEXT,
  note            TEXT,
  PRIMARY KEY (device_id, condition_key)
);
