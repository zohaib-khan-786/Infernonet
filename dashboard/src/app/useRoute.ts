/**
 * Which page is on screen.
 *
 * There is no router in this project and none is being added: a hash route and
 * a lookup table are the whole of it, and the alternative — a dependency — would
 * be a routing library for eleven destinations that are all static.
 *
 * WHY THE HASH
 * -----------------------------------------------------------------------------
 * The dashboard is served as static files, so a path route needs a server that
 * knows how to fall back to `index.html`. The service does not do that, and
 * asking it to is a change to `backend/**`, which is not this pass's to make. A
 * fragment route works from `file://`, from a subdirectory, and from any static
 * host, which is the property that matters for a page a volunteer opens on a
 * phone behind a captive portal.
 *
 * ONE SOURCE OF TRUTH FOR THE DESTINATIONS
 * -----------------------------------------------------------------------------
 * `layout/navigation.ts` declares the destinations as data and the sidebar
 * renders it. This file resolves a route id to a component, and `RouteOutlet`
 * is what the shell renders. If a route is added to the sidebar and not here,
 * the item is a link that goes nowhere, so the two lists are kept adjacent in
 * `routes.tsx` and the route table below names each one.
 *
 * NO DEVICE, NO PAGE
 * -----------------------------------------------------------------------------
 * Every page except this one needs a device. `useRoute` is the only thing that
 * parses the URL; what a page does with a missing device is its own business,
 * and each one renders the same invitation the dashboard does.
 */
import { useEffect, useState } from 'react';

/**
 * The route ids, in the order the sidebar lists them.
 *
 * Deliberately a literal union rather than a string: an unknown fragment falls
 * back to the dashboard rather than rendering `undefined`, and this type is what
 * makes a typo in `routes.tsx` a compile error instead of a blank page.
 */
export const ROUTE_IDS = [
  'dashboard',
  'monitoring',
  'inventory',
  'refrigeration',
  'alerts',
  'logs',
  'reports',
  'devices',
  'thresholds',
  'users',
  'settings',
] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

/** What the shell shows when nothing has been chosen. */
export const DEFAULT_ROUTE: RouteId = 'dashboard';

const KNOWN: ReadonlySet<string> = new Set(ROUTE_IDS);

function parse(hash: string): RouteId {
  // `#/alerts`, `#alerts` and `#/alerts?x=1` all name the same page. Anything
  // unrecognised — including the skip link's own `#main-content` — is the
  // default rather than an error, so a stale link lands somewhere real.
  const raw = hash.replace(/^#\/?/, '').split('?')[0]?.trim() ?? '';
  return KNOWN.has(raw) ? (raw as RouteId) : DEFAULT_ROUTE;
}

export function readRoute(): RouteId {
  if (typeof window === 'undefined') return DEFAULT_ROUTE;
  return parse(window.location.hash);
}

export function routeHref(id: RouteId): string {
  return `#/${id}`;
}

/** Subscribe to the fragment. Seeded from the URL on the first render. */
export function useRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(readRoute);

  useEffect(() => {
    const sync = (): void => setRoute(readRoute());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    // A cold load on `#/alerts` must also mark the sidebar item current, and a
    // navigation that only ever calls `replaceState` would not. Writing the
    // canonical href back on mount keeps the URL and the rendered page in
    // agreement without pushing a history entry.
    if (window.location.hash !== routeHref(route)) window.history.replaceState(null, '', routeHref(route));
  }, [route]);

  return route;
}
