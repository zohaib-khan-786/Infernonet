/**
 * Migrations: forward-only SQL files applied in filename order, each inside its
 * own transaction, each recorded in the `migration` table.
 *
 * The module's whole interface is `migrate(db)`. It is idempotent, so it runs
 * unconditionally on every boot and on every test database creation.
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export function migrate(db, { logger } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(db.prepare('SELECT name FROM migration').all().map((row) => row.name));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const record = db.prepare('INSERT INTO migration (name, applied_at) VALUES (?, ?)');
  const executed = [];

  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(name, new Date().toISOString());
    })();
    executed.push(name);
    logger?.info?.('migration applied', { migration: name });
  }

  return executed;
}

/**
 * Open a FreshGuard database with the pragmas the service depends on, and run
 * migrations unless asked not to.
 *
 * Interface: `openDatabase({ path, migrate, readonly, logger }) -> Database`
 * (a better-sqlite3 handle, with `.close()`). Everything else in the codebase
 * speaks plain SQL against this handle, so swapping the driver later is a
 * change to this file alone.
 */
export function openDatabase({ path, migrate: shouldMigrate = true, readonly = false, logger } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { readonly });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  if (shouldMigrate) migrate(db, { logger });
  return db;
}
