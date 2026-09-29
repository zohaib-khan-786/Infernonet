/**
 * A clock that advances on its own.
 *
 * Two things in the shell have to keep counting without any new data arriving:
 * §5's "Last sync: 8 sec ago", and the header's own date and time. Both are
 * measurements of elapsed time against something that arrived earlier, so
 * neither can be derived from a snapshot — a snapshot's `transport.age_seconds`
 * is a number the service computed at the moment it sent the frame, and it does
 * not move afterwards. A lamp that reads its own freshness out of a frozen
 * field will sit on "live" forever after the device stops reporting, which is
 * the exact failure §5 and §46 exist to prevent.
 *
 * So the shell keeps its own wall clock and measures the age of the newest
 * frame it holds against it. `1000` is the granularity the copy needs: the
 * guide's own examples are "8 sec ago" and "2 min ago", and `span()` in
 * lib/format.ts resolves to seconds below a minute, so a coarser tick would
 * leave "8 sec ago" sitting on "8 sec ago" for a full second at a time.
 *
 * Cost: one interval, and it re-renders only the two components that call it.
 * The page below the shell does not re-render on a tick.
 *
 * Background tabs throttle `setInterval` to roughly once a minute, so a tab left
 * open in the background comes back to a correct age on its first tick rather
 * than to a stale one.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(handle);
  }, [intervalMs]);

  return now;
}
