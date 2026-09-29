/**
 * Configuration and secret handling.
 *
 * The important assertions are the negative ones: the service refuses to start
 * with the documented placeholder key, refuses a wildcard CORS origin, and
 * never holds the plaintext device key anywhere in its configuration.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INGEST_KEY_PLACEHOLDER, loadConfig, loadConfigOrExit } from '../src/config/index.js';
import { digestMatches } from '../src/middleware/auth.js';
import { TEST_KEY, TEST_KEY_SHA256 } from './helpers.js';

const base = { FG_INGEST_KEY_SHA256: TEST_KEY_SHA256, FG_DB_PATH: ':memory:' };

describe('configuration', () => {
  it('applies documented defaults', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      env: 'development',
      host: '127.0.0.1',
      port: 8080,
      bodyLimitBytes: 4096,
      readingsMaxPoints: 500,
      readingRetentionDays: 30,
      sseHeartbeatMs: 15_000,
      transportStaleAfterSeconds: 90,
      trustProxy: false,
      logLevel: 'info',
    });
    expect(config.corsOrigins).toEqual([]);
  });

  // Regression test. `loadConfigOrExit` used to take only `env` and call
  // `loadConfig(env)`, silently discarding the `dotenvPath` that server.js
  // passes. Every other test in this file injects an explicit env object, so
  // the whole suite passed while `node src/server.js` refused to boot with
  // "FG_INGEST_KEY_SHA256: expected string, received undefined". The only way
  // to catch that class of bug is to exercise the real entry point, with no
  // env object supplied, against a real .env file on disk.
  it('loadConfigOrExit reads a .env file when given only a dotenvPath', () => {
    const dir = mkdtempSync(join(tmpdir(), 'freshguard-config-'));
    const envPath = join(dir, '.env');
    writeFileSync(
      envPath,
      `FG_INGEST_KEY_SHA256=${TEST_KEY_SHA256}\nFG_CORS_ORIGINS=http://localhost:5173\n`,
    );

    // If the option is dropped again, loadConfigOrExit calls process.exit(78).
    // Trap that so a regression fails an assertion instead of killing the run.
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`loadConfigOrExit called process.exit(${String(code)})`);
    });

    try {
      const config = loadConfigOrExit({}, { dotenvPath: envPath });
      expect(config.ingestKeySha256).toBe(TEST_KEY_SHA256);
      expect(config.corsOrigins).toEqual(['http://localhost:5173']);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      rmSync(dir, { recursive: true, force: true });
      // dotenv writes into the real process.env; do not leak into other tests.
      delete process.env.FG_INGEST_KEY_SHA256;
      delete process.env.FG_CORS_ORIGINS;
    }
  });

  it('parses a comma-separated CORS allowlist and several booleans', () => {    const config = loadConfig({
      ...base,
      FG_CORS_ORIGINS: 'http://localhost:5173, https://dash.example',
      FG_TRUST_PROXY: 'true',
    });
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://dash.example']);
    expect(config.trustProxy).toBe(true);
  });

  it('keeps a single-origin allowlist an array, not a string', () => {
    // A string here would make the CORS check a substring match, so a request
    // for http://localhost:5173.evil.example would pass.
    const config = loadConfig({ ...base, FG_CORS_ORIGINS: 'http://localhost:5173' });
    expect(Array.isArray(config.corsOrigins)).toBe(true);
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
    expect(config.corsOrigins.includes('http://localhost:5173.evil.example')).toBe(false);
  });

  it('coerces trust proxy to a real boolean, defaulted or given', () => {
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, FG_TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(loadConfig({ ...base, FG_TRUST_PROXY: '1' }).trustProxy).toBe(true);
  });

  it('rejects a key that is not a 64-character hex digest', () => {
    expect(() => loadConfig({ ...base, FG_INGEST_KEY_SHA256: 'short' })).toThrow(/64 lowercase hex/);
    expect(() => loadConfig({})).toThrow(/FG_INGEST_KEY_SHA256/);
  });

  it('refuses the .env.example placeholder', () => {
    expect(() => loadConfig({ ...base, FG_INGEST_KEY_SHA256: INGEST_KEY_PLACEHOLDER })).toThrow(
      /placeholder/,
    );
  });

  it('refuses a wildcard CORS origin', () => {
    expect(() => loadConfig({ ...base, FG_CORS_ORIGINS: '*' })).toThrow(/wildcard/);
    expect(() => loadConfig({ ...base, FG_CORS_ORIGINS: 'https://a.example,*' })).toThrow(/wildcard/);
  });

  it('rejects out-of-range limits rather than silently clamping them', () => {
    expect(() => loadConfig({ ...base, FG_BODY_LIMIT_BYTES: '10' })).toThrow(/FG_BODY_LIMIT_BYTES/);
    expect(() => loadConfig({ ...base, FG_PORT: '70000' })).toThrow(/FG_PORT/);
    expect(() => loadConfig({ ...base, FG_SSE_HEARTBEAT_MS: '10' })).toThrow(/FG_SSE_HEARTBEAT_MS/);
  });

  it('never carries the plaintext key, only its digest', () => {
    const config = loadConfig(base);
    expect(JSON.stringify(config)).not.toContain(TEST_KEY);
    expect(config.ingestKeySha256).toBe(createHash('sha256').update(TEST_KEY, 'utf8').digest('hex'));
  });
});

describe('credential comparison', () => {
  it('accepts the right key and rejects everything else', () => {
    expect(digestMatches(TEST_KEY_SHA256, TEST_KEY)).toBe(true);
    expect(digestMatches(TEST_KEY_SHA256, 'wrong')).toBe(false);
    expect(digestMatches(TEST_KEY_SHA256, '')).toBe(false);
    expect(digestMatches(TEST_KEY_SHA256, undefined)).toBe(false);
    expect(digestMatches(TEST_KEY_SHA256, `${TEST_KEY} `)).toBe(false);
    expect(digestMatches(TEST_KEY_SHA256, 'x'.repeat(10_000))).toBe(false);
  });

  it('returns false rather than throwing on a malformed configured digest', () => {
    expect(digestMatches('not-a-digest', TEST_KEY)).toBe(false);
    expect(digestMatches('', TEST_KEY)).toBe(false);
  });
});
