-- Boot-scoped event dedupe: the generation the server maintains, and the key
-- events are now deduplicated on.
--
-- THE BUG THIS CLOSES. `event_id` is a counter the DEVICE owns. It is persisted
-- in the LittleFS alert-queue header so it normally survives a reboot - but it
-- restarts at 1 whenever that file is recreated, which is what a firmware
-- reflash does. The server meanwhile still holds rows from before the reflash,
-- carrying the same `(device_id, event_id)` values for events of a DIFFERENT
-- type. `INSERT OR IGNORE` against `UNIQUE (device_id, event_id)` then reads a
-- genuinely new alert as a duplicate of an old one and drops it silently: the
-- device still gets its 2xx, still pops the event from its queue, and the record
-- is gone forever. The drain looks healthy while nothing is stored - which is
-- how a table can be left standing with four rows after hours of continuous
-- alerts. Scoping the key to a boot fixes that without changing the MEANING of
-- `event_id`, which stays exactly what the firmware says it is: a counter that
-- runs within one boot.
--
-- WHERE THE GENERATION COMES FROM. The snapshot carries no boot identity:
-- `uptime` and `seq` both restart with the boot, `epoch` and `time_source`
-- describe the clock rather than the boot, and `event_id` is the counter that is
-- failing. The one signal the ingest path already trusts is uptime going
-- BACKWARDS - `classify()` has read that as a reboot since the schema was first
-- written - so the generation advances on exactly that signal, computed inside
-- the same transaction that writes the events. Nothing about it lives in the
-- application's memory, which is why a backend restart mid-boot cannot open a
-- generation it did not earn.
--
-- WHY TWO COLUMNS, NEITHER OF THEM `boot_count`. `device.boot_seq` is the
-- generation the CURRENT boot is on; `event.boot_generation` is the value
-- `boot_seq` held when that row was written, so an event's key is frozen at
-- insert time and never follows a later reboot. They are deliberately not
-- `device.boot_count`, which is a different number with a different job:
-- `boot_count` is reported to an operator as "how many reboots this server has
-- seen", and data identity must not move when a display value does - least of
-- all if a future firmware ever REPORTS a boot count the server adopts, which
-- could make that column jump or go backwards. A dedupe generation has to be
-- monotone, persisted and server-owned; `boot_seq` is exactly that, and keeping
-- it separate means the API's boot counter can be reinterpreted without
-- re-keying the event history.
--
-- WHY THE TABLE IS REBUILT. `UNIQUE (device_id, event_id)` is a table
-- constraint from migration 001, and SQLite has no `ALTER` that changes a
-- constraint, so the table is copied around the new key - the same
-- forward-only, numbered-file shape every migration here uses, inside the one
-- transaction db/index.js already wraps each file in. The copy is verbatim:
-- ids, device ids, timestamps, messages, uids and the generation column come
-- across unchanged, so every existing row keeps its identity and its position
-- in the history, and a failure partway through leaves the old table intact
-- because the whole file is one transaction.
--
-- THE BACKFILL, AND WHY IT IS SAFE ON A POPULATED TABLE. The event column is
-- added with DEFAULT 0, so every row that exists at this moment becomes
-- generation 0 - "recorded before boot-scoped dedupe existed" - with no second
-- statement and no row rewritten by hand. The device column is added with
-- DEFAULT 1, so a device that already exists moves to generation 1 in the same
-- statement: its OLD rows sit at 0, its next snapshot writes at 1, and the two
-- can never collide no matter how high the device's own counter has climbed.
-- 0 is never assigned again after this file runs - the ingest service starts a
-- brand-new device at 1 as well (FIRST_BOOT_SEQ in ingest/service.js), so a
-- generation-0 row can only be one that predates this change. That 0/1 split is
-- the whole safety argument: the rows currently in this table survive verbatim
-- at 0, everything written from now on lands at 1 or above.
--
-- IDEMPOTENCY is the migration ledger's job, not this file's: db/index.js
-- applies each numbered file exactly once, in filename order, inside a
-- transaction, and records it in the `migration` table. This file is therefore
-- a bare set of statements, the same shape 001-004 use; SQLite has no
-- `ADD COLUMN IF NOT EXISTS`, and writing one by hand would risk diverging from
-- the file the ledger already knows about.

-- Existing device rows pick up 1 (the DEFAULT) as they are read: generation 1
-- is the boot those devices are in right now, and their backfilled rows are at
-- 0. New devices are inserted with an explicit boot_seq of 1 by the ingest
-- service, so the DEFAULT is what moves the rows that already exist.
ALTER TABLE device ADD COLUMN boot_seq INTEGER NOT NULL DEFAULT 1;

-- Existing event rows pick up 0: the backfill is the DEFAULT itself, because
-- "every row written before this migration" is the one fact that needs no
-- per-row judgment - the migration cannot know which boot an old row belongs
-- to, and does not need to. 0 is a bucket, not a claim about the boot.
ALTER TABLE event ADD COLUMN boot_generation INTEGER NOT NULL DEFAULT 0;

CREATE TABLE event_boot_scoped (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id       INTEGER NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  boot_generation INTEGER NOT NULL,
  event_id        INTEGER NOT NULL,
  type            TEXT    NOT NULL,
  message         TEXT    NOT NULL,
  event_epoch     INTEGER,            -- device clock, only when time_valid
  time_valid      INTEGER NOT NULL,
  received_at     TEXT    NOT NULL,
  uid             TEXT,
  -- The new dedupe key. A device counter reset in a later boot lands in a
  -- different generation, so it can never be read as a duplicate of an earlier
  -- boot's row - and the pair of columns either side of it still does the work
  -- they did before: the whole row for one boot, exactly once.
  UNIQUE (device_id, boot_generation, event_id)
);

-- Every column is named on both sides of the copy so the statement states what
-- is preserved, and so a column added by a LATER migration cannot be silently
-- dragged into this one by a `SELECT *`.
INSERT INTO event_boot_scoped (
  id, device_id, boot_generation, event_id, type, message,
  event_epoch, time_valid, received_at, uid
)
SELECT
  id, device_id, boot_generation, event_id, type, message,
  event_epoch, time_valid, received_at, uid
FROM event;

DROP TABLE event;

ALTER TABLE event_boot_scoped RENAME TO event;

-- 001's `idx_event_device_id (device_id, event_id)` went out with the table it
-- was created for, and it is not recreated in that shape: event_id is ordered
-- only WITHIN a boot now, so it cannot serve the one read this table has. The
-- events listing takes one device's rows newest-first under an optional row-id
-- cursor, which is a backward seek on exactly the two columns below. Without it
-- the listing would sort a device's whole history on every request. Event-id
-- lookups, when anybody wants one, go through the unique index above.
CREATE INDEX idx_event_device_row ON event(device_id, id);

-- Recreated as 001 had them: receipt time for anything that orders by when the
-- server heard it, and the tag index 004 added for "which tags has this device
-- ever read".
CREATE INDEX idx_event_received ON event(received_at);
CREATE INDEX idx_event_device_uid ON event(device_id, uid);
