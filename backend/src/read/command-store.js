/**
 * The durable record of dispatched admin commands.
 *
 * WHAT THIS IS. `inventory_item` stays the device's to write - this module
 * exists for the OTHER table migration 006 added: `admin_command`, the trace of
 * every `item.register` dispatch, and `device_command_counter`, the durable
 * source of `cmd_seq`. The rule every caller depends on is the one that shaped
 * the schema: the sequence is allocated in the SAME transaction that records
 * the command, so a number is never handed out twice, never moves backwards and
 * never outlives the row it belongs to.
 *
 * WHAT THIS IS NOT. A command queue. Nothing here redelivers a failed or
 * expired command; the operator retries, the transport answers 503 when a
 * dispatch fails, and `item.register` stays safe to retry because the device
 * is idempotent on uid. The store's job is to make "what happened to my
 * command" answerable: dispatched / confirmed / expired / failed.
 *
 * THE FOUR STATES, AND WHO MOVES THEM:
 *   dispatched  every recorded dispatch starts here (transactional alloc)
 *   confirmed   the ingest path, when an accepted snapshot carries the uid
 *               (see ingest/service.js - idempotent: only dispatched -> confirmed)
 *   expired     the status read, when the command's window has passed
 *               (read-time sweep - see read/service.js commandStatus)
 *   failed      the dispatch path, when the transport refused the publish and
 *               the operator was answered 503
 *
 * `confirmed_at` / `failed_at` carry the server clock at the transition; both
 * stay NULL on the row while it is merely dispatched, so a null timestamp is
 * unambiguous: the command is still waiting.
 *
 * Every method is synchronous and thin - prepared statements over the same
 * better-sqlite3 handle the ingest path already uses, which is what lets the
 * confirmation UPDATE join the snapshot transaction instead of opening a second
 * writer.
 */
export const COMMAND_STATUS = Object.freeze({
  dispatched: 'dispatched',
  confirmed: 'confirmed',
  expired: 'expired',
  failed: 'failed',
});

export function createCommandStore(db) {
  const q = {
    // One upsert allocates: a new device starts at 1, an existing one moves
    // one step up, and the statement returns the value it chose. `ON CONFLICT`
    // with an explicit update means SQLite can never raise the "no rows to
    // update" problem of INSERT OR NOTHING + separate UPDATE.
    nextSeq: db.prepare(`
      INSERT INTO device_command_counter (dev, last_seq)
      VALUES (?, 1)
      ON CONFLICT (dev) DO UPDATE SET last_seq = device_command_counter.last_seq + 1
      RETURNING last_seq
    `),
    insertCommand: db.prepare(`
      INSERT INTO admin_command (dev, op, uid, cmd_seq, expires_at_epoch, dispatched_at, status)
      VALUES (@dev, @op, @uid, @cmd_seq, @expires_at_epoch, @dispatched_at, @status)
    `),
    // Only a dispatched row may be confirmed or failed. A row that already
    // reached confirmed/expired/failed is a settled fact; re-marking it would
    // be rewriting history, and the changes count returning 0 is what makes
    // re-marking observably a no-op rather than silently moving a timestamp.
    confirmOne: db.prepare(`
      UPDATE admin_command
         SET status = 'confirmed', confirmed_at = @at
       WHERE dev = @dev AND uid = @uid AND status = 'dispatched'
    `),
    markFailed: db.prepare(`
      UPDATE admin_command
         SET status = 'failed', failed_at = @at
       WHERE id = @id AND status = 'dispatched'
    `),
    expireForDevice: db.prepare(`
      UPDATE admin_command
         SET status = 'expired'
       WHERE dev = @dev AND status = 'dispatched' AND expires_at_epoch <= @now_epoch
    `),
    listByUid: db.prepare(`
      SELECT * FROM admin_command
       WHERE dev = ? AND uid = ?
       ORDER BY id DESC
       LIMIT 100
    `),
    getByDevUidSeq: db.prepare(
      'SELECT * FROM admin_command WHERE dev = ? AND uid = ? AND cmd_seq = ?',
    ),
  };

  const recordDispatch = db.transaction(({ dev, op, uid, dispatched_at, expires_at_epoch }) => {
    const { last_seq: cmdSeq } = q.nextSeq.get(dev);
    const result = q.insertCommand.run({
      dev,
      op,
      uid,
      cmd_seq: cmdSeq,
      expires_at_epoch,
      dispatched_at,
      status: COMMAND_STATUS.dispatched,
    });
    return { id: Number(result.lastInsertRowid), cmd_seq: cmdSeq, expires_at_epoch };
  });

  return {
    /** The four state strings, exported so callers never type them. */
    status: COMMAND_STATUS,

    /**
     * Allocate a sequence and record the dispatch, atomically.
     *
     * Returns `{ id, cmd_seq, expires_at_epoch }` - the row id for later
     * transitions and the sequence for the wire command. Throws on a broken
     * datastore; the dispatch route lets that surface as a 500 rather than
     * pretending a command went out.
     */
    recordDispatch,

    /**
     * Confirm every still-dispatched command of a device whose uid appears in
     * an accepted snapshot. Returns how many rows actually transitioned.
     *
     * Idempotent by construction: a uid confirmed once stays confirmed, and a
     * replayed snapshot re-running this changes nothing. Runs as plain UPDATEs
     * so it can join whatever transaction the caller is already inside.
     */
    confirmByUids(dev, uids, at) {
      let confirmed = 0;
      for (const uid of uids) {
        confirmed += q.confirmOne.run({ dev, uid, at }).changes;
      }
      return confirmed;
    },

    /** Mark a dispatch failed (the transport refused it). No-op once settled. */
    markFailed(id, at) {
      return q.markFailed.run({ id, at }).changes;
    },

    /**
     * Resolve every dispatched command of a device whose window has passed to
     * `expired`. Returns how many rows transitioned.
     *
     * Called read-time (commandStatus) rather than on a timer: the only
     * consumer of the expired state is the status read, and a read that first
     * resolves what it is about to report keeps the transition right in front
     * of the query that needs it - no background writer, no chron job, no
     * second interval to test.
     */
    expireOverdueForDevice(dev, nowEpochSeconds) {
      return q.expireForDevice.run({ dev, now_epoch: nowEpochSeconds }).changes;
    },

    /** Newest first, by row id (insertion order per command). */
    listByUid(dev, uid) {
      return q.listByUid.all(dev, uid);
    },

    /** For tests that want to assert on one exact dispatch. */
    getByDevUidSeq(dev, uid, cmdSeq) {
      return q.getByDevUidSeq.get(dev, uid, cmdSeq) ?? null;
    },
  };
}