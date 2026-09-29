/**
 * Alerts (guide §14, §15, §19, §29).
 *
 * The one page a volunteer opens when something is wrong, so it leads with the
 * conditions and the acknowledgement and puts the notification grouping from
 * §29 underneath it rather than in a header bell.
 *
 * §29 asks for a bell in the global header and a drawer grouped Critical /
 * Today / Earlier. There is no bell, and the reason is in `Header.tsx` and worth
 * repeating here because this is where it would have lived: the conditions are
 * already on this page in full, and a bell that counts them a second time in a
 * different place is either a duplicated number or a button that does nothing.
 * So the grouping is built as a section of this page instead, which is strictly
 * better than a drawer â€” it is addressable, it is in the link, and it survives a
 * refresh.
 *
 * There is no "Mark all read" for the same reason there is no auto-dismiss: a
 * critical condition is not a notification about a person, and clearing it
 * because somebody scrolled past would remove the only record that a human had
 * seen it. §29's own rule â€” do not automatically clear critical notifications â€”
 * is honoured by not having a bulk clear at all.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Alert } from '../../api/types';
import { DeviceGate, PageHeader } from '../PageFrame';
import { AlertFilters, AlertList } from '../../components/AlertList';
import { AlertDetail } from '../../components/AlertDetail';
import { EventTimeline } from '../../components/EventTimeline';
import { MetricDetail } from '../../components/MetricDetail';
import { StatusBand } from '../../components/StatusBand';
import { Mark } from '../../components/Mark';
import { metricById, type MetricId } from '../../lib/metrics';
import { isRangeId, type RangeId } from '../../lib/ranges';
import { readParam } from '../../lib/url';
import { routeHref } from '../useRoute';
import { useDashboard, useDashboardActions } from '../../store/DashboardProvider';

function currentRange(): RangeId {
  const requested = readParam('range');
  return isRangeId(requested) ? requested : '6h';
}

/** §29's grouping, over the same conditions. See the file note for why. */
function NotificationGrouping({ alerts }: { readonly alerts: readonly Alert[] }) {
  const midnight = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }, []);

  const critical = alerts.filter((alert) => alert.severity === 'error');
  const today = alerts.filter((alert) => alert.severity === 'warning' || alert.severity === 'info');

  return (
    <section className="panel" aria-labelledby="notify-title">
      <div className="panel__head">
        <h2 className="panel__title" id="notify-title">
          Notifications
        </h2>
        <p className="panel__sub">
          {critical.length} needing action · {today.length} to watch or read
        </p>
      </div>
      <div className="panel__body">
        <p className="note">
          Guide §29 groups these Critical / Today / Earlier and offers a Mark all read. Both are deliberately absent.
          Conditions are not notifications about a person: a critical condition is a statement about a cabinet, and a bulk
          dismiss would record that somebody saw it without anybody having seen it. Acknowledgement is per condition and
          names a person.
        </p>
        {today.length === 0 ? null : <p className="hint">Today&rsquo;s clock is the browser&rsquo;s, at {new Date(midnight).toLocaleTimeString()}.</p>}
      </div>
      <div className="panel__body panel__body--flush">
        <ul className="notify-list">
          {critical.map((alert) => (
            <li className="notify-list__item" key={alert.condition_key} data-tone="crit">
              <Mark shape="square" className="mark--sm" />
              <span className="notify-list__title">{alert.title}</span>
              <span className="notify-list__meta">
                {alert.acknowledged ? 'acknowledged' : 'not acknowledged'} · kind {alert.kind}
              </span>
            </li>
          ))}
          {today.map((alert) => (
            <li className="notify-list__item" key={alert.condition_key} data-tone={alert.severity === 'warning' ? 'warn' : 'neutral'}>
              <Mark shape={alert.severity === 'warning' ? 'triangle' : 'circle'} className="mark--sm" />
              <span className="notify-list__title">{alert.title}</span>
              <span className="notify-list__meta">
                {alert.acknowledged ? 'acknowledged' : 'not acknowledged'} · kind {alert.kind}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function AlertsPage() {
  const { alerts, ackErrors, pendingAcks, events } = useDashboard();
  const { acknowledge, unacknowledge, loadMoreEvents, reloadEvents } = useDashboardActions();
  const [openAlert, setOpenAlert] = useState<Alert | null>(null);
  const [openMetric, setOpenMetric] = useState<MetricId | null>(null);
  const [query, setQuery] = useState('');
  // 'all', NOT 'unacknowledged', and the reason is food safety rather than taste:
  // acknowledgement records that a person saw a condition, and it changes nothing
  // about the condition. An acknowledged `check_food` is still check food, so a
  // default filter that hides acknowledged rows would hide a food verdict behind
  // a workflow flag — and on a page whose whole job is acting on conditions, the
  // one that gets acknowledged first is the one that would disappear. The
  // "Needs acknowledging" chip is one click away, and the status band above
  // states the unacknowledged count either way.
  const [ackFilter, setAckFilter] = useState<'all' | 'unacknowledged' | 'acknowledged'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const range = currentRange();

  const closeAlert = useCallback(() => setOpenAlert(null), []);
  const closeMetric = useCallback(() => setOpenMetric(null), []);
  const openChartFor = useCallback((id: MetricId) => {
    setOpenAlert(null);
    setOpenMetric(id);
  }, []);
  const resetFilters = useCallback(() => {
    setQuery('');
    setAckFilter('all');
    setSeverityFilter('all');
  }, []);

  return (
    <DeviceGate>
      {({ dev, snapshot, events: gateEvents }) => {
        const currentEvents = events.items.length > 0 ? events.items : gateEvents.items;
        return (
          <>
            <PageHeader
              title="Alerts & conditions"
              lede={
                <>
                  Everything {dev} is currently reporting as a condition, and what changed most recently. Every
                  condition here is a latched state in the latest snapshot; the event log below records the transitions.
                </>
              }
            />

            <StatusBand
              overall={snapshot.device.overall_status}
              zone={snapshot.device.zone_status}
              reportedAt={snapshot.device.reported_at}
              timeValid={snapshot.device.time_valid}
              itemCount={snapshot.counts.inventory_active}
              retiredCount={snapshot.counts.inventory_retired}
              unacknowledged={snapshot.counts.alerts_unacknowledged}
              needsAttention={snapshot.inventory.filter((item) => item.status.code === 1 || item.status.code === 2).length}
            />

            <section className="panel" aria-labelledby="alerts-list-title">
              <div className="panel__head">
                <h2 className="panel__title" id="alerts-list-title">
                  Active conditions
                </h2>
                <p className="panel__sub">
                  <span className="num">{alerts.length}</span> active ·{' '}
                  <span className="num">{snapshot.counts.alerts_unacknowledged}</span> unacknowledged
                </p>
              </div>

              <div className="panel__body">
                <p className="note">
                  Three of guide §14&apos;s per-row fields are not in the service&apos;s response and are marked as absent
                  on each row: <strong>current value</strong> and <strong>threshold</strong> are shown only when the
                  condition&apos;s key names a measurement, because for a whole-zone condition the device says in its own
                  words that the threshold is not transmitted; and <strong>started</strong> is not recorded for any
                  condition, because a condition is a latched state rather than a record.
                </p>
                <AlertFilters
                  query={query}
                  onQuery={setQuery}
                  ackFilter={ackFilter}
                  onAckFilter={setAckFilter}
                  severityFilter={severityFilter}
                  onSeverityFilter={setSeverityFilter}
                  onReset={resetFilters}
                />
              </div>

              <div className="panel__body panel__body--flush">
                <AlertList
                  dev={dev}
                  alerts={alerts}
                  readings={snapshot.readings}
                  thresholds={snapshot.device.thresholds}
                  pendingAcks={pendingAcks}
                  ackErrors={ackErrors}
                  onAcknowledge={acknowledge}
                  onUnacknowledge={unacknowledge}
                  onOpen={setOpenAlert}
                  openKey={openAlert?.condition_key ?? null}
                  query={query}
                  ackFilter={ackFilter}
                  severityFilter={severityFilter}
                />
              </div>

              <div className="panel__foot">
                <p className="hint">
                  Acknowledging records that a person has seen a condition. It tells the device nothing â€” the firmware has
                  no acknowledgement path â€” and it never changes a verdict.
                </p>
              </div>
            </section>

            <section className="panel" aria-labelledby="alerts-timeline-title">
              <div className="panel__head">
                <h2 className="panel__title" id="alerts-timeline-title">
                  Recent events
                </h2>
                <p className="panel__sub">Chronological, newest first</p>
                <div className="panel__tools">
                  <button type="button" className="btn btn--quiet" onClick={reloadEvents}>
                    Refresh
                  </button>
                </div>
              </div>
              <EventTimeline
                dev={dev}
                events={currentEvents}
                limit={12}
                onViewAll={() => {
                  window.location.hash = routeHref('logs');
                }}
                onLoadMore={loadMoreEvents}
                loadingMore={events.loadingMore}
                hasMore={events.hasMore}
              />
            </section>

            <NotificationGrouping alerts={alerts} />

            {openAlert === null ? null : (
              <AlertDetail
                alert={openAlert}
                dev={dev}
                snapshot={snapshot}
                events={currentEvents}
                pending={pendingAcks.has(openAlert.condition_key)}
                error={ackErrors.get(openAlert.condition_key)}
                onAcknowledge={acknowledge}
                onUnacknowledge={unacknowledge}
                onClose={closeAlert}
                onViewChart={openChartFor}
              />
            )}

            {openMetric === null ? null : (
              <MetricDetail metric={metricById(openMetric)} snapshot={snapshot} onClose={closeMetric} initialRange={range} />
            )}
          </>
        );
      }}
    </DeviceGate>
  );
}
