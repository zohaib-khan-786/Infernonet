/**
 * Settings (guide §33).
 *
 * §33 is six sections of editable configuration. This build has no settings store:
 * there is no `/settings` route, no configuration table, and no key under which a
 * saved preference would live. A page with a site-name field and a time-zone
 * selector would look finished and do nothing at all, which is the specific
 * failure guide §33's own neighbours (§33 Alerts, §33 Device, §33 Security,
 * §33 Integrations) make worse rather than better.
 *
 * So the page states the absence once, and then lists every section §33 asks for
 * with an honest account of where that particular setting actually lives today.
 * Several of them are real somewhere else, and saying where is more useful than
 * pretending they are all missing:
 *
 *   Thresholds         real — the limits the device applies, on the Thresholds
 *                      page, with an audit trail of every change
 *   Alert delays        partly real — the door-open timeout is one of the limits
 *                      the device applies; there is no per-metric delay
 *   Users and roles    absent — see the Users page
 *   Site name, zone,   absent — the service has no configuration record
 *   units              absent, and would not be honest to add: every value on
 *                      screen carries the unit the sensor reports, and converting
 *                      at display time would put a second number next to the
 *                      first
 *   sampling interval  the device chooses it (about five seconds) and reports
 *                      the interval it achieved, in samples latched
 *   retention          a service environment variable, FG_READINGS retention, set
 *                      when the backend is started
 *
 * Nothing here is a control. There is not a single `<input>`, `<select>` or
 * `<textarea>` on this page, disabled or otherwise: a field that cannot be saved
 * is a dead control, and a dead control is worse than a missing page because it
 * claims a capability that is one click away.
 */
import { DeviceGate, PageHeader } from '../PageFrame';
import { AbsenceBlock } from '../../components/AbsenceBlock';
import { routeHref } from '../useRoute';

interface Section {
  readonly name: string;
  readonly settings: readonly string[];
  readonly reality: string;
  readonly where: { readonly label: string; readonly href: string } | null;
}

const SECTIONS: readonly Section[] = [
  {
    name: 'General',
    settings: ['Site name', 'Time zone', 'Units'],
    reality:
      'None of the three is stored. The service keeps no configuration record, so a site name has nowhere to live and a time zone nothing to apply it to. Units are deliberately not a setting: every value on screen carries the unit its sensor reports, and a display-time conversion would put a second number beside the first for no gain.',
    where: null,
  },
  {
    name: 'Monitoring',
    settings: ['Sampling interval', 'Telemetry retention', 'Chart defaults'],
    reality:
      'The device chooses its own sampling interval — about five seconds — and reports what it achieved as the latched-sample count, so the effective rate is visible without a setting. Retention is a service environment variable set when the backend starts, not something a browser can change. Chart defaults are per-browser: the trend range is kept in the URL so a link lands on the same view, and that is a convenience rather than a configured default.',
    where: { label: 'Trends and ranges', href: routeHref('monitoring') },
  },
  {
    name: 'Alerts',
    settings: ['Thresholds', 'Notification channels', 'Alert delays'],
    reality:
      'The thresholds are real and are the one configurable surface in the product: eight limits the device applies, with a required citation when they are authoritative and a required note when they are a prototype assumption. Notification channels do not exist — there is no email, no webhook and no push anywhere in the service. The door-open timeout is a real limit; a per-metric delay is not.',
    where: { label: 'Thresholds and audit', href: routeHref('thresholds') },
  },
  {
    name: 'Device',
    settings: ['MQTT', 'Network', 'Firmware'],
    reality:
      'The device does not speak MQTT to this service: it POSTs signed snapshots over HTTP, and the service stores what it accepts. Network configuration is on the device itself. Firmware is reported by the device and shown read-only, because the service has no firmware route and no way to push an update.',
    where: { label: 'Device management', href: routeHref('devices') },
  },
  {
    name: 'Security',
    settings: ['Users', 'Roles', 'API keys', 'Sessions'],
    reality: 'None of the four exists. There is no identity system, so there is nothing to list and nothing to revoke.',
    where: { label: 'Users & roles', href: routeHref('users') },
  },
  {
    name: 'Integrations',
    settings: ['MQTT', 'Backend', 'Email', 'Webhooks'],
    reality:
      'The backend is reachable and is what this page is being served from; the other three do not exist. The device itself would need an MQTT broker configured, which is a change to the device, not to this product.',
    where: null,
  },
];

export default function SettingsPage() {
  return (
    <DeviceGate>
      {({ dev }) => (
        <>
          <PageHeader
            title="Settings"
            lede="There is no settings store behind this page. Every section below says what §33 asks for and where that setting actually lives, if anywhere."
          />

          <AbsenceBlock
            kind="not-available"
            subject="Settings persistence"
            wouldBe="A place for a saved preference to live, and a route that writes it."
            missing={[
              'a settings table or document in the service',
              'a GET or PUT route for settings',
              'any browser-side store beyond the two values already in the URL and local storage: the selected device and the trend range',
            ]}
            why={
              <>
                The read API is devices, a snapshot, inventory, readings, events, conditions, thresholds and one CSV. The
                single write route in the whole product is <span className="num">PUT /thresholds</span>. Everything else is
                a read, which is a deliberate shape for a service that a volunteer can run on a small box: there is very
                little to configure, and what there is, is the safety limits.
              </>
            }
          />

          <section className="panel" aria-labelledby="settings-sections-title">
            <div className="panel__head">
              <h2 className="panel__title" id="settings-sections-title">
                Section by section
              </h2>
              <p className="panel__sub">
                {SECTIONS.length} sections in guide §33 · {dev}
              </p>
            </div>
            <div className="panel__body panel__body--flush">
              <div className="food-table-scroll" tabIndex={0} role="region" aria-label="Settings sections">
                <table className="data-table">
                  <caption className="visually-hidden">
                    Each settings section in guide §33, the settings it contains, and where each of them actually lives in
                    this build.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Section</th>
                      <th scope="col">Settings §33 asks for</th>
                      <th scope="col">Where each one actually lives</th>
                      <th scope="col">Go to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SECTIONS.map((section) => (
                      <tr key={section.name}>
                        <th scope="row" className="cell-head">
                          {section.name}
                        </th>
                        <td>{section.settings.join(', ')}</td>
                        <td>{section.reality}</td>
                        <td>
                          {section.where === null ? (
                            <span className="chip chip--plain">nowhere to go</span>
                          ) : (
                            <a className="btn btn--quiet" href={section.where.href}>
                              {section.where.label}
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel__foot">
              <p className="hint">
                No editable control is rendered anywhere on this page, disabled or otherwise. A field that cannot be
                saved is a dead control, and a dead control is worse than a missing page because it says a capability
                exists and is one click away.
              </p>
            </div>
          </section>
        </>
      )}
    </DeviceGate>
  );
}
