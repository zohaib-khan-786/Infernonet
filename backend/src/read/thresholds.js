/**
 * Administrator-configured thresholds.
 *
 * SRS requirement (xii): "The administrator should be able to configure limits
 * for temperature, humidity, gas sensor readings, storage duration and
 * door-open time."
 *
 * Until this module existed those five limits were compile-time constants in the
 * firmware, so satisfying the requirement meant recompiling and reflashing to
 * change 8 degrees. They now live in the datastore with a full change history.
 *
 * THE ONE RULE THAT SHAPES THIS FILE:
 *
 * The device is the sole authority for a freshness verdict. These values are
 * distributed TO the device, which applies them in its own logic and reports the
 * resulting status. Nothing here ever computes, adjusts, overrides or softens a
 * status code. A second verdict computed from the same numbers could disagree
 * with the device - the thresholds here are a zone-level band while the device
 * also holds latches, debounce and the not-ready distinction - and a dashboard
 * showing a status the device never reported is precisely the failure the
 * single-authority rule exists to prevent.
 *
 * So the read side reports what was configured and what the device says it is
 * using, and leaves the reconciliation visible to the operator.
 */
import { z } from 'zod';
import { ApiError } from '../ingest/errors.js';
import { devPathParam } from '../ingest/contract.js';

export const THRESHOLD_SCOPE = z.enum(['zone', 'item']);

export const THRESHOLD_SOURCE = z.enum(['authoritative', 'prototype_assumption']);

/**
 * Cross-field validation is the whole point. Individually plausible numbers can
 * still be a configuration that would mislabel every item in the zone forever:
 * a max below the min, a gas clear threshold above its abnormal threshold, or a
 * use-soon window that can never be reached. These are rejected at write time
 * rather than discovered when a fridge full of food is wrongly flagged.
 */
export const thresholdBody = z
  .object({
    scope: THRESHOLD_SCOPE.default('zone'),
    temperature_min_c: z.number().min(-40).max(90).nullable().optional(),
    temperature_max_c: z.number().min(-40).max(90).nullable().optional(),
    humidity_min_pct: z.number().min(0).max(100).nullable().optional(),
    humidity_max_pct: z.number().min(0).max(100).nullable().optional(),
    gas_delta_abnormal_mv: z.number().min(0.1).max(10_000).nullable().optional(),
    gas_delta_clear_mv: z.number().min(0.1).max(10_000).nullable().optional(),
    use_soon_percent: z.number().min(1).max(100).nullable().optional(),
    door_timeout_ms: z.number().int().min(1_000).max(86_400_000).nullable().optional(),
    source: THRESHOLD_SOURCE,
    reference: z.string().max(400).optional(),
    note: z.string().max(400).optional(),
    changed_by: z.string().max(64).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const both = (a, b, label) => {
      if (a == null || b == null) return;
      if (a >= b) {
        ctx.addIssue({
          code: 'custom',
          path: [label],
          message: `${label} must be less than its maximum (${a} >= ${b})`,
        });
      }
    };
    both(value.temperature_min_c, value.temperature_max_c, 'temperature_min_c');
    both(value.humidity_min_pct, value.humidity_max_pct, 'humidity_min_pct');
    both(value.gas_delta_clear_mv, value.gas_delta_abnormal_mv, 'gas_delta_clear_mv');

    // A prototype assumption with no citation is the case the SRS specifically
    // warns about: values presented as if they were food-safety guidance. It is
    // permitted, but only when the caller states plainly that it is an
    // assumption.
    if (value.source === 'prototype_assumption' && !value.note) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message:
          'source=prototype_assumption requires a note explaining why these are not sourced values',
      });
    }
  });

const COLUMNS = [
  'temperature_min_c',
  'temperature_max_c',
  'humidity_min_pct',
  'humidity_max_pct',
  'gas_delta_abnormal_mv',
  'gas_delta_clear_mv',
  'use_soon_percent',
  'door_timeout_ms',
];

function rowToProfile(row) {
  if (!row) return null;
  const values = {};
  for (const column of COLUMNS) values[column] = row[column];
  return {
    dev: row.dev,
    scope: row.scope,
    revision: row.revision,
    values,
    source: row.source,
    reference: row.reference,
    note: row.note,
    changed_by: row.changed_by,
    changed_at: row.changed_at,
  };
}

export function createThresholdService({ db, now = () => new Date(), publishConfig, logger }) {
  const getStmt = db.prepare('SELECT * FROM threshold_profile WHERE dev = ? AND scope = ?');
  const listStmt = db.prepare('SELECT dev, scope FROM threshold_profile');
  const maxRevisionStmt = db.prepare(
    'SELECT COALESCE(MAX(revision), 0) AS r FROM threshold_profile WHERE dev = ? AND scope = ?',
  );
  const insertStmt = db.prepare(`
    INSERT INTO threshold_profile (
      dev, scope,
      temperature_min_c, temperature_max_c,
      humidity_min_pct, humidity_max_pct,
      gas_delta_abnormal_mv, gas_delta_clear_mv,
      use_soon_percent, door_timeout_ms,
      source, reference, note, changed_by, changed_at, revision
    ) VALUES (
      ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  const updateStmt = db.prepare(`
    UPDATE threshold_profile SET
      temperature_min_c = ?, temperature_max_c = ?,
      humidity_min_pct = ?, humidity_max_pct = ?,
      gas_delta_abnormal_mv = ?, gas_delta_clear_mv = ?,
      use_soon_percent = ?, door_timeout_ms = ?,
      source = ?, reference = ?, note = ?, changed_by = ?, changed_at = ?,
      revision = ?
    WHERE dev = ? AND scope = ?
  `);
  const insertChangeStmt = db.prepare(`
    INSERT INTO threshold_change (dev, scope, revision, changed_by, changed_at, before_json, after_json, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const historyStmt = db.prepare(
    'SELECT * FROM threshold_change WHERE dev = ? AND scope = ? ORDER BY revision DESC LIMIT ?',
  );
  const deviceStmt = db.prepare('SELECT thresholds_json, thresholds_rev FROM device WHERE dev = ?');

  return {
    get(dev, scope) {
      return rowToProfile(getStmt.get(dev, scope));
    },

    /**
     * Applies a configuration and records the before/after. The revision is
     * derived from the stored maximum rather than a counter, so a deleted row
     * cannot make revisions repeat and a restore of an old backup still
     * produces a monotonic history.
     */
    set(dev, input) {
      const scope = input.scope ?? 'zone';
      const existing = getStmt.get(dev, scope);
      const nextRevision = maxRevisionStmt.get(dev, scope).r + 1;
      const stamp = now().toISOString();
      const values = {};
      for (const column of COLUMNS) {
        // A field absent from the request keeps its stored value. Absent means
        // "not changing this limit", which is different from an explicit null
        // meaning "stop using this limit".
        values[column] = Object.hasOwn(input, column)
          ? input[column]
          : (existing?.[column] ?? null);
      }

      const apply = db.transaction(() => {
        if (existing) {
          updateStmt.run(
            values.temperature_min_c, values.temperature_max_c,
            values.humidity_min_pct, values.humidity_max_pct,
            values.gas_delta_abnormal_mv, values.gas_delta_clear_mv,
            values.use_soon_percent, values.door_timeout_ms,
            input.source, input.reference ?? null, input.note ?? null,
            input.changed_by ?? null, stamp, nextRevision, dev, scope,
          );
        } else {
          insertStmt.run(
            dev, scope,
            values.temperature_min_c, values.temperature_max_c,
            values.humidity_min_pct, values.humidity_max_pct,
            values.gas_delta_abnormal_mv, values.gas_delta_clear_mv,
            values.use_soon_percent, values.door_timeout_ms,
            input.source, input.reference ?? null, input.note ?? null,
            input.changed_by ?? null, stamp, nextRevision,
          );
        }
        insertChangeStmt.run(
          dev, scope, nextRevision, input.changed_by ?? null, stamp,
          existing ? JSON.stringify(rowToProfile(existing)) : null,
          JSON.stringify({ values, source: input.source }),
          input.note ?? null,
        );
      });
      apply();
      const saved = rowToProfile(getStmt.get(dev, scope));
      // Push to the device over the channel it already holds open.
      //
      // The device polls this over HTTP too, but HTTP needs its own inbound
      // port to be reachable, and on this network that port is filtered while
      // the broker is not. More importantly the broker connection is already
      // established and kept alive, so a threshold change reaches a running
      // device in milliseconds instead of at the next poll.
      //
      // Published as a RETAINED message: a device that is powered off, rebooted
      // or offline at the moment of the change receives the current profile the
      // instant it reconnects, with no catch-up mechanism needed. Without
      // retain, a device that missed the change would keep applying the
      // previous limits indefinitely and nothing would say so.
      this.publishToBroker(dev, scope);
      return saved;
    },

    history(dev, scope, limit = 50) {
      return db
        .prepare('SELECT * FROM threshold_change WHERE dev = ? AND scope = ? ORDER BY revision DESC LIMIT ?')
        .all(dev, scope, limit)
        .map((row) => ({
          revision: row.revision,
          changed_by: row.changed_by,
          changed_at: row.changed_at,
          before: row.before_json ? JSON.parse(row.before_json) : null,
          after: row.after_json ? JSON.parse(row.after_json) : null,
          note: row.note,
        }));
    },

    /**
     * What the device says it is actually applying, read from the last snapshot.
     */
    deviceReported(dev) {
      const row = deviceStmt.get(dev);
      if (!row) return null;
      let values = null;
      try {
        values = row.thresholds_json ? JSON.parse(row.thresholds_json) : null;
      } catch {
        values = null;
      }
      return { values, revision: row.thresholds_rev ?? null };
    },

    /**
     * The device-facing projection: flat, short keys, no nesting.
     *
     * The firmware parses JSON with a small bounded scanner rather than pulling
     * in a JSON library, which is the right trade at 93% IRAM. That parser has no
     * schema knowledge, so it cannot tell one "revision" from another in a nested
     * document - and this object contains several: the configured revision, the
     * revision the device last reported, and none at all when nothing is
     * configured. Guessing which one it found would be a silent wrong answer to
     * the only question that matters here, namely which limits are in force.
     *
     * So the device gets its own shape: one "rev", one number per limit, nothing
     * to disambiguate. A null limit means "not configured", and the device keeps
     * its compiled default for it.
     */
    /**
     * Re-publish every stored profile to the broker as retained.
     *
     * Called once the transport is up. A retained message only lives as long as
     * the broker does, so a restarted broker (or a fresh one against an
     * existing database) would leave every device on its built-in defaults
     * until an operator happened to save a profile again. The device is the
     * authority on what it is applying, so a silent loss of the configured
     * limits here would show up as a dashboard claiming rev 3 while the hardware
     * quietly enforces rev 0.
     */
    republishAll() {
      const rows = listStmt.all();
      for (const row of rows) {
        this.publishToBroker(row.dev, row.scope);
      }
      return rows.length;
    },

    /**
     * Single place the broker is told about a profile, so a save and a
     * republish-on-start cannot drift in how they report or handle a failure.
     */
    publishToBroker(dev, scope) {
      if (typeof publishConfig !== 'function') return false;
      try {
        publishConfig(dev, scope, this.forDevice(dev, scope));
        return true;
      } catch (error) {
        // A broker outage must not fail the write. The profile is stored and the
        // device will still pick it up by HTTP or at its next successful
        // reconnect, so this is logged rather than raised.
        logger?.warn?.('could not publish threshold profile to the broker; stored anyway', {
          dev,
          scope,
          error: error.message,
        });
        return false;
      }
    },

    forDevice(dev, scope = 'zone') {
      const row = getStmt.get(dev, scope);
      if (!row) return { rev: 0, configured: false, values: {} };
      return {
        rev: row.revision,
        configured: true,
        values: {
          tmin: row.temperature_min_c,
          tmax: row.temperature_max_c,
          hmin: row.humidity_min_pct,
          hmax: row.humidity_max_pct,
          gabn: row.gas_delta_abnormal_mv,
          gclr: row.gas_delta_clear_mv,
          usp: row.use_soon_percent,
          dtms: row.door_timeout_ms,
        },
      };
    },

    /**
     * The dashboard's single view: what was configured, what the device says it
     * is using, and whether they agree.
     *
     * `in_sync` is the point of the whole exercise. Saving new limits is not the
     * same as the device applying them - it has to fetch them on its next
     * connect. Without this, an operator who saved a change would reasonably
     * assume it was in force while the device silently kept using the old ones.
     *
     * `null` in_sync means the device does not report a revision at all, which
     * is the honest answer for a device build too old to carry one. It is
     * reported as unknown rather than as either true or false, because assuming
     * either would be a claim the backend cannot support.
     */
    view(dev, scope = 'zone') {
      const configured = rowToProfile(getStmt.get(dev, scope));
      const device = this.deviceReported(dev);
      let inSync = null;
      if (configured && device && device.revision != null) {
        inSync = configured.revision === device.revision;
      }
      return {
        dev,
        scope,
        configured,
        device_reported: device,
        in_sync: inSync,
        applied_by_device: device?.values ?? null,
        note:
          'configured values are distributed to the device; the device applies them '
          + 'and remains the sole authority for freshness status. This endpoint '
          + 'never computes a verdict.',
      };
    },
  };
}

export { devPathParam, ApiError };
