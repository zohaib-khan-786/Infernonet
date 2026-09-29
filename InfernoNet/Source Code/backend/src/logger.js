/**
 * Logger: structured JSON lines to stdout/stderr.
 *
 * Deliberately tiny and dependency-free. The only interface is `log(level, msg,
 * fields)` exposed as `log.info(msg, fields)` etc. There is no redaction logic
 * here on purpose: the call sites are responsible for never passing a secret, a
 * request body, or a raw query string. The invariant is enforced by review, and
 * the ingest/read modules are written so that they cannot see the key or the
 * body at all.
 */
import process from 'node:process';

const LEVELS = { silent: 100, error: 70, warn: 60, info: 50, debug: 30 };

export function createLogger({ level = 'info', name = 'freshguard', stream = process.stdout } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(levelName, msg, fields) {
    if (LEVELS[levelName] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: levelName,
      name,
      msg,
      ...fields,
    });
    stream.write(`${line}\n`);
  }

  return {
    error: (msg, fields) => emit('error', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    debug: (msg, fields) => emit('debug', msg, fields),
  };
}
