/**
 * Request identity + access logging.
 *
 * Logging rules enforced here, because this is the only place that sees a
 * finished request:
 *   - the log line carries the *route pattern*, never the raw query string and
 *     never the path (which would embed a device id supplied by a caller);
 *   - headers are never logged, so `X-FreshGuard-Key` cannot leak;
 *   - request bodies are never logged.
 * The correlation id is taken from an inbound `X-Request-Id` when it is a short
 * safe token, otherwise generated, and is echoed on the response.
 */
import { randomBytes } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function requestId() {
  return (req, res, next) => {
    const inbound = req.get('x-request-id');
    const id = typeof inbound === 'string' && SAFE_ID.test(inbound) ? inbound : randomBytes(8).toString('hex');
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}

export function accessLog({ logger }) {
  return function accessLogMiddleware(req, res, next) {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const route = req.route?.path
        ? `${req.baseUrl ?? ''}${req.route.path}`
        : (req.baseUrl || req.path === '/' ? '/' : 'unmatched');
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level]('request', {
        request_id: req.id,
        method: req.method,
        route,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        bytes: Number(res.getHeader('content-length') ?? 0) || undefined,
        device: req.deviceId,
        ip: req.ip,
      });
    });

    next();
  };
}
