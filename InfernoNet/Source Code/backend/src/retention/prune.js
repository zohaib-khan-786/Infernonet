/**
 * Reading retention.
 *
 * Readings are a rolling time series; events are a record of what the device
 * told us happened and are kept indefinitely. Pruning is a single DELETE
 * driven by `recorded_at`, which is an index-backed range scan.
 *
 * Two entry points, one implementation: `pruneReadings(db, options)` for tests
 * and for the scheduled job, and this file as a CLI for a one-shot run
 * (`npm run prune`) so maintenance can happen without a restart.
 */
import process from 'node:process';
import { openDatabase } from '../db/index.js';
import { loadConfigOrExit } from '../config/index.js';
import { createLogger } from '../logger.js';

export function pruneReadings(db, { retentionDays = 30, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const cutoffIso = cutoff.toISOString();
  const result = db.prepare('DELETE FROM reading WHERE recorded_at < ?').run(cutoffIso);
  return { cutoff: cutoffIso, deleted: result.changes };
}

export function startRetentionJob({ db, config, logger, now = () => new Date(), prune = pruneReadings }) {
  const run = () => {
    try {
      const result = prune(db, { retentionDays: config.readingRetentionDays, now: now() });
      logger.info('retention prune complete', result);
      return result;
    } catch (error) {
      logger.error('retention prune failed', { error: error.message });
      return null;
    }
  };
  const timer = setInterval(run, config.retentionIntervalMs);
  timer.unref?.();
  return { run, stop: () => clearInterval(timer) };
}

if (import.meta.main) {
  const config = loadConfigOrExit();
  const logger = createLogger({ level: config.logLevel, name: 'freshguard.prune' });
  const db = openDatabase({ path: config.dbPath, logger });
  try {
    const result = pruneReadings(db, { retentionDays: config.readingRetentionDays });
    logger.info('prune finished', result);
  } finally {
    db.close();
  }
}
