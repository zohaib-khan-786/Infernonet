/**
 * The route table.
 *
 * Eleven destinations, a hash route and a lookup. `React.lazy` for every page
 * except the dashboard, so a cold load on the dashboard — the page a volunteer
 * opens in a basement with one bar of signal — fetches the dashboard's code and
 * nothing else. The other ten arrive on the navigation that needs them.
 *
 * WHY ONE LAZY CALL PER PAGE RATHER THAN A BUNDLE
 * -----------------------------------------------------------------------------
 * §21 Refrigeration is almost entirely absence blocks and §33 Settings is a
 * paragraph. Neither is worth downloading to render the dashboard, and both are
 * cheap to fetch when someone actually clicks them. A single "everything except
 * the dashboard" chunk would put all ten on the critical path of the one page
 * that matters.
 *
 * KEEP THIS LIST AND `layout/navigation.ts` IN STEP
 * -----------------------------------------------------------------------------
 * The sidebar decides what is a link; this decides what a link renders. An id
 * present in one and not the other is a link to nowhere or a page with no
 * sidebar item, and `CURRENT_PAGE` in the sidebar is the third place the same
 * eleven names appear. They are adjacent in the file for that reason.
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { DEFAULT_ROUTE, useRoute, type RouteId } from './useRoute';
import { LoadingLine } from '../components/Notices';

const DashboardPage = lazy(() => import('./dashboard/DashboardPage'));
const MonitoringPage = lazy(() => import('./monitoring/MonitoringPage'));
const InventoryPage = lazy(() => import('./inventory/InventoryPage'));
const RefrigerationPage = lazy(() => import('./refrigeration/RefrigerationPage'));
const AlertsPage = lazy(() => import('./alerts/AlertsPage'));
const EventLogPage = lazy(() => import('./logs/EventLogPage'));
const ReportsPage = lazy(() => import('./reports/ReportsPage'));
const DevicesPage = lazy(() => import('./devices/DevicesPage'));
const ThresholdsPage = lazy(() => import('./thresholds/ThresholdsPage'));
const UsersPage = lazy(() => import('./users/UsersPage'));
const SettingsPage = lazy(() => import('./settings/SettingsPage'));

const PAGES: Readonly<Record<RouteId, ReactNode>> = {
  dashboard: <DashboardPage />,
  monitoring: <MonitoringPage />,
  inventory: <InventoryPage />,
  refrigeration: <RefrigerationPage />,
  alerts: <AlertsPage />,
  logs: <EventLogPage />,
  reports: <ReportsPage />,
  devices: <DevicesPage />,
  thresholds: <ThresholdsPage />,
  users: <UsersPage />,
  settings: <SettingsPage />,
};

/**
 * What the shell renders inside `<main>`.
 *
 * The fallback is a real loading line with a live region rather than a blank
 * frame, because a chunk fetch is a load the reader can see and a silent one
 * looks like a broken page. It lasts a few milliseconds on a warm connection and
 * is the only time this component is on screen.
 */
export function RouteOutlet() {
  const route = useRoute();
  return (
    <Suspense fallback={<LoadingLine>Loading the {route} page…</LoadingLine>} key={route}>
      {PAGES[route] ?? PAGES[DEFAULT_ROUTE]}
    </Suspense>
  );
}
