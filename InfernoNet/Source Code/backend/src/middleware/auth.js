/**
 * Device authentication for the ingest route.
 *
 * The shared secret is compared as a SHA-256 digest with a constant-time
 * comparison, so neither the length nor the prefix of the correct key leaks
 * through timing. The plaintext key is never stored, never logged, and never
 * leaves this module: the handler receives a boolean, not the key.
 *
 * The rate limiter runs *after* this middleware, keyed on IP and device id
 * rather than on the key, so a wrong key cannot be used to obtain a fresh
 * budget by guessing a new one.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../ingest/errors.js';

export const INGEST_KEY_HEADER = 'x-freshguard-key';

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest();

/** Constant-time digest comparison. Both sides are always 32 bytes. */
export function digestMatches(expectedHex, provided) {
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length !== 32) return false;
  return timingSafeEqual(sha256(provided ?? ''), expected);
}

export function deviceAuth({ ingestKeySha256 }) {
  return function deviceAuthMiddleware(req, _res, next) {
    const provided = req.get(INGEST_KEY_HEADER);
    if (typeof provided !== 'string' || provided.length === 0) {
      next(new ApiError('unauthorized', `missing ${INGEST_KEY_HEADER} header`));
      return;
    }
    if (provided.length > 512) {
      next(new ApiError('unauthorized', 'invalid device credential'));
      return;
    }
    if (!digestMatches(ingestKeySha256, provided)) {
      next(new ApiError('unauthorized', 'invalid device credential'));
      return;
    }
    next();
  };
}
