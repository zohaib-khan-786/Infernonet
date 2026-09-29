/**
 * Ingest route.
 *
 * Contract-visible behaviour, in order: credential present and correct (401),
 * JSON content type (415), body within `FG_BODY_LIMIT_BYTES` (413), rate limit
 * (429), then contract validation (400 / `invalid_snapshot` or `unknown_key`).
 * The success path is always 200, whether the snapshot was stored or recognised
 * as a replay, because a replay is a normal outcome of at-least-once delivery
 * and not something the device should react to by backing off hard.
 *
 * Dependencies: config, the ingest service, a projection function that returns
 * the dashboard aggregate for a device, and the SSE hub.
 */
import express from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { ApiError, fromZodError } from './errors.js';
import { devPathParam, snapshotSchema } from './contract.js';
import { deviceAuth } from '../middleware/auth.js';

const jsonMediaType = ['application/json', 'application/*+json'];

function rateLimitHandler(req, res) {
  res.status(429).json({
    error: { code: 'rate_limited', message: 'too many ingest requests; slow down', request_id: req.id },
  });
}

export function createIngestRouter({ config, ingest, currentView, hub, logger }) {
  const router = express.Router();

  const limiter = rateLimit({
    windowMs: config.ingestRateWindowMs,
    limit: config.ingestRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Keyed on IP and device id, never on the credential: a wrong key must not
    // be able to buy a fresh budget. `ipKeyGenerator` normalises IPv6 to a
    // /64 subnet so a single host cannot rotate through its address space.
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.params.dev}`,
    handler: rateLimitHandler,
  });

  // No CORS on this router. A device is not a browser origin, and allowing
  // cross-origin POSTs here would hand anyone a replay primitive.
  router.post(
    '/devices/:dev/snapshots',
    deviceAuth({ ingestKeySha256: config.ingestKeySha256 }),
    limiter,
    express.json({ limit: config.bodyLimitBytes, strict: true, type: jsonMediaType }),
    (req, res, next) => {
      try {
        req.deviceId = devPathParam.parse(req.params.dev);
      } catch {
        next(new ApiError('invalid_snapshot', 'device id in the path is not a valid identifier'));
        return;
      }
      if (!req.is(jsonMediaType)) {
        next(new ApiError('unsupported_media_type', 'Content-Type must be application/json'));
        return;
      }
      if (req.body === undefined) {
        next(new ApiError('invalid_snapshot', 'request body is empty or not valid JSON'));
        return;
      }

      const parsed = snapshotSchema.safeParse(req.body);
      if (!parsed.success) {
        next(fromZodError(parsed.error));
        return;
      }

      let outcome;
      try {
        outcome = ingest.applySnapshot(req.deviceId, parsed.data);
      } catch (error) {
        next(error);
        return;
      }

      res.status(200).json({
        ok: true,
        outcome: outcome.outcome,
        reason: outcome.reason,
        reboot: outcome.reboot,
        device: req.deviceId,
        seq: outcome.seq,
        uptime_s: outcome.uptime_s,
        boot_count: outcome.boot_count,
        inv_revision: outcome.inv_revision,
        inventory_active: outcome.inventory_active,
        events: outcome.events,
        contract_version: parsed.data.v,
        // The server's own clock, in unix seconds, at the instant this snapshot
        // was recorded. The device reads this as its time fallback when its own
        // DS3231 is not trusted, and reports which source it used in
        // `time_source` on the next snapshot. It is the only path by which the
        // two clocks meet: a device with a stopped oscillator cannot learn the
        // time from itself, and an MQTT-delivered snapshot gets no response at
        // all, so it falls back to its monotonic offset instead.
        server_time_epoch: outcome.server_time_epoch,
        note: 'idempotent state projection only; the device alert queue is neither acknowledged nor modified',
      });

      if (outcome.outcome === 'stored') {
        let payload = null;
        try {
          payload = currentView(req.deviceId);
        } catch {
          payload = null; // A projection failure must not fail an accepted ingest.
        }
        const clients = payload ? hub.publish(req.deviceId, payload) : 0;
        logger?.info?.('snapshot stored', {
          request_id: req.id,
          device: req.deviceId,
          seq: parsed.data.seq,
          uptime_s: parsed.data.uptime,
          reboot: outcome.reboot,
          events: outcome.events.inserted,
          sse_clients: clients,
        });
      }
    },
  );

  // express.json throws before the handler runs for an oversized or malformed
  // body; translate both into the contract's own error codes.
  router.use((err, _req, _res, next) => {
    if (err?.type === 'entity.too.large') {
      next(new ApiError('body_too_large', `snapshot exceeds the ${config.bodyLimitBytes}-byte limit`));
      return;
    }
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      next(new ApiError('invalid_snapshot', 'request body is not valid JSON'));
      return;
    }
    next(err);
  });

  return router;
}
