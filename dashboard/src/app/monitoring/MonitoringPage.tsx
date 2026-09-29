/**
 * Live monitoring (guide §7–§13, §26).
 *
 * The destination the sidebar calls "Live Monitoring", and it is the page for
 * "show me the numbers". In order, and by guide §47's priority model:
 *
 *   1. the five metric cards and the drawer behind them (§7, §8)
 *   2. the trends explorer at full size — every range, the legend toggle, the
 *      labelled thresholds, the coverage strip, the in-window event markers and
 *      the CSV export (§9, §26)
 *   3. the environmental 2×3 grid (§10)
 *   4. quick stats: the door, and three absences (§11)
 *   5. the sensor health table (§12)
 *   6. controller diagnostics — an absence (§13)
 *
 * Item 6 is last, and the reason is guide §39 rather than taste: a volunteer
 * opening this page is reading numbers, and a fault-map expansion above the
 * numbers would be the wrong first thing on the screen. The dashboard puts the
 * same block in its right rail for the same reason.
 */
import { useCallback, useState } from 'react';
import { DeviceGate, PageHeader } from '../PageFrame';
import { MetricCardRow } from '../../components/MetricCardRow';
import { MetricDetail } from '../../components/MetricDetail';
import { TrendsExplorer } from '../../components/TrendsExplorer';
import { EnvironmentalGrid } from '../../components/EnvironmentalGrid';
import { QuickStatsPanel } from '../../components/QuickStatsPanel';
import { DeviceHealthPanel } from '../../components/DeviceHealthPanel';
import { AbsenceBlock } from '../../components/AbsenceBlock';
import { metricById, type MetricId } from '../../lib/metrics';
import { isRangeId, type RangeId } from '../../lib/ranges';
import { readParam } from '../../lib/url';
import { useDashboard } from '../../store/DashboardProvider';

function currentRange(): RangeId {
  const requested = readParam('range');
  return isRangeId(requested) ? requested : '6h';
}

export default function MonitoringPage() {
  const [openMetric, setOpenMetric] = useState<MetricId | null>(null);
  const close = useCallback(() => setOpenMetric(null), []);
  const range = currentRange();
  const { alerts } = useDashboard();

  return (
    <DeviceGate>
      {({ dev, snapshot, events }) => (
        <>
          <PageHeader
            title="Live monitoring"
            lede={
              <>
                Everything {dev} is reporting, as it arrives. Values come from the snapshot the service last accepted;
                history comes from the readings endpoint and is drawn on the time the service received each sample.
              </>
            }
          />

          <MetricCardRow snapshot={snapshot} onOpen={setOpenMetric} />

          <TrendsExplorer
            dev={dev}
            thresholds={snapshot.device.thresholds}
            clockTrusted={snapshot.device.time_valid && snapshot.device.reported_at !== null}
            events={events.items}
            heading="Trends"
            subtitle="One plot per measurement on a shared time axis, with the device's own configured band drawn on each and named underneath. Missing data breaks the line rather than being drawn through."
          />

          <section className="panel" aria-labelledby="mon-env-title">
            <div className="panel__head">
              <h2 className="panel__title" id="mon-env-title">
                Environmental conditions
              </h2>
              <p className="panel__sub">Six cells · two of them have no sensor fitted in this build</p>
            </div>
            <EnvironmentalGrid
              readings={snapshot.readings}
              thresholds={snapshot.device.thresholds}
              zoneStatus={snapshot.device.zone_status}
              transport={snapshot.transport}
              gasWarming={snapshot.device.gas.warming_or_baselining}
              gasState={String(snapshot.device.gas.state)}
            />
          </section>

          <div className="columns">
            <div className="column">
              <DeviceHealthPanel device={snapshot.device} readings={snapshot.readings} transport={snapshot.transport} />
            </div>
            <div className="column">
              <QuickStatsPanel
                device={snapshot.device}
                transport={snapshot.transport}
                doorOpenCondition={alerts.some((alert) => alert.condition_key === 'door_open')}
              />

              <AbsenceBlock
                kind="not-installed"
                subject="Controller diagnostics"
                wouldBe="§13's list: CPU temperature, CPU load, memory, storage, network, MQTT connection, last packet, packet loss, sensor status and GPIO status — and, for a Raspberry Pi, throttling and undervoltage."
                missing={[
                  'a host operating system to report load, memory and disk from',
                  'a CPU temperature sensor on the controller',
                  'an MQTT client on the device (it posts to this service over HTTP)',
                  'any packet-loss or GPIO accounting in the snapshot',
                ]}
                why={
                  <>
                    The controller is an ESP8266 running bare firmware, not Linux. It reports uptime, boot count, a
                    reading sequence number, samples latched, a queue depth, its own clock trust and a 16-bit fault map
                    — which is what the sensor health table above is built from. It has no notion of CPU load, and the
                    firmware sends no network statistics at all, so packet loss cannot be computed from anything on this
                    page.
                  </>
                }
              />
            </div>
          </div>

          {openMetric === null ? null : (
            <MetricDetail metric={metricById(openMetric)} snapshot={snapshot} onClose={close} initialRange={range} />
          )}
        </>
      )}
    </DeviceGate>
  );
}
