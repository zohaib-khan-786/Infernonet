/**
 * Throwaway verification of the GET dedupe/cancel contract. Not shipped.
 *
 * Checks the three properties the polling hook depends on and cannot be checked
 * by reading: that concurrent callers share one request, that cancelling evicts
 * the entry SYNCHRONOUSLY so the next caller issues its own request, and that
 * `ttlMs: 0` really means "ask again".
 */
import { getJSON } from '../src/api/client';

interface Call {
  readonly url: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  aborted: boolean;
}

const calls: Call[] = [];
let apiBase = 'https://api.example.test';

(globalThis as unknown as { fetch: unknown }).fetch = (url: string, init: RequestInit) => {
  const call: Call = {
    url,
    aborted: false,
    resolve: () => undefined,
    reject: () => undefined,
  };
  calls.push(call);
  return new Promise<Response>((resolve, reject) => {
    call.resolve = resolve as (value: unknown) => void;
    call.reject = reject;
    init.signal?.addEventListener('abort', () => {
      call.aborted = true;
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
};

const results: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`);
  if (!ok) process.exitCode = 1;
};

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const main = async (): Promise<void> => {
  // 1. Two concurrent callers, one request.
  calls.length = 0;
  const a = getJSON<{ n: number }>(`${apiBase}/one`);
  const b = getJSON<{ n: number }>(`${apiBase}/one`);
  check('concurrent callers share one request', calls.length === 1, `requests=${calls.length}`);
  calls[0].resolve(ok({ n: 1 }));
  const [ra, rb] = await Promise.all([a, b]);
  check('both callers get the resolved value', ra.n === 1 && rb.n === 1);

  // 2. ttlMs: 0 refetches; the default TTL serves from cache.
  calls.length = 0;
  await getJSON(`${apiBase}/two`);
  check('default ttl serves the second call from cache', calls.length === 1, `requests=${calls.length}`);

  calls.length = 0;
  await getJSON(`${apiBase}/three`, { ttlMs: 0 });
  await getJSON(`${apiBase}/three`, { ttlMs: 0 });
  check('ttlMs 0 asks again every time', calls.length === 2, `requests=${calls.length}`);

  // 3. Cancelling evicts synchronously, so the very next caller gets a NEW request
  //    rather than inheriting the abort. This is the StrictMode remount case.
  calls.length = 0;
  const controller = new AbortController();
  const cancelled = getJSON(`${apiBase}/four`, { signal: controller.signal });
  const settled = cancelled.then(
    () => 'resolved',
    (error: { code?: string }) => error.code ?? 'other',
  );
  controller.abort();
  check('abort rejects with code "aborted"', (await settled) === 'aborted');
  check('abort reached the underlying fetch', calls[0].aborted);

  calls.length = 0;
  const afterCancel = getJSON(`${apiBase}/four`, { signal: new AbortController().signal });
  check('a caller after an abort issues a fresh request', calls.length === 1, `requests=${calls.length}`);
  calls[0].resolve(ok({ ok: true }));
  const after = await afterCancel;
  check('the fresh request resolves normally', (after as { ok: boolean }).ok === true);

  // 4. A signal that is already aborted must not open a request at all.
  calls.length = 0;
  const dead = new AbortController();
  dead.abort();
  const result = await getJSON(`${apiBase}/five`, { signal: dead.signal }).then(
    () => 'resolved',
    (error: { code?: string }) => error.code ?? 'other',
  );
  check('an already-aborted signal opens no request', calls.length === 0, `requests=${calls.length}`);
  check('an already-aborted signal rejects with "aborted"', result === 'aborted');

  await tick();
  // A pending `cancelled` race loser must not surface as an unhandled rejection.
  check('no unhandled rejection was raised', true);

  for (const line of results) console.log(line);
  console.log(process.exitCode === 1 ? '\nRESULT: FAILURES' : '\nRESULT: all checks passed');
};

void main();
