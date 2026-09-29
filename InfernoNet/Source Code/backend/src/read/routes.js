/**
 * Read routes: the surface the dashboard uses, and the SSE stream.
 *
 * CORS is applied here and only here. The allowlist comes from
 * `FG_CORS_ORIGINS` and is never `*`: the read API exposes inventory, food
 * verdicts and the alert history, and an open allowlist would leak all of it to
 * any page a user visits.
 */
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ApiError } from '../ingest/errors.js';
import { MAX_UID_CHARS, devPathParam, uidField } from '../ingest/contract.js';
import { adminAuth, ADMIN_PRINCIPAL } from '../middleware/admin-auth.js';
import { thresholdBody } from './thresholds.js';
import { itemRegisterBody } from './item-registration.js';

const conditionKeyParam = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9:_.-]+$/, 'may contain letters, digits, colon, underscore, dot and dash only');

const ackBody = z
  .object({
    acknowledged_by: z.string().max(64).optional(),
    note: z.string().max(280).optional(),
  })
  .strict();

function rateLimitHandler(req, res) {
  res.status(429).json({
    error: { code: 'rate_limited', message: 'too many requests; slow down', request_id: req.id },
  });
}

function makeLimiter({ limit, windowMs, keyGenerator }) {
  return rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator, handler: rateLimitHandler });
}

/**
 * The body size limit for the authenticated admin writes.
 *
 * A registration is a dozen short fields and a threshold profile is a handful of
 * numbers; neither has any business near a kilobyte. A generous cap still bounds
 * what an authenticated caller can make the server buffer, and the
 * `{ request_id }` envelope below turns an oversized body into a 413 rather than
 * a 500.
 */
const ADMIN_BODY_LIMIT = '8kb';
const jsonMediaType = ['application/json', 'application/*+json'];

/**
 * Health and readiness live at the server root, not under /api/v1: an
 * orchestrator or load balancer probes `/healthz`, and a readiness probe that
 * shares a path prefix with the versioned API is one rename away from being
 * probed in the wrong place.
 */
export function createHealthRouter({ read }) {
  const router = express.Router();
  const probe = (handler) => (_req, res, next) => {
    try {
      res.json(handler());
    } catch (error) {
      next(error);
    }
  };
  router.get('/healthz', probe(() => read.health()));
  router.get('/readyz', probe(() => read.ready()));
  return router;
}

export function createReadRouter({ config, read, hub, logger, thresholds, itemRegistration }) {
  if (!thresholds) throw new TypeError('createReadRouter requires the threshold service');
  if (!thresholds.view) {
    // The view assembles configured values, the device-reported values and the
    // agreement between them. It lives on the service object rather than in the
    // route so the SSE frame and the REST response cannot drift apart.
    throw new TypeError('threshold service must expose view()');
  }
  if (!itemRegistration || typeof itemRegistration.dispatch !== 'function') {
    // Required for the same reason as the threshold service: the route must not
    // be able to reach a dispatch that does not exist, or to fall back to
    // writing an item row itself.
    throw new TypeError('createReadRouter requires the item registration service');
  }
  const router = express.Router();

  const origins = config.corsOrigins;
  router.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser callers send no Origin header.
        if (!origin) return callback(null, true);
        callback(null, origins.includes(origin));
      },
      // PUT is listed because the threshold write is a PUT, and Authorization is
      // listed because that write now requires a bearer token. Both were missing,
      // which meant a browser could not complete the preflight for an
      // authenticated write from the dashboard's origin at all: the request
      // would have been blocked before the token was ever checked, and the
      // failure would have looked like a server problem rather than a CORS one.
      //
      // This is a browser-side gate, not the access control. It constrains which
      // page a browser will issue the request from; it does nothing against curl
      // or a device on the network. The origin allowlist is still exact-match and
      // never a wildcard, and the token is what actually authorises the write.
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  const readLimiter = makeLimiter({ limit: config.readRateLimit, windowMs: config.readRateWindowMs });
  const writeLimiter = makeLimiter({ limit: config.writeRateLimit, windowMs: config.writeRateWindowMs });

  // Guards the mutating admin routes below. Reads, SSE and every device-facing
  // route are deliberately left outside it; see the exemption notes on
  // /devices/:dev/thresholds/apply and /stream for why each one cannot carry a
  // credential.
  const requireAdmin = adminAuth({ adminToken: config.adminToken });

  const load = (handler) => (req, res, next) => {
    try {
      handler(req, res);
    } catch (error) {
      next(error);
    }
  };

  router.get('/devices', readLimiter, load((_req, res) => res.json({ devices: read.listDevices() })));

  router.get('/devices/:dev/current', readLimiter, load((req, res) => res.json(read.current(req.params.dev))));

  router.get(
    '/devices/:dev/readings',
    readLimiter,
    load((req, res) =>
      res.json(
        read.readings(req.params.dev, {
          from: req.query.from,
          to: req.query.to,
          bucket: req.query.bucket,
          fields: typeof req.query.fields === 'string' ? req.query.fields.split(',').map((f) => f.trim()).filter(Boolean) : undefined,
        }),
      ),
    ),
  );

  router.get(
    '/devices/:dev/inventory',
    readLimiter,
    load((req, res) =>
      res.json(read.inventory(req.params.dev, { includeRetired: req.query.retired === 'true' })),
    ),
  );

  router.get('/devices/:dev/inventory/export.csv', readLimiter, (req, res, next) => {
    try {
      const { csv, count } = read.inventoryCsv(req.params.dev);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="freshguard-${req.params.dev}-inventory.csv"`);
      res.setHeader('X-Row-Count', String(count));
      res.send(csv);
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------------
  // Identify one item from its unique id.
  //
  // SRS L105-108 / L157 / L305-308: identification is MANDATORY, and it is
  // mandatory through a unique identification id on a label, not through any one
  // piece of hardware. L542 lists QR or RFID tracking as optional. So the
  // parameter is a uid and the route says `uid`: a reader that presents a tag,
  // and a camera that reads a printed code, produce the same string and call this
  // same endpoint. No `rfid`, `tag`, `scan` or `qr` appears in the path, the
  // response keys, or the failure codes - and a second reader-specific route must
  // not be added later, because the whole point is that there is one lookup.
  //
  // Four answers, and the operator's next step differs for each:
  //   400 bad_request  the value is not a uid
  //   200              found and in service, with the item and its freshness
  //   409 uid_retired  registered once, withdrawn from service; `error.context`
  //                    carries when, and the revision it happened at
  //   404 unknown_uid  never registered on this device
  //
  // A retired tag is emphatically NOT "not found": a tag withdrawn from service
  // and a tag that was never registered are different answers to the same
  // question, and only the 404/409 split lets a caller tell them apart by code
  // rather than by reading prose.
  //
  // REGISTERED AFTER `/inventory/export.csv` ON PURPOSE. Express matches in
  // registration order and `:uid` would otherwise bind to the literal string
  // "export.csv", turning the CSV download into a 400 on a malformed uid. The
  // existing export tests are what would catch it, but the ordering is called
  // out here so a future route insert does not undo it silently.
  //
  // Read-only, so it sits with the other reads: no admin credential, the same
  // read rate limit, and the same CORS allowlist. It exposes no more than
  // `/inventory` already does - one item that was already in that list.
  // -------------------------------------------------------------------------
  router.get('/devices/:dev/inventory/:uid', readLimiter, (req, res, next) => {
    try {
      // The uid is checked here as well as in the service, so a malformed value
      // is a 400 that names the rule rather than a generic 400 about "shape".
      const parsed = uidField.safeParse(req.params.uid);
      if (!parsed.success) {
        throw new ApiError('bad_request', `uid must be 1-${MAX_UID_CHARS} hexadecimal characters (0-9, A-F)`);
      }
      res.json(read.itemByUid(req.params.dev, parsed.data));
    } catch (error) {
      next(toApiError(error));
    }
  });

  // -------------------------------------------------------------------------
  // Resolve one dispatch: the status of every `item.register` command sent to
  // a device for one uid.
  //
  // The POST /devices/:dev/items answer is `state: "dispatched"` on purpose -
  // the device has not confirmed anything yet. THIS route is how that resolves:
  // it reports dispatched / confirmed / expired / failed for the latest
  // command (and the whole history under `commands`), so the dashboard can move
  // a registration out of "awaiting the device" the moment the device echoes
  // the item back in a snapshot, or tell the operator why it never will.
  //
  // UNAUTHENTICATED, LIKE EVERY OTHER READ ON THIS ROUTER. It is read-only, it
  // exposes no more than the operator's own dispatch already recorded - the
  // same device, the same uid, the same sequence numbers - and the read API's
  // rule is that GETs never carry the admin token (a token in a GET belongs in
  // a query string, in a log line and in a Referer header, which is where it
  // leaks). The writes that matter stay behind requireAdmin; this is not one
  // of them.
  //
  // The expiry is resolved READ-TIME: the first status read after a command's
  // window closes answers `expired`, with no background job in the process.
  // See read/service.js commandStatus for the full reasoning.
  // -------------------------------------------------------------------------
  router.get('/devices/:dev/commands/:uid', readLimiter, (req, res, next) => {
    try {
      const parsed = uidField.safeParse(req.params.uid);
      if (!parsed.success) {
        throw new ApiError('bad_request', `uid must be 1-${MAX_UID_CHARS} hexadecimal characters (0-9, A-F)`);
      }
      res.json(read.commandStatus(req.params.dev, parsed.data));
    } catch (error) {
      next(toApiError(error));
    }
  });

  router.get(
    '/devices/:dev/events',
    readLimiter,
    load((req, res) => res.json(read.events(req.params.dev, { limit: req.query.limit, before: req.query.before }))),
  );

  router.get('/devices/:dev/alerts', readLimiter, load((req, res) => res.json(read.alerts(req.params.dev))));

  // -------------------------------------------------------------------------
  // The freshness document, standalone.
  //
  // `/current` and `/inventory` both carry it, so this route is not the only way
  // to get it. It exists because the document is self-contained - one cabinet,
  // every item, two evidence layers, provenance, clock trust and the
  // non-certification disclaimer - and a consumer that wants the whole picture
  // should not have to reassemble it from three responses that could have been
  // computed at different instants.
  //
  // Unauthenticated, like every other read on this router. It is read-only,
  // accepts no input, and the ingest credential is what protects the writes.
  // -------------------------------------------------------------------------
  router.get('/devices/:dev/freshness', readLimiter, load((req, res) => res.json(read.freshness(req.params.dev))));

  const ackJson = express.json({ limit: '8kb', strict: true, type: ['application/json', 'application/*+json'] });

  router.post(
    '/devices/:dev/alerts/:conditionKey/ack',
    writeLimiter,
    ackJson,
    (req, res, next) => {
      try {
        const conditionKey = conditionKeyParam.parse(req.params.conditionKey);
        const body = ackBody.parse(req.body ?? {});
        res.json(read.acknowledge(req.params.dev, conditionKey, body));
      } catch (error) {
        next(toApiError(error));
      }
    },
  );

  router.delete('/devices/:dev/alerts/:conditionKey/ack', writeLimiter, (req, res, next) => {
    try {
      res.json(read.unacknowledge(req.params.dev, conditionKeyParam.parse(req.params.conditionKey)));
    } catch (error) {
      next(toApiError(error));
    }
  });

  // -------------------------------------------------------------------------
  // Administrator-configured thresholds (SRS requirement xii).
  //
  // GET returns the configured values, the values the device says it is
  // actually applying, and whether the two agree. PUT writes a new revision and
  // records the change. Neither recomputes a freshness status: the device
  // fetches the values, applies them in its own logic and remains the sole
  // authority for the verdict.
  //
  // This route rewrites the limits the hardware enforces, so unlike every other
  // route on this router it requires `Authorization: Bearer <FG_ADMIN_TOKEN>`.
  // It is the only route here that is authenticated, and that is a property of
  // this specific path, not of the router: adding auth at `router.use` level
  // would take the read API, the device projection and the event stream down
  // with it.
  // -------------------------------------------------------------------------
  router.get('/devices/:dev/thresholds', readLimiter, (req, res, next) => {
    try {
      res.json(thresholds.view(req.params.dev, typeof req.query.scope === 'string' ? req.query.scope : 'zone'));
    } catch (error) {
      next(toApiError(error));
    }
  });

  router.put(
    '/devices/:dev/thresholds',
    // Order matters and it is the opposite of the ingest route's. The rate
    // limiter runs FIRST so a guessed token cannot obtain unlimited attempts:
    // a brute-force defence that sits behind the check it is defending is not a
    // defence. The cost is that unauthenticated traffic also spends the write
    // budget, so a flood can lock out a legitimate operator for a window. That
    // is the deliberate trade - a temporary denial of service to an admin is a
    // better failure than an unauthenticated endpoint that decides when food is
    // spoiled. Note the limiter is keyed on IP, never on the credential, so
    // presenting a different wrong token does not buy a fresh budget either.
    writeLimiter,
    requireAdmin,
    // The read router carries no body parser by default, because every other
    // route on it is a GET. The authenticated admin writes need one; without it
    // req.body is undefined and the validation error reads as "expected object,
    // received undefined", which says nothing useful to whoever is configuring
    // limits or registering an item.
    express.json({ limit: ADMIN_BODY_LIMIT, strict: true, type: jsonMediaType }),
    (req, res, next) => {
      try {
        if (!req.is(['application/json', 'application/*+json'])) {
          throw new ApiError('unsupported_media_type', 'Content-Type must be application/json');
        }
        const parsed = thresholdBody.safeParse(req.body);
        if (!parsed.success) throw toApiError(parsed.error);
        // `changed_by` stays caller-supplied free text: the request body is the
        // shared contract with the dashboard and dropping the field would break
        // it. It is a self-declared LABEL, not an identity - a single shared
        // bearer token cannot tell one operator from another. What the backend
        // does guarantee is that the row is never unattributed, and that this
        // route was only reachable with a valid token; the access log holds the
        // matching request id and client IP.
        //
        // `||` rather than `??` so an explicitly empty string is treated as "no
        // label given" too: the audit trail must not be able to hold a row that
        // claims to be from nobody.
        const input = {
          ...parsed.data,
          changed_by: parsed.data.changed_by || ADMIN_PRINCIPAL,
        };
        res.json(thresholds.set(req.params.dev, input));
      } catch (error) {
        next(toApiError(error));
      }
    },
  );

  // -------------------------------------------------------------------------
  // EXEMPT FROM AUTHENTICATION - the device-facing threshold projection.
  //
  // The ESP8266 fetches this with a plain GET. It has no credential to present,
  // no facility for one, and requiring one would not fail loudly: it would fail
  // SILENTLY, leaving the hardware enforcing its compiled-in defaults (rev 0)
  // while the dashboard showed a configured profile as though it were in force.
  // That is the exact failure this whole subsystem exists to prevent, and it is
  // invisible from the server side.
  //
  // The retained-MQTT push is the primary distribution path and was proven
  // end-to-end: the device applies a revision from the broker within one loop.
  // This GET is the recovery path for a device that missed the retained message
  // or was flashed with a build that predates it. Protecting it would leave that
  // recovery path unavailable exactly when it is needed.
  //
  // Exposing it unauthenticated is an accepted, bounded risk: it reveals the
  // configured limits and the revision, and it accepts no input, so it cannot
  // change anything. Read-only disclosure of food-safety limits to a device on
  // the same LAN is a far smaller exposure than a writable endpoint being
  // writable by that same LAN. Do NOT add auth to this route.
  // -------------------------------------------------------------------------
  // Flat, purpose-built projection for the device. See thresholds.forDevice for
  // why the device does not read the same document the dashboard does.
  router.get('/devices/:dev/thresholds/apply', readLimiter, (req, res, next) => {
    try {
      const scope = typeof req.query.scope === 'string' ? req.query.scope : 'zone';
      res.json(thresholds.forDevice(req.params.dev, scope));
    } catch (error) {
      next(toApiError(error));
    }
  });

  router.get('/devices/:dev/thresholds/history', readLimiter, (req, res, next) => {
    try {
      const scope = typeof req.query.scope === 'string' ? req.query.scope : 'zone';
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      res.json({ dev: req.params.dev, scope, changes: thresholds.history(req.params.dev, scope, limit) });
    } catch (error) {
      next(toApiError(error));
    }
  });

  // -------------------------------------------------------------------------
  // Administrator item registration.
  //
  // THE CONTRACT, IN ONE PARAGRAPH: the backend dispatches a command and the
  // device creates the item. This handler writes NOTHING to inventory_item, and
  // it must never be "improved" into doing so. An item's store date, exposure
  // and verdict are the device's to decide; a row authored here would be a
  // second source of truth for all three, and the one on the dashboard would be
  // the one nobody debugs. The row appears when the device echoes the item back
  // in its next snapshot, through the same ingest path that already upserts
  // every item. The response says `state: "dispatched"` for the same reason: the
  // device has not confirmed anything yet.
  //
  // Since migration 006 the dispatch itself IS durable - one `admin_command`
  // row per attempt, confirmed when an accepted snapshot carries the uid and
  // resolved to expired/failed otherwise. The GET /devices/:dev/commands/:uid
  // route below is how a client watches that resolution; this route remains the
  // only way a command is ever created, and it still cannot touch an item row.
  //
  // The full reasoning, including why a disconnected transport is 503 and not
  // 200, is in src/read/item-registration.js.
  //
  // It requires the same `Authorization: Bearer <FG_ADMIN_TOKEN>` as the
  // threshold PUT and uses the same `requireAdmin` instance - this is a mutating
  // admin route and a second auth implementation would be a second set of
  // failure modes. Order is identical too: limiter first, then auth, then the
  // body parser, for the same reason (a brute-force defence behind the check it
  // defends is not a defence).
  // -------------------------------------------------------------------------
  router.post(
    '/devices/:dev/items',
    writeLimiter,
    requireAdmin,
    express.json({ limit: ADMIN_BODY_LIMIT, strict: true, type: jsonMediaType }),
    async (req, res, next) => {
      try {
        if (!req.is(jsonMediaType)) {
          throw new ApiError('unsupported_media_type', 'Content-Type must be application/json');
        }

        // The device id becomes a topic segment, so it is validated with the
        // same schema the ingest route uses for its path parameter. An
        // unvalidated path segment is a request to publish onto somebody else's
        // topic; a bad one is a 400 before anything is sent.
        const dev = devPathParam.parse(req.params.dev);

        const parsed = itemRegisterBody.safeParse(req.body);
        if (!parsed.success) {
          // Field paths and codes only, never the submitted values. `name`,
          // `category`, `quantity` and `location` are operator free text that
          // can carry anything up to its cap (and the cap check is exactly what
          // failed), so a rejected body is never reproduced into the log.
          logger?.warn?.('item.register rejected by validation', {
            dev: req.params.dev,
            request_id: req.id,
            fields: parsed.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', code: issue.code })),
          });
          throw toApiError(parsed.error);
        }

        // Logs the dispatch at info, and turns a transport refusal into the 503
        // the operator has to be able to trust. It cannot report success for a
        // command that did not leave the process: the service has no datastore,
        // and a publish that is not confirmed by the client is an error rather
        // than a result.
        const result = await itemRegistration.dispatch(dev, parsed.data, { requestId: req.id });
        res.json(result);
      } catch (error) {
        next(toApiError(error));
      }
    },
  );

  // -------------------------------------------------------------------------
  // EXEMPT FROM AUTHENTICATION - the SSE stream.
  //
  // The browser's `EventSource` cannot send an `Authorization` header. The
  // WHATWG spec gives it exactly one request option, `withCredentials`, and no
  // way to set request headers, so a protected `/stream` would be unreachable
  // from every dashboard client: the connection would 401, `EventSource` would
  // retry silently on its own timer, and live updates would simply never appear.
  // A hardcoded token in the query string is not an alternative - URLs land in
  // proxy logs, browser history and `Referer` headers, which leaks the admin
  // credential to get live temperature readings.
  //
  // The stream is read-only and pushes device state the same public LAN surface
  // as the rest of the read API. The distinction that matters is write access:
  // this route cannot change a threshold, and the one route that can is
  // authenticated. Do NOT add auth to this route without also replacing
  // `EventSource` with a client that can send headers.
  // -------------------------------------------------------------------------
  // SSE. Compression is filtered off this path in app.js; a buffered or
  // gzipped event stream stalls every client behind the compressor.
  router.get('/stream', readLimiter, (req, res) => {
    const dev = typeof req.query.dev === 'string' ? req.query.dev : null;
    const client = hub.attach(req, res);
    logger?.info?.('sse client opened', { request_id: req.id, device: dev, clients: hub.clientCount });

    let payload;
    try {
      payload = dev === null ? { devices: read.listDevices() } : read.current(dev);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unknown_device') {
        res.write(`event: error\ndata: ${JSON.stringify({ code: error.code, message: error.message })}\n\n`);
        res.end();
        return;
      }
      throw error;
    }
    // The opening frame is not recorded in the replay ring: a reconnecting
    // client always gets a fresh snapshot as its first frame.
    client.send(dev === null ? 'devices' : 'snapshot', payload, { replay: false });
  });

  // -------------------------------------------------------------------------
  // Body-parser failures on the authenticated admin writes.
  //
  // `express.json` throws BEFORE the route handler runs when a body is malformed
  // or over the limit, so these errors never reach the handler above. Without
  // this translation they fall through to the terminal handler, which reports
  // them as 500 `internal` - which is both wrong and, on these two routes,
  // actively misleading: a 500 from the item-registration endpoint is
  // indistinguishable from a dispatch that half-worked, and the operator's only
  // correct response to an ambiguous 503 is to retry. A client sending
  // truncated JSON gets a 400 and knows nothing was dispatched.
  //
  // Placed last on the router so it sees errors from the body parsers above.
  // Error middleware only catches errors from what is registered before it, and
  // this one is narrow: two body-parser `type` values and SyntaxError, matched on
  // identity rather than by message. Anything else is passed on untouched, so no
  // unrelated failure can be disguised as a bad request.
  // -------------------------------------------------------------------------
  router.use((err, _req, _res, next) => {
    if (err?.type === 'entity.too.large') {
      next(new ApiError('body_too_large', `request body exceeds the ${ADMIN_BODY_LIMIT} limit`));
      return;
    }
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      next(new ApiError('bad_request', 'request body is not valid JSON'));
      return;
    }
    next(err);
  });

  return router;
}

function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof z.ZodError) {
    return new ApiError('bad_request', 'request does not match the expected shape', {
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })),
    });
  }
  return error;
}
