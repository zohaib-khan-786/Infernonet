/**
 * Stable device-facing error codes.
 *
 * A device must be able to branch on `error.code` without parsing prose, and
 * that vocabulary has to survive refactoring. Every ingest failure lands here;
 * the HTTP status is a function of the code, never the other way round.
 */
export const CODES = {
  unauthorized: 401,
  forbidden: 403,
  invalid_snapshot: 400,
  unknown_key: 400,
  unknown_device: 404,
  body_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal: 500,
  not_found: 404,
  bad_request: 400,
  range_too_wide: 400,
};

export class ApiError extends Error {
  constructor(code, message, { details, status, context } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status ?? CODES[code] ?? 500;
    this.details = details;
    /**
     * Structured, bounded facts this specific failure has to carry, rendered as
     * `error.context` by the terminal handler.
     *
     * The gap it fills: `code` says WHAT went wrong, and for most failures that
     * is the whole answer. A few have a second fact the caller must be able to
     * read without parsing prose - "this uid is retired, and here is when" is
     * not actionable from the status line alone, and putting a timestamp into
     * `message` would make a machine parse English. `details` cannot carry it:
     * that array is contract-violation field paths and reasons, and overloading
     * it would break the shape callers already index.
     *
     * Only for small non-secret values the caller could already derive: an
     * identifier it sent, a flag, a timestamp. Never a submitted body, and never
     * operator free text.
     */
    this.context = context;
    this.expose = true;
  }
}

/**
 * Contract violations are described by field path and reason only. Values are
 * never echoed back: a rejection message can end up in a device log, and a
 * snapshot body is exactly the kind of payload that should not be reproduced.
 */
const issueDetail = (issue) => ({
  path: issue.path.map(String).join('.') || '(root)',
  code: issue.code,
  message: issue.message,
});

/** A zod failure that contains unknown keys is `unknown_key`; anything else is `invalid_snapshot`. */
export function fromZodError(error) {
  const issues = error.issues.map(issueDetail);
  const unknownKeyIssue = error.issues.find((issue) => issue.code === 'unrecognized_keys');
  if (unknownKeyIssue) {
    return new ApiError('unknown_key', 'snapshot contains keys the v1 contract does not define', {
      details: issues,
    });
  }
  return new ApiError('invalid_snapshot', 'snapshot does not satisfy the v1 contract', {
    details: issues,
  });
}
