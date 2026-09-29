/**
 * Administrator authentication for mutating admin routes.
 *
 * WHY THIS EXISTS
 *
 * `PUT /api/v1/devices/:dev/thresholds` changes the safety limits the ESP8266
 * itself enforces. Until this module existed the only controls on that route
 * were a rate limiter and a CORS allowlist, and CORS is not access control: it is
 * a browser-enforced response-header check that curl, wget, python-requests, a
 * compromised device on the same VLAN, and the ESP8266 itself all bypass
 * silently. Anything that could reach the port could rewrite the temperature
 * band that decides whether food is flagged as spoiled.
 *
 * A bearer token is the whole control, so its failure modes matter more than the
 * happy path:
 *
 *   - Constant-time comparison. The presented token and the configured token are
 *     both SHA-256 digested first, which makes them 32 bytes each and means
 *     `timingSafeEqual` can never throw on a length mismatch. A digest also
 *     means neither the length nor a matching prefix of the real token is
 *     observable from the comparison, so an attacker cannot learn the token one
 *     character at a time by timing responses. Mirrors `deviceAuth` in auth.js.
 *   - Never logged. The token is read from the header, compared, and dropped.
 *     It is never attached to the request, never passed to a logger, and never
 *     echoed in an error message. The access log records the route, status,
 *     request id and client IP, which is enough to investigate a change without
 *     a credential ever existing in a log file.
 *   - Fail closed. An unset `FG_ADMIN_TOKEN` disables the admin mutation
 *     entirely (every attempt is a 401). Treating "no token configured" as
 *     "no token required" would make the secure-by-default configuration the
 *     one that fails open, which is how a missing env var becomes a
 *     world-writable endpoint.
 *   - Absent and malformed are different failures. A client that sends no
 *     `Authorization` header has forgotten to authenticate; a client that sends
 *     `Basic abc123` is misconfigured or probing. Both are 401, but they get
 *     distinct `error.code` values so an integrator can tell "you forgot the
 *     header" from "your header is the wrong shape".
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * This middleware is applied to admin MUTATIONS only. Reads, SSE and every
 * device-facing route stay unauthenticated; the exemptions are documented at
 * the call sites in read/routes.js, because the reason each one is exempt is
 * specific and belongs next to the route it protects.
 *
 * RESIDUAL RISK, stated plainly: one shared bearer token proves a request was
 * AUTHORISED, not who typed it. A token shared by several operators cannot
 * attribute a threshold change to a person, and `changed_by` therefore remains a
 * self-declared label. Real per-human attribution needs real identities (an
 * OIDC provider or per-operator credentials); it is not something a shared
 * secret can be stretched to provide, and pretending otherwise would put a
 * fabricated name in the audit trail.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../ingest/errors.js';

/**
 * Error codes for the admin surface.
 *
 * `unauthorized` is reused from the device-facing vocabulary (already 401) so a
 * client handling one 401 shape does not need a second one. The malformed case
 * gets its own code, defined here rather than added to CODES in ingest/errors.js
 * because that map is the stable device contract vocabulary and this is not a
 * device-facing failure. Status is passed explicitly instead of relying on the
 * map, so the response cannot drift if that map is ever reorganised.
 */
export const ADMIN_UNAUTHORIZED = 'unauthorized';
export const ADMIN_MALFORMED_AUTHORIZATION = 'malformed_authorization';

/**
 * `Authorization: Bearer <token>`, per RFC 7235: the scheme is case-insensitive,
 * exactly one scheme is allowed, and the token is a single whitespace-free run.
 * A token containing a space is malformed rather than "wrong", which is what
 * makes a duplicated header (`Bearer a, Bearer b`, which Node joins with a
 * comma) fail closed instead of being trimmed into something that validates.
 */
const BEARER = /^Bearer[ \t]+(\S+)$/i;

/**
 * A generous ceiling on a presented token. Without it, a caller could post a
 * multi-megabyte Authorization header and make every request pay a SHA-256 over
 * it - a cheap amplification on a route that is otherwise the most privileged
 * one in the service. 512 bytes is far longer than any real token.
 */
const MAX_TOKEN_LENGTH = 512;

/**
 * What a change is attributed to when the caller sends no `changed_by`. The
 * audit trail should never contain an unattributed row: an empty `changed_by`
 * cannot be distinguished from a row written by something that is not this API.
 * The value says "an authenticated admin session", which is the strongest claim
 * a single shared token can actually support.
 */
export const ADMIN_PRINCIPAL = 'admin-token';

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest();

/** One definition of "an admin token is configured", used by the middleware and the startup check. */
export function adminTokenConfigured(config) {
  const token = config?.adminToken;
  return typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_LENGTH;
}

/**
 * Constant-time digest comparison. Both sides are always 32 bytes, so
 * `timingSafeEqual` cannot throw and cannot leak the token's length.
 */
export function tokenMatches(expected, provided) {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/**
 * Express middleware guarding a mutating administrator route.
 *
 * On success it sets `req.adminAuthenticated` so downstream handlers can record
 * that a change arrived through the authenticated path, and nothing else: no
 * token value, no header copy.
 */
export function adminAuth({ adminToken } = {}) {
  return function adminAuthMiddleware(req, _res, next) {
    // Fail closed, and say so. The wording is for an operator reading a 401 in a
    // log, not for an attacker: it tells them the fix is to set the env var.
    if (!adminTokenConfigured({ adminToken })) {
      next(
        new ApiError(ADMIN_UNAUTHORIZED, 'administrator authentication is not configured on this server', {
          status: 401,
        }),
      );
      return;
    }

    const header = req.get('authorization');
    if (header === undefined) {
      next(new ApiError(ADMIN_UNAUTHORIZED, 'missing Authorization: Bearer <token>', { status: 401 }));
      return;
    }

    // The scheme is matched case-insensitively because RFC 7235 says it is
    // case-insensitive, but anything else about the shape is refused: no scheme,
    // no token, an empty token, two schemes, or a token containing whitespace.
    const match = typeof header === 'string' ? BEARER.exec(header) : null;
    if (!match) {
      next(
        new ApiError(ADMIN_MALFORMED_AUTHORIZATION, 'Authorization must be a single "Bearer <token>" header', {
          status: 401,
        }),
      );
      return;
    }

    const provided = match[1];
    // Over-long and wrong tokens are reported identically on purpose. Separating
    // them would confirm the configured token is at least this long, which is
    // exactly the kind of oracle a timing-safe comparison exists to remove.
    if (provided.length > MAX_TOKEN_LENGTH || !tokenMatches(adminToken, provided)) {
      next(new ApiError(ADMIN_UNAUTHORIZED, 'invalid administrator token', { status: 401 }));
      return;
    }

    req.adminAuthenticated = true;
    next();
  };
}
