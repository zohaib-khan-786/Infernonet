-- Administrator-configured thresholds.
--
-- This is deliberately NOT the same thing as device.thresholds_json. That column
-- records the limits the DEVICE compiled in and is actually applying; this table
-- records what an administrator has CONFIGURED. Keeping them apart matters for
-- two reasons:
--
--   1. Single authority. The device is the sole authority for a freshness
--      verdict. Admin limits are distributed TO the device, which then applies
--      them in its own logic and reports the verdict. The backend never
--      recomputes a status from these rows, because a second opinion computed
--      here could disagree with the device and would be exactly the override
--      the design forbids.
--
--   2. Provenance. A value edited by a human and a value baked into firmware
--      have very different evidentiary weight. `source` records which is which
--      and is surfaced verbatim in the API, so a dashboard can never present a
--      prototype assumption as a configured food-safety limit.
--
-- scope 'zone' applies to a shared storage zone. scope 'item' would allow a
-- per-container override for a specific food category; it is defined now so
-- the schema does not have to change when the Food Threshold Matrix is filled
-- in per category, but nothing writes it yet.

CREATE TABLE threshold_profile (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  dev                   TEXT    NOT NULL,
  scope                 TEXT    NOT NULL CHECK (scope IN ('zone', 'item')),
  temperature_min_c     REAL,
  temperature_max_c     REAL,
  humidity_min_pct      REAL,
  humidity_max_pct      REAL,
  gas_delta_abnormal_mv REAL,
  gas_delta_clear_mv    REAL,
  use_soon_percent      REAL,
  door_timeout_ms       INTEGER,
  source                TEXT    NOT NULL
                        CHECK (source IN ('authoritative', 'prototype_assumption')),
  reference             TEXT,
  note                  TEXT,
  changed_by            TEXT,
  changed_at            TEXT    NOT NULL,
  revision              INTEGER NOT NULL DEFAULT 1,
  UNIQUE (dev, scope)
);

CREATE INDEX idx_threshold_profile_dev ON threshold_profile(dev);

-- Which threshold_profile revision the device is actually applying, reported on
-- each snapshot. Without it a device that has not yet fetched an update is
-- indistinguishable from one that has: the operator would see the configured
-- limits and reasonably assume they are in force. Comparing the configured
-- revision against this one makes "the new limits are saved but the device has
-- not picked them up yet" a visible state rather than a silent divergence.
ALTER TABLE device ADD COLUMN thresholds_rev INTEGER;

-- Append-only history of every change. The current values live in
-- threshold_profile; this answers "who changed the temperature limit, when, and
-- what was it before", which a single mutable row cannot. Thresholds directly
-- determine whether food is flagged, so the trail is part of the record rather
-- than a convenience.
CREATE TABLE threshold_change (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dev         TEXT    NOT NULL,
  scope       TEXT    NOT NULL,
  revision    INTEGER NOT NULL,
  changed_by  TEXT,
  changed_at  TEXT    NOT NULL,
  before_json TEXT,
  after_json  TEXT    NOT NULL,
  note        TEXT
);

CREATE INDEX idx_threshold_change_dev ON threshold_change(dev, scope, revision);
