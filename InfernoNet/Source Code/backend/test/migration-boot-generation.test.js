/**
 * Migration 005 (boot-scoped event dedupe) against a database that is shaped
 * like the one it was written for: a populated `event` table keyed the OLD way,
 * and a device whose counter has already wrapped once.
 *
 * The fixture below reproduces the incident rather than an empty schema - four
 * rows, event ids 1-4, a device fourteen reboots in - so what is asserted here
 * is the case the migration exists for: the rows that are already stored must
 * survive verbatim, and the events arriving afterwards must stop colliding with
 * them the moment the migration lands.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../src/db/index.js';
import { createIngestService } from '../src/ingest/service.js';
import { eventFixture, scanEventFixture, snapshotFixture } from '../src/ingest/fixtures.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));
/** The file under test; everything sorted before it is "the schema before". */
const FIX = '005_boot_generation.sql';
/** Every file the schema-before setup does NOT apply: the fix and anything that has landed since. */
const PENDING = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql') && name >= FIX)
  .sort();
const AT = '2026-09-28T00:00:00.000Z';

/** The four rows the live table held when the bug was diagnosed. */
const INCIDENT_ROWS = [
  { event_id: 1, type: 'temperature_high' },
  { event_id: 2, type: 'temperature_high' },
  { event_id: 3, type: 'door_open' },
  { event_id: 4, type: 'gas_relative_high' },
];

/**
 * A database at schema 004 - exactly what a production database looks like the
 * instant before 005 runs.
 *
 * Built file by file, in order, each recorded in the ledger, so the migrate()
 * call inside the tests applies ONLY the new file and reports it. `migrate:
 * false` on open is what makes that possible: migrate() would apply 005 too.
 * The ledger table is recreated with the DDL db/index.js uses, for the same
 * reason and with the same shape - it has to be there for migrate() to record
 * what it does, and it has to not already contain 005.
 */
function openPreFixDatabase() {
  const db = openDatabase({ path: ':memory:', migrate: false });
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
  const record = db.prepare('INSERT INTO migration (name, applied_at) VALUES (?, ?)');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql') && name < FIX)
    .sort();
  const apply = db.transaction(() => {
    for (const name of files) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
      record.run(name, AT);
    }
  });
  apply();
  return db;
}

function seedIncident(db) {
  // The device exactly as the live one reports it: 420 snapshots into its
  // fifteenth boot, mid-reflash, counter restarted.
  db.prepare(`
    INSERT INTO device (
      id, dev, contract_version, first_seen_at, last_ingest_at, time_valid,
      seq, uptime_s, boot_count, inv_revision, full, zone_status, overall_status,
      confirmed_fault_mask, availability_mask
    ) VALUES (1, 'fg-01', 1, ?, ?, 1, 420, 4030, 14, 1, 1, 0, 0, 0, 0)
  `).run(AT, AT);

  const insert = db.prepare(`
    INSERT INTO event (id, device_id, event_id, type, message, event_epoch, time_valid, received_at)
    VALUES (?, 1, ?, ?, ?, 1735689600, 1, ?)
  `);
  INCIDENT_ROWS.forEach((row, index) => {
    insert.run(index + 1, row.event_id, row.type, `${row.type} (pre-reflash)`, AT);
  });
}

/** The columns migration 001 gave the table, for before/after comparison. */
const originalColumns = (rows) =>
  rows.map((row) => ({
    id: row.id,
    device_id: row.device_id,
    event_id: row.event_id,
    type: row.type,
    message: row.message,
    event_epoch: row.event_epoch,
    time_valid: row.time_valid,
    received_at: row.received_at,
    uid: row.uid,
  }));

describe('migration 005: boot-scoped event dedupe', () => {
  it('preserves every pre-existing event row as generation 0 and re-keys the table', () => {
    const db = openPreFixDatabase();
    seedIncident(db);
    const before = db.prepare('SELECT * FROM event ORDER BY id').all();

    expect(migrate(db)).toEqual(PENDING);

    const after = db.prepare('SELECT * FROM event ORDER BY id').all();
    expect(after).toHaveLength(4);
    // Verbatim: same ids, same rows, same history - the only difference is the
    // generation column, and every one of them sits in 0, the bucket reserved
    // for rows written before boot-scoped dedupe existed.
    expect(originalColumns(after)).toEqual(originalColumns(before));
    expect(after.map((row) => row.boot_generation)).toEqual([0, 0, 0, 0]);

    // The device that owns them moves to generation 1 in the same migration, so
    // its next snapshot writes somewhere those four rows cannot be mistaken for
    // duplicates of - however high its own counter has climbed.
    expect(db.prepare('SELECT boot_seq FROM device').get().boot_seq).toBe(1);

    // The dedupe key is the triple, not the pair: this is the constraint that
    // used to swallow a post-reflash event_id.
    const unique = db.pragma("index_list('event')").find((index) => index.origin === 'u');
    expect(unique).toBeTruthy();
    expect(db.pragma(`index_info('${unique.name}')`).map((column) => column.name)).toEqual([
      'device_id',
      'boot_generation',
      'event_id',
    ]);
  });

  it('accepts a device counter reset from the very first snapshot after the migration', () => {
    const db = openPreFixDatabase();
    seedIncident(db);
    migrate(db);

    // The live shape of the bug: the device's own counter is back at 1, 2, 3 and
    // the types are new. Against the old key all three of these are IGNOREd
    // inserts, the device is told 200, and the queue is popped.
    const ingest = createIngestService({ db, now: () => new Date(AT) });
    const outcome = ingest.applySnapshot(
      'fg-01',
      snapshotFixture({
        seq: 421,
        uptime: 4040,
        events: [
          eventFixture({ event_id: 1, type: 'door_open', message: 'Storage door remained open beyond the prototype timeout' }),
          scanEventFixture({ event_id: 2, uid: '1778F106' }),
          scanEventFixture({ event_id: 3, uid: '06B11206' }),
        ],
      }),
    );
    expect(outcome.events).toEqual({ received: 3, inserted: 3, duplicates: 0 });

    const rows = db.prepare('SELECT boot_generation, event_id, type FROM event ORDER BY id').all();
    expect(rows).toHaveLength(7);
    expect(rows.slice(0, 4).map((row) => row.boot_generation)).toEqual([0, 0, 0, 0]);
    expect(rows.slice(4).map((row) => `${row.boot_generation}:${row.event_id}`)).toEqual(['1:1', '1:2', '1:3']);

    // Idempotent the way every migration here is: a second run applies nothing,
    // rewrites nothing, and re-backfills nothing.
    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM event').get().n).toBe(7);
  });
});
