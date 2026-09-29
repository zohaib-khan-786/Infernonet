/**
 * URL query-parameter state.
 *
 * Two pieces of state are worth deep-linking on a monitoring screen: which
 * device you are looking at, and which time range the trends are showing. Both
 * live in the query string so a volunteer can send someone a link that lands on
 * the same view, and so a refresh does not reset them.
 *
 * `replaceState`, not `pushState`: changing a range is not navigation, and
 * filling the history stack with range changes makes the browser's back button
 * useless.
 */

export function readParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get(name);
  return value && value !== '' ? value : null;
}

export function writeParams(updates: Readonly<Record<string, string | null>>): void {
  if (typeof window === 'undefined') return;
  const search = new URLSearchParams(window.location.search);
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === '') {
      if (search.has(key)) {
        search.delete(key);
        changed = true;
      }
    } else if (search.get(key) !== value) {
      search.set(key, value);
      changed = true;
    }
  }
  if (!changed) return;
  const query = search.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

const STORAGE_PREFIX = 'freshguard:';

/** Versioned, minimal local storage: a device id and an optional name. */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    // Private browsing, disabled storage, or a quota error. Not worth a crash.
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    else window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  } catch {
    // Same as above: a monitoring screen must work without persistence.
  }
}
