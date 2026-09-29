-- Durable admin commands: one row per dispatch plus the per-device sequence
-- that makes retrying them safe.
--
-- THE HOLE THIS CLOSES. Until this file the backend had no record of a
-- dispatched command. POST /devices/:dev/items published `item.register` to the
-- broker, answered `state: "dispatched"`, and that was the end of the fact: no
-- table, no confirmation, nothing a dashboard could poll, and no way to tell a
-- command that reached the device from one that was lost when the broker died a
-- moment later. The firmware now keeps `lastAppliedCmdSeq` and ignores commands
-- whose `cmd_seq` is not above it, so the server both can and must track what it
-- has sent. Two tables, and the second exists for a specific reason:
--
--  1. `admin_command` is the trace: who, what, at what sequence, valid until
--     when, and which of four states the command has reached.
--
--  2. `device_command_counter` is the durable source of `cmd_seq`.
--
-- WHY THE SEQUENCE LIVES IN A TABLE. The firmware dedupes on `cmd_seq`
-- (uint32, strictly increasing per device) and treats a command with NO
-- sequence the way it always did, so the sequence is the one field that must
-- never be handed out twice and must never go backwards. A counter held in the
-- process would restart at 1 on every deploy. A device that had already applied
-- seq 5 would then ignore commands 1-5 as replays - a restart would silence the
-- admin surface until the counter climbed past what the device had seen - and a
-- restarted counter would collide with the UNIQUE (dev, cmd_seq) rows that
-- already exist. Persisting the counter and recording its allocation in the SAME
-- transaction (see command-store.js) makes a sequence number a property of the
-- database: it survives a backend restart by definition, is never reused, and a
-- failed dispatch (503, recorded as `failed`) simply leaves a gap the device
-- never sees. The counter is SQLite INTEGER and the wire field is uint32; the
-- only ceiling that matters is the device's, and a deployment that outlives
-- four billion registrations per cabinet is not one this schema needs to plan
-- around.
--
-- WHY NO FOREIGN KEY TO device(id). A dispatch is legal for a device the
-- backend has never met - the command is often what brings the device online -
-- so `dev` is stored TEXT exactly as dispatched. The device row remains the
-- record of what the device REPORTED; `admin_command` is the record of what the
-- backend was TOLD. Indexing by (dev, status) serves the expiry sweep and a
-- per-device listing; (dev, uid) serves the status lookup.
--
-- WHY `expires_at_epoch`. The device refuses an expired command, and the status
-- read resolves a `dispatched` command to `expired` once its window passes, so
-- a registration that never resolves cannot sit as "dispatched" forever. The
-- TTL itself is the server's choice at dispatch time (COMMAND_TTL_SECONDS in
-- item-registration.js); this table only stores the boundary it chose. Note the
-- boundary is separate from "the device applied it": a command the device DID
-- apply past its window still shows `expired` here, and the item it created
-- still appears in /inventory - the two are different facts and are reported
-- separately.
--
-- IDEMPOTENCY is the migration ledger's job, not this file's: db/index.js
-- applies each numbered file exactly once, in filename order, inside a
-- transaction, and records it in the `migration` table. This file is therefore
-- a bare set of statements, the same shape 001-005 use.

-- The per-device counter. One row per device the backend has ever dispatched
-- to; `last_seq` is the last sequence handed out, bumped by the same statement
-- that allocates the next one.
CREATE TABLE device_command_counter (
  dev      TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL
);

CREATE TABLE admin_command (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  dev              TEXT    NOT NULL,
  op               TEXT    NOT NULL,
  uid              TEXT    NOT NULL,
  cmd_seq          INTEGER NOT NULL,
  expires_at_epoch INTEGER NOT NULL,
  dispatched_at    TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'dispatched'
                    CHECK (status IN ('dispatched', 'confirmed', 'expired', 'failed')),
  confirmed_at     TEXT,
  failed_at        TEXT,
  -- The device dedicates by sequence, so the server cannot hand the same
  -- sequence to two commands on one device. The counter makes that allocation
  -- impossible; the constraint makes it a database fact.
  UNIQUE (dev, cmd_seq)
);

-- The expiry sweep ("give me every dispatched command of this device whose
-- window has passed") and the chronological listing both seek on this pair.
CREATE INDEX idx_admin_command_dev_status ON admin_command(dev, status);

-- The status lookup is (dev, uid), newest first by row id.
CREATE INDEX idx_admin_command_dev_uid ON admin_command(dev, uid);