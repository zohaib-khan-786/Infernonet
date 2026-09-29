/**
 * Terminal error handling.
 *
 * One place decides the response shape so a device always sees the same
 * envelope, whatever went wrong:
 *
 *   { "error": { "code": "invalid_snapshot", "message": "...", "details": [...],
 *                "context": { ... }, "request_id": "..." } }
 *
 * `code` is the stable part. `message` is prose and may change. `details` is
 * only present for contract violations, and contains field paths and reasons
 * but never values. `context` is only present where a failure has a second
 * bounded fact a caller must be able to read without parsing prose. Anything not
 * explicitly mapped becomes `internal` with the real cause logged server-side and
 * nothing but a generic message returned.
 */
import { ApiError } from '../ingest/errors.js';

export function errorHandler({ logger }) {
  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
  return function errorHandlerMiddleware(err, req, res, _next) {
    if (res.headersSent) {
      res.destroy();
      return;
    }

    const apiError = err instanceof ApiError ? err : null;

    if (!apiError || apiError.status >= 500) {
      logger.error('request failed', {
        request_id: req.id,
        method: req.method,
        route: req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched',
        status: apiError?.status ?? 500,
        error: err?.message,
        stack: err?.stack?.split('\n').slice(0, 4).join(' | '),
      });
    }

    const status = apiError?.status ?? 500;
    const body = {
      error: {
        code: apiError?.code ?? 'internal',
        message: apiError?.expose ? apiError.message : 'internal error',
        request_id: req.id,
      },
    };
    if (apiError?.details) body.error.details = apiError.details;
    // Only a plain object is rendered, and only when it has keys. Anything else
    // is dropped rather than stringified, so a future caller cannot turn this
    // into an accidental channel for a request body.
    if (apiError?.context && typeof apiError.context === 'object' && Object.keys(apiError.context).length > 0) {
      body.error.context = apiError.context;
    }

    res.status(status).json(body);
  };
}

export function notFound() {
  return function notFoundMiddleware(req, _res, next) {
    // `req.path` never includes the query string, and the message stays generic
    // so a caller cannot echo an arbitrary path back through the API.
    next(new ApiError('not_found', 'no route matches this request'));
  };
}
