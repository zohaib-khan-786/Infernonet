/**
 * Users & roles (guide §34).
 *
 * This is the page guide §34's own warning is really about. The guide asks for
 * four roles with different powers, and a role dropdown on a page like this would
 * be a permission system that does not exist.
 *
 * There is no session. `DashboardProvider` has no user, no token and no identity
 * of any kind; the read API is unauthenticated; the only credential in the build
 * is a single admin bearer token for one PUT route, and it belongs to the build,
 * not to a person. There is therefore nothing to put in a dropdown, nothing the
 * selection would gate, and nobody it would be selecting for.
 *
 * So the page states the absence, states the four roles as requirements with what
 * each would be able to do, and says plainly which of those abilities the product
 * does and does not have today. That is not a stub: it is the accurate answer, and
 * it is the answer that stops a reader from believing an access-control system is
 * in place. §46.9 requires hardware controls to be permission-protected; a page
 * that showed a role selector would make that requirement look met when nothing
 * enforces it.
 *
 * NO CONTROL IS RENDERED. Not a disabled one either: a role `<select>` with four
 * options and no enforcement behind it is a control that says a capability exists
 * and is one click away, which is the same defect as a dead link and the same
 * thing guide §46.13 is about.
 */
import { DeviceGate, PageHeader } from '../PageFrame';
import { AbsenceBlock } from '../../components/AbsenceBlock';

interface RoleBrief {
  readonly name: string;
  readonly would: string;
  readonly today: string;
}

const ROLES: readonly RoleBrief[] = [
  {
    name: 'Administrator',
    would: 'Everything: limits, devices, users, roles and configuration.',
    today: 'The one real write in the product is PUT /thresholds, and it is guarded by a single build-time bearer token rather than by a person’s role. That is a build credential, not an identity.',
  },
  {
    name: 'Operator',
    would: 'Monitor, acknowledge alerts, manage inventory, produce reports.',
    today: 'Acknowledge and un-acknowledge are real and work for anyone at the URL. The acknowledgement records an optional name typed into a field, and the service does not verify who typed it — the store is explicit that this is a record, not a permission.',
  },
  {
    name: 'Viewer',
    would: 'Read-only.',
    today: 'This is what the build actually is: every read and the live feed are unauthenticated, so anyone who can reach the service can read everything. There is no mode that is read-only, because there is no mode that is anything else.',
  },
  {
    name: 'Maintenance',
    would: 'Diagnostics, hardware, device controls, and no user administration.',
    today: 'The diagnostics page is here and is read-only. The hardware half is absent: there is no restart route, no firmware route and no control output, so there is nothing to protect and nothing to gate.',
  },
];

export default function UsersPage() {
  return (
    <DeviceGate>
      {({ dev }) => (
        <>
          <PageHeader
            title="Users & roles"
            lede="There is no identity system in this product, so this page describes the requirement rather than offering it."
          />

          <AbsenceBlock
            kind="not-available"
            subject="Users, roles and sessions"
            wouldBe="§34’s four roles with the powers listed against each, a role selector, a user list, and a session that says who is looking at the screen."
            missing={[
              'any identity: no user record, no login, no session and no cookie',
              'a role store, so there is nothing for a selector to change',
              'an enforcement point, so there is nothing for a role to gate',
              'an audit of who did what — the threshold history records a name that is typed, not authenticated',
            ]}
            why={
              <>
                <strong>A role dropdown here would be a lie about enforcement.</strong> It would render four options, take a
                selection, and change nothing: the service has no role to check, so every route would behave identically
                whichever one was chosen. A reader who then walked away believing the product had access control would be
                worse off than one who was told it does not — and the person relying on that belief might be the reason a
                limit was changed or a device removed.
              </>
            }
          />

          <section className="panel" aria-labelledby="roles-title">
            <div className="panel__head">
              <h2 className="panel__title" id="roles-title">
                The four roles, as requirements
              </h2>
              <p className="panel__sub">What §34 asks for, and what this build actually has</p>
            </div>
            <div className="panel__body panel__body--flush">
              <div className="food-table-scroll" tabIndex={0} role="region" aria-label="Roles">
                <table className="data-table">
                  <caption className="visually-hidden">
                    The four roles guide §34 defines, with the powers each would have and the state of that ability in
                    this build.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Powers §34 defines</th>
                      <th scope="col">In this build, for {dev}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROLES.map((role) => (
                      <tr key={role.name}>
                        <th scope="row" className="cell-head">
                          {role.name}
                        </th>
                        <td>{role.would}</td>
                        <td>{role.today}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel__foot">
              <p className="hint">
                The header deliberately has no avatar, no user name and no role either, for the same reason: a header that
                said &quot;Operator&quot; would be a claim about who is looking at the screen, and there is nobody to name.
              </p>
            </div>
          </section>

          <AbsenceBlock
            kind="not-available"
            subject="Session and sign-in"
            wouldBe="A signed-in user, a session that can expire, and a last-seen time per account."
            missing={['a session store', 'a sign-in route', 'an account record']}
            why={
              <>
                The read API sets no cookies and takes no credentials on any read. The dashboard is designed to be opened
                on a phone by whoever is standing in front of the cabinet, and the one write it can make is guarded by a
                build-time token. Putting a login in front of that would be a substantial redesign of the service, not a
                page.
              </>
            }
          />
        </>
      )}
    </DeviceGate>
  );
}
