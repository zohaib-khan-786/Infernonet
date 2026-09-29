/**
 * The sidebar's navigation, as data (guide §4).
 *
 * The whole list is declared here rather than in the markup so that two things
 * are true at once: §4's item list is visible in one screen of code, and each
 * item carries the answer to "does this page exist yet?" as a field rather than
 * as a convention somebody has to remember.
 *
 * WHY `href` IS NULLABLE, AND WHAT NULL MEANS
 * -----------------------------------------------------------------------------
 * A nav item that is not a page must not be an `<a href>`: a link to a route
 * that does not exist is a 404, and a 404 in an operations tool is worse than an
 * absent control — somebody will believe the feature is broken rather than
 * absent.
 *
 * So `href: null` means "rendered, focusable, and visibly not built". The item
 * becomes a `button` with `aria-disabled` and a "Not built" chip, it is described
 * for assistive technology by the same sentence, and clicking it does nothing
 * because there is nothing to go to. The moment a page lands, it gets an `href`
 * and this file is the only thing that changes.
 *
 * `aria-disabled` and not `disabled`, for one reason: `disabled` removes the
 * item from the tab order, so a keyboard user would never find out that the
 * destination exists. §38 wants keyboard navigation through the product, and a
 * destination that is visible but unreachable teaches the wrong thing.
 *
 * THE ROUTES
 * -----------------------------------------------------------------------------
 * The fragment route lives in `app/useRoute.ts` and is rendered by
 * `app/routes.tsx`. Those two files and this one name the same eleven
 * destinations, and the two lists must be edited together — see the note at the
 * top of `routes.tsx`.
 *
 * `integrations` is the one item still disabled. Guide §33 lists Integrations as
 * a settings section rather than as a page of its own, and there is no backend
 * for it: no route, no store, nothing to configure. §33 is rendered on the
 * settings page, which says so. When an integrations page exists it gets an
 * `href` here.
 */
import { routeHref, type RouteId } from '../../app/useRoute';

export interface NavItem {
  /**
   * Stable id. For a built page this is also its route id; for a page that does
   * not exist yet it is a name nothing resolves, which is exactly what
   * `href: null` means.
   */
  readonly id: string;
  readonly label: string;
  /** Where this item goes. `null` until the page exists. */
  readonly href: string | null;
}

export interface NavSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly NavItem[];
}

/** A destination that exists. */
const page = (id: RouteId, label: string): NavItem => ({ id, label, href: routeHref(id) });
/** A destination the guide lists and this build does not have. */
const planned = (id: string, label: string): NavItem => ({ id, label, href: null });

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'main',
    title: 'Main',
    items: [
      page('dashboard', 'Dashboard'),
      page('monitoring', 'Live Monitoring'),
      page('inventory', 'Food & Inventory'),
      page('refrigeration', 'Refrigeration'),
      page('alerts', 'Alerts'),
      page('logs', 'Logs & History'),
      page('reports', 'Reports'),
    ],
  },
  {
    id: 'administration',
    title: 'Administration',
    items: [
      page('devices', 'Devices'),
      page('thresholds', 'Thresholds'),
      page('users', 'Users & Roles'),
      page('settings', 'Settings'),
      planned('integrations', 'Integrations'),
    ],
  },
];

/**
 * The `<nav>` element's id, so the header's trigger can point `aria-controls` at
 * the thing it opens. Declared here because the nav and the trigger are in
 * different files and a literal repeated in both is a literal that will drift.
 */
export const NAV_ID = 'freshguard-navigation';

/**
 * One sentence describing every not-yet-built destination, referenced by
 * `aria-describedby` from all of them. Shared rather than repeated per item
 * because it is the same sentence twice, and a screen reader that reads it once
 * per item on a first Tab through the nav is two identical interruptions.
 */
export const PLANNED_DESCRIPTION = 'Not built yet. This page arrives in a later phase of the build.';
