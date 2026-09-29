/**
 * Reports (guide §27).
 *
 * §27 lists six report types, three filters and three actions. The service has
 * no report route, no renderer, no scheduler and no PDF, so none of the six is
 * generated and no Export PDF button exists.
 *
 * The interesting judgement on this page is what to do instead of nothing.
 * Three of the six report types are, in their raw form, genuinely available
 * today:
 *
 *   Temperature report     yes — the readings endpoint, and the trends page
 *                          already exports exactly the rows it plots
 *   Food storage report    yes — the service's own CSV endpoint, complete on
 *                          the server rather than in the browser
 *   Alert report           partly — the conditions and the event log, and the
 *                          event log's CSV covers the transitions
 *   Device health report   yes — a snapshot of the device block, and the health
 *                          table already prints every field it holds
 *   Energy report          no — there is no energy meter
 *   Audit report           yes — the threshold history endpoint, which is a
 *                          complete audit of every configuration change
 *
 * So this page does two things: it says plainly that the report service does not
 * exist, and then it lists the five things that genuinely can be exported, with
 * the route or the endpoint each one lives behind. That is not a report
 * generator and it is not dressed up as one — every row says where the data comes
 * from, and three of the six guide types are marked as unavailable for the same
 * hardware reason as the rest of the product.
 *
 * Nothing here is a control that saves nowhere. There is no form, no date
 * picker wired to nothing, and no disabled "Generate PDF" button: a button that
 * cannot produce a document is worse than its absence, because it is a promise.
 */
import { DeviceGate, PageHeader } from '../PageFrame';
import { AbsenceBlock } from '../../components/AbsenceBlock';
import { inventoryCsvUrl } from '../../api/endpoints';
import { routeHref } from '../useRoute';

export default function ReportsPage() {
  return (
    <DeviceGate>
      {({ dev, snapshot }) => (
        <>
          <PageHeader
            title="Reports"
            lede={
              <>
                {dev} has no report service. This page says what that rules out, and lists the exports that are real
                today and where each one lives.
              </>
            }
          />

          <AbsenceBlock
            kind="not-available"
            subject="Report generation"
            wouldBe="§27’s six reports — temperature, food storage, energy, device health, alert and audit — with a device filter, a date range, a preview, and PDF and CSV exports."
            missing={[
              'a report route on the service: there is no /reports endpoint',
              'a renderer, so there is nothing to preview and nothing to turn into a PDF',
              'a scheduler, so there is no emailed or recurring report',
              'a document model, so a filtered report has no fixed set of pages',
            ]}
            why={
              <>
                The read API is a read API: devices, a snapshot, inventory, readings, events, conditions, thresholds and
                one CSV. Every one of them returns JSON except the CSV. Building reports on top of it is a real piece of
                work, and doing it by assembling a page in the browser and calling it a report would produce something that
                looks like the deliverable and is not one — which is the shape of thing guide §46.13 exists to prevent.
              </>
            }
          />

          <section className="panel" aria-labelledby="reports-real-title">
            <div className="panel__head">
              <h2 className="panel__title" id="reports-real-title">
                What can be exported today
              </h2>
              <p className="panel__sub">
                {dev} · each row says where its data comes from
              </p>
            </div>

            <div className="panel__body panel__body--flush">
              <div className="food-table-scroll" tabIndex={0} role="region" aria-label="Available exports">
                <table className="data-table">
                  <caption className="visually-hidden">
                    Exports available for device {dev} in this build, with the endpoint each one comes from.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Report</th>
                      <th scope="col">What it covers</th>
                      <th scope="col">Where the data comes from</th>
                      <th scope="col">Export</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row" className="cell-head">
                        Temperature
                      </th>
                      <td>
                        Temperature, humidity, pressure and the gas figures over a chosen range, with the device&apos;s own
                        configured band and the bucket the service used.
                      </td>
                      <td>
                        <span className="num">GET /readings</span> · generated in the browser from the rows on screen
                      </td>
                      <td>
                        <a className="btn btn--quiet" href={routeHref('monitoring')}>
                          Trends &amp; export CSV
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="cell-head">
                        Food storage
                      </th>
                      <td>Every item, active and retired, with the device&apos;s verdict, its own dates and its revisions.</td>
                      <td>
                        <span className="num">GET /inventory/export.csv</span> · served by the service, so the file is
                        complete server-side
                      </td>
                      <td>
                        <a className="btn btn--quiet" href={inventoryCsvUrl(dev)} download>
                          Download CSV
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="cell-head">
                        Alert
                      </th>
                      <td>
                        The event log: every transition the device recorded, filtered by type, date and free text, plus
                        the acknowledgements recorded against active conditions.
                      </td>
                      <td>
                        <span className="num">GET /events</span> · generated in the browser from the filtered rows
                      </td>
                      <td>
                        <a className="btn btn--quiet" href={routeHref('logs')}>
                          Event log &amp; export
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="cell-head">
                        Device health
                      </th>
                      <td>
                        The whole device block as the service holds it: verdict, fault mask, uptime, sequence, queue depth,
                        clock trust, thresholds and provenance. Every field, including the ones this dashboard marks as
                        not reported.
                      </td>
                      <td>
                        <span className="num">GET /devices</span> · the device table prints all of it
                      </td>
                      <td>
                        <a className="btn btn--quiet" href={routeHref('devices')}>
                          Devices
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="cell-head">
                        Audit
                      </th>
                      <td>
                        Every configuration change to the limits, with the previous value, the new value, the reason and
                        the name. Nothing has been overwritten.
                      </td>
                      <td>
                        <span className="num">GET /thresholds/history</span> · the audit trail page
                      </td>
                      <td>
                        <a className="btn btn--quiet" href={routeHref('thresholds')}>
                          Thresholds &amp; audit
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="cell-head">
                        Energy
                      </th>
                      <td>Nothing. There is no energy meter, so there is no series to aggregate.</td>
                      <td>
                        <span className="num">not available</span> · no metering hardware exists
                      </td>
                      <td>
                        <span className="chip chip--plain">Not available</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel__foot">
              <p className="hint">
                The three CSVs generated in the browser cover exactly the rows on screen when the button is pressed, and
                the button says so. The one served by the service is complete whether or not this browser has loaded the
                rows. A CSV that silently covered a different set of rows than the table above it would be a file nobody
                could check.
              </p>
            </div>
          </section>

          <AbsenceBlock
            kind="not-available"
            subject="PDF export"
            wouldBe="A printable document with a title page, the filtered tables, the charts and a signature block."
            missing={['a renderer in the service', 'a print stylesheet for a composed report', 'a document store to render from']}
            why={
              <>
                Printing the page you are on is available — the design system carries a print stylesheet, and it keeps
                the verdict, the shapes and the words, because a sheet taped inside a cabinet door has to survive a
                photocopier. What does not exist is composing a report, paginating it and handing it over as a file.
              </>
            }
          />

          <p className="hint">
            The cabinet is currently reporting {snapshot.device.overall_status.label} overall and{' '}
            {snapshot.device.zone_status.label} for the zone. The verdict and its meaning are on the dashboard, which is
            the right place for them.
          </p>
        </>
      )}
    </DeviceGate>
  );
}
