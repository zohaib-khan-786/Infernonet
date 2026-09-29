/**
 * The dashboard (guide §6, §7, §8, §10, §11, §28).
 *
 * §6 draws an order, and the order is the argument, so it is followed exactly:
 *
 *   StatusBand        the device's verdict, at the top with nothing above it
 *   QuickActions      four compact actions, because a volunteer came here to do
 *                     something (§28)
 *   metric cards      the five headline measurements (§7), each opening the
 *                     detail drawer (§8)
 *   trends            the main chart (§9)
 *   Quick Stats       the door, which is the only operational state that exists
 *                     here, plus three honest absences (§11)
 *   Device health     the fault map (§12) — BELOW the operational status, per §39
 *   Food & Storage    the composition donut with its counts beside it (§16)
 *   Environmental     the 2×3 grid (§10)
 *   Alerts            what is wrong, with an action on each (§14)
 *   Recent events     what changed (§19)
 *   Thresholds        the one editable surface, last, after everything that
 *                     reports the consequences of editing it
 *
 * §39 is the constraint that shapes the rail: nothing in it is above the verdict,
 * and the diagnostics panel is the deepest thing on the page. §47's priority
 * model is the same statement, and the two of them are why the right rail holds
 * health and configuration rather than anything a person has to act on today.
 */
import { memo, useCallback, useState } from 'react';
import { ConditionsPanel } from '../../components/ConditionsPanel';
import { EventLogPanel } from '../../components/EventLogPanel';
import { InventoryPanel } from '../../components/InventoryPanel';
import { ReadingsPanel } from '../../components/ReadingsPanel';
import { StatusBand } from '../../components/StatusBand';
import { ThresholdsPanel } from '../../components/ThresholdsPanel';
import { MetricCardRow } from '../../components/MetricCardRow';
import { MetricDetail } from '../../components/MetricDetail';
import { EnvironmentalGrid } from '../../components/EnvironmentalGrid';
import { QuickStatsPanel } from '../../components/QuickStatsPanel';
import { DeviceHealthPanel } from '../../components/DeviceHealthPanel';
import { QuickActions } from '../../components/QuickActions';
import { TrendsExplorer } from '../../components/TrendsExplorer';
import { Donut } from '../../components/Donut';
import { EventTimeline } from '../../components/EventTimeline';
import { AlertList } from '../../components/AlertList';
import { AlertFilters } from '../../components/AlertList';
import { AlertDetail } from '../../components/AlertDetail';
import { useDashboard, useDashboardActions } from '../../store/DashboardProvider';
import { DeviceGate } from '../PageFrame';
import type { Alert, CurrentResponse } from '../../api/types';
import { metricById, type MetricId } from '../../lib/metrics';
import { isRangeId, type RangeId } from '../../lib/ranges';
import { readParam } from '../../lib/url';
import { routeHref } from '../useRoute';

function currentRange(): RangeId {
  const requested = readParam('range');
  return isRangeId(requested) ? requested : '6h';
}

/** Guide §16: counts beside the ring, never the ring alone. */
const FoodSummary = memo(function FoodSummary({ snapshot }: { readonly snapshot: CurrentResponse }) {
  const items = snapshot.inventory;
  const fresh = items.filter((item) => item.status.code === 0).length;
  const useSoon = items.filter((item) => item.status.code === 1).length;
  const check = items.filter((item) => item.status.code === 2).length;
  const unknown = items.filter((item) => item.status.code === 3).length;
  const unrecognised = items.filter((item) => item.status.code < 0 || item.status.code > 3).length;

  return (
    <section className="panel" aria-labelledby="food-summary-title">
      <div className="panel__head">
        <h2 className="panel__title" id="food-summary-title">
          Food &amp; storage
        </h2>
        <p className="panel__sub">
          {items.length} active item{items.length === 1 ? '' : 's'}
          {snapshot.counts.inventory_retired > 0 ? ` · ${snapshot.counts.inventory_retired} retired` : ''}
        </p>
        <div className="panel__tools">
          <a className="btn btn--quiet" href={routeHref('inventory')}>
            Open food &amp; inventory
          </a>
        </div>
      </div>

      <div className="panel__body food-summary">
        <Donut
          subject="items stored"
          slices={[
            { id: 'fresh', label: 'Fresh', value: fresh, tone: 'ok', meaning: 'the device reports every item inside its limits' },
            { id: 'use-soon', label: 'Needs attention', value: useSoon, tone: 'warn', meaning: 'the device reports an item past 75% of its storage window' },
            { id: 'check', label: 'Check food', value: check, tone: 'crit', meaning: 'the device reports an item at or past its limit' },
            { id: 'unknown', label: 'Cannot be evaluated', value: unknown, tone: 'unknown', meaning: 'the device could not evaluate this item' },
            ...(unrecognised > 0
              ? [{ id: 'odd', label: 'Unrecognised status', value: unrecognised, tone: 'neutral' as const, meaning: 'the service sent a status code outside 0-3' }]
              : []),
          ]}
        />

        {/*
          The counts, in words, beside the ring. §16's rule and §46.2: every
          metric needs a unit, a number needs a thing to count and a colour
          needs a label, and the four verdicts each bring a shape.
        */}
        <dl className="food-counts">
          <div className="food-counts__row" data-tone="ok">
            <dt>Fresh</dt>
            <dd>
              <span className="num">{fresh}</span>
              <span className="food-counts__note">inside every limit the device applies</span>
            </dd>
          </div>
          <div className="food-counts__row" data-tone="warn">
            <dt>Needs attention</dt>
            <dd>
              <span className="num">{useSoon}</span>
              <span className="food-counts__note">past 75% of a storage window. Plan, do not discard.</span>
            </dd>
          </div>
          <div className="food-counts__row" data-tone="crit">
            <dt>Check food</dt>
            <dd>
              <span className="num">{check}</span>
              <span className="food-counts__note">at or past the expiry date or storage limit the device holds</span>
            </dd>
          </div>
          <div className="food-counts__row" data-tone="unknown">
            <dt>Cannot be evaluated</dt>
            <dd>
              <span className="num">{unknown}</span>
              <span className="food-counts__note">the device says it cannot judge these. That is not the same as bad.</span>
            </dd>
          </div>
          {snapshot.counts.inventory_retired > 0 ? (
            <div className="food-counts__row" data-tone="neutral">
              <dt>Retired</dt>
              <dd>
                <span className="num">{snapshot.counts.inventory_retired}</span>
                <span className="food-counts__note">removed from the cabinet; kept for the record</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <p className="panel__note-strip">
        Every count and every status above is the device&apos;s own verdict, shown as reported. The dashboard does not
        re-evaluate a threshold, and the ring is a summary of counts that are also written out beside it.
      </p>
    </section>
  );
});

export default function DashboardPage() {
  const { snapshot, alerts, ackErrors, pendingAcks, events } = useDashboard();
  const { acknowledge, unacknowledge, loadMoreEvents } = useDashboardActions();
  const [openMetric, setOpenMetric] = useState<MetricId | null>(null);
  const [openAlert, setOpenAlert] = useState<Alert | null>(null);
  const [query, setQuery] = useState('');
  const [ackFilter, setAckFilter] = useState<'all' | 'unacknowledged' | 'acknowledged'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const range = currentRange();

  const closeMetric = useCallback(() => setOpenMetric(null), []);
  const closeAlert = useCallback(() => setOpenAlert(null), []);
  const openChartFor = useCallback((id: MetricId) => {
    setOpenAlert(null);
    setOpenMetric(id);
  }, []);
  const resetFilters = useCallback(() => {
    setQuery('');
    setAckFilter('all');
    setSeverityFilter('all');
  }, []);
  const viewAllEvents = useCallback(() => {
    window.location.hash = routeHref('logs');
  }, []);

  return (
    <DeviceGate
      // §47: the verdict is the first thing on the page, above even the clock
      // and link banners. `lead` exists so the gate owns the states without
      // owning the order.
      lead={
        snapshot === null ? null : (
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
        )
      }
    >
      {({ dev, snapshot: gate, events: gateEvents }) => {
        if (gate === null) return null;
        return (
          <>
            <QuickActions
              dev={dev}
              conditionCount={alerts.length}
              unacknowledged={gate.counts.alerts_unacknowledged}
              hrefs={{
                reports: routeHref('reports'),
                inventory: routeHref('inventory'),
                settings: routeHref('settings'),
                alerts: routeHref('alerts'),
                thresholds: routeHref('thresholds'),
              }}
            />

            <MetricCardRow snapshot={gate} onOpen={setOpenMetric} />

            <TrendsExplorer
              dev={dev}
              thresholds={gate.device.thresholds}
              clockTrusted={gate.device.time_valid && gate.device.reported_at !== null}
              events={gateEvents.items}
              heading="Temperature trends"
              subtitle="The main chart (guide §9). One plot per measurement, a shared time axis, and the device's own configured band drawn on each — with the band named in words underneath rather than by colour."
            />

            <div className="columns">
              <div className="column">
                <FoodSummary snapshot={gate} />

                <section className="panel" aria-labelledby="dash-alerts-title">
                  <div className="panel__head">
                    <h2 className="panel__title" id="dash-alerts-title">
                      Alerts &amp; notifications
                    </h2>
                    <p className="panel__sub">
                      <span className="num">{alerts.length}</span> active ·{' '}
                      <span className="num">{gate.counts.alerts_unacknowledged}</span> unacknowledged
                    </p>
                    <div className="panel__tools">
                      <a className="btn btn--quiet" href={routeHref('alerts')}>
                        All alerts
                      </a>
                    </div>
                  </div>
                  <div className="panel__body">
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
                      readings={gate.readings}
                      thresholds={gate.device.thresholds}
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
                </section>

                <section className="panel" aria-labelledby="dash-events-title">
                  <div className="panel__head">
                    <h2 className="panel__title" id="dash-events-title">
                      Recent events
                    </h2>
                    <p className="panel__sub">Chronological, newest first</p>
                  </div>
                  <EventTimeline
                    dev={dev}
                    events={gateEvents.items}
                    limit={6}
                    onViewAll={viewAllEvents}
                    onLoadMore={loadMoreEvents}
                    loadingMore={events.loadingMore}
                    hasMore={events.hasMore}
                  />
                </section>

                <InventoryPanel dev={dev} snapshot={gate} />
              </div>

              <div className="column">
                <QuickStatsPanel
                  device={gate.device}
                  transport={gate.transport}
                  doorOpenCondition={alerts.some((alert) => alert.condition_key === 'door_open')}
                />

                <section className="panel" aria-labelledby="dash-env-title">
                  <div className="panel__head">
                    <h2 className="panel__title" id="dash-env-title">
                      Environmental conditions
                    </h2>
                    <p className="panel__sub">Six cells · two of them have no sensor fitted</p>
                  </div>
                  <EnvironmentalGrid
                    readings={gate.readings}
                    thresholds={gate.device.thresholds}
                    zoneStatus={gate.device.zone_status}
                    transport={gate.transport}
                    gasWarming={gate.device.gas.warming_or_baselining}
                    gasState={String(gate.device.gas.state)}
                  />
                </section>

                {/* The raw reading strip, with the device facts it carries. It is
                    a readout of the payload rather than a decision surface, so it
                    sits under the panels that report consequences. */}
                <ReadingsPanel
                  device={gate.device}
                  readings={gate.readings}
                  transport={gate.transport}
                  fullSnapshot={gate.device.full_snapshot}
                />

                {/* Diagnostics, last in the rail. Guide §39: the dashboard is for
                    decisions first and diagnostics second, and the fault map is
                    the deepest thing on the page. */}
                <DeviceHealthPanel device={gate.device} readings={gate.readings} transport={gate.transport} />

                <ConditionsPanel />

                <EventLogPanel />

                <ThresholdsPanel dev={dev} />
              </div>
            </div>

            {openMetric === null ? null : (
              <MetricDetail metric={metricById(openMetric)} snapshot={gate} onClose={closeMetric} initialRange={range} />
            )}

            {openAlert === null ? null : (
              <AlertDetail
                alert={openAlert}
                dev={dev}
                snapshot={gate}
                events={gateEvents.items}
                pending={pendingAcks.has(openAlert.condition_key)}
                error={ackErrors.get(openAlert.condition_key)}
                onAcknowledge={acknowledge}
                onUnacknowledge={unacknowledge}
                onClose={closeAlert}
                onViewChart={openChartFor}
              />
            )}
          </>
        );
      }}
    </DeviceGate>
  );
}
