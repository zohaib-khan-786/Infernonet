/**
 * Reading retention: readings roll, events are a permanent record.
 */
import { describe, expect, it } from 'vitest';
import { pruneReadings, startRetentionJob } from '../src/retention/prune.js';
import { insertReadings, makeTestStack } from './helpers.js';
import { eventFixture, snapshotFixture } from '../src/ingest/fixtures.js';

const readingCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM reading').get().n;
const eventCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM event').get().n;

describe('retention', () => {
  it('prunes readings older than the retention window and keeps the rest', async () => {
    const { db, post, clock } = makeTestStack();
    const now = new Date('2025-06-01T00:00:00.000Z');
    clock.set(now.toISOString());
    await post('fg-01', snapshotFixture({ events: [eventFixture({ event_id: 1 })] })).expect(200);

    insertReadings({ db }, { count: 1, startIso: '2025-05-01T12:00:00.000Z' }); // inside 30 days
    insertReadings({ db }, { count: 1, startIso: '2024-01-01T00:00:00.000Z' }); // well outside
    insertReadings({ db }, { count: 1, startIso: '2020-06-01T00:00:00.000Z' }); // well outside
    expect(readingCount(db)).toBe(4); // one from the snapshot, three inserted

    const result = pruneReadings(db, { retentionDays: 30, now });
    expect(result.cutoff).toBe('2025-05-02T00:00:00.000Z');
    expect(result.deleted).toBe(3);
    expect(readingCount(db)).toBe(1);
    // Events are the record of what happened; they are never pruned.
    expect(eventCount(db)).toBe(1);
  });

  it('is a no-op when nothing is old enough', async () => {
    const { db, post, clock } = makeTestStack();
    clock.set('2025-06-01T00:00:00.000Z');
    await post('fg-01', snapshotFixture()).expect(200);
    const result = pruneReadings(db, { retentionDays: 30, now: new Date('2025-06-01T00:01:00.000Z') });
    expect(result.deleted).toBe(0);
    expect(readingCount(db)).toBe(1);
  });

  it('honours a longer retention window', async () => {
    const { db, post, clock } = makeTestStack();
    clock.set('2025-06-01T00:00:00.000Z');
    await post('fg-01', snapshotFixture()).expect(200);
    insertReadings({ db }, { count: 1, startIso: '2024-06-01T00:00:00.000Z' });

    pruneReadings(db, { retentionDays: 30, now: new Date('2025-06-01T00:00:00.000Z') });
    expect(readingCount(db)).toBe(1); // only the fresh snapshot reading survives

    insertReadings({ db }, { count: 1, startIso: '2025-05-15T00:00:00.000Z' });
    pruneReadings(db, { retentionDays: 365, now: new Date('2025-06-01T00:00:00.000Z') });
    expect(readingCount(db)).toBe(2);
  });

  it('runs on demand and reports a failure instead of throwing into the timer', async () => {
    const { db, post, clock } = makeTestStack();
    clock.set('2025-06-01T00:00:00.000Z');
    await post('fg-01', snapshotFixture()).expect(200);
    insertReadings({ db }, { count: 1, startIso: '2020-01-01T00:00:00.000Z' });

    const config = { readingRetentionDays: 30, retentionIntervalMs: 60_000 };
    const logs = [];
    const logger = {
      info: (msg, fields) => logs.push(['info', msg, fields]),
      error: (msg, fields) => logs.push(['error', msg, fields]),
      warn: () => {},
      debug: () => {},
    };

    const job = startRetentionJob({ db, config, logger, now: clock.now });
    const first = job.run();
    expect(first.cutoff).toBe('2025-05-02T00:00:00.000Z');
    expect(first.deleted).toBe(1);
    expect(logs.at(-1)).toEqual(['info', 'retention prune complete', first]);

    db.close();
    expect(job.run()).toBeNull();
    expect(logs.at(-1)[0]).toBe('error');
    job.stop();
  });
});
