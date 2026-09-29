/**
 * Quick actions (guide §28).
 *
 * §28 asks for four: Export Report, Refresh Data, Scan RFID, Settings. Three of
 * them are real destinations or real operations in this build, and the fourth is
 * on a page that says plainly that it has nowhere to save.
 *
 * §28 also lists a set of extras, and §46.8 requires dangerous actions to be
 * visually separated. There are no dangerous actions here to separate, because
 * there is no restart route and no permission system, so the block that would
 * hold them is rendered with that fact in it rather than with a disabled button
 * that looks like a product decision. The convention is the one the sidebar
 * already uses for a page that has not been built: `aria-disabled` rather than
 * `disabled`, so it stays reachable by keyboard and a screen reader announces
 * why.
 */
import { memo } from 'react';
import { inventoryCsvUrl } from '../api/endpoints';
import { Glyph } from './layout/Glyph';
import { useDashboardActions } from '../store/DashboardProvider';

export interface QuickActionsProps {
  readonly dev: string | null;
  /** Where each destination lives, so the links are the router's links. */
  readonly hrefs: Readonly<Record<'reports' | 'inventory' | 'settings' | 'alerts' | 'thresholds', string>>;
  readonly conditionCount: number;
  readonly unacknowledged: number;
}

export const QuickActions = memo(function QuickActions({ dev, hrefs, conditionCount, unacknowledged }: QuickActionsProps) {
  const { reloadCurrent, reloadEvents } = useDashboardActions();

  return (
    <section className="panel quick-actions" aria-labelledby="quick-actions-title">
      <div className="panel__head">
        <h2 className="panel__title" id="quick-actions-title">
          Quick actions
        </h2>
        <p className="panel__sub">
          {unacknowledged === 0
            ? 'nothing is waiting to be acknowledged'
            : `${unacknowledged} condition${unacknowledged === 1 ? '' : 's'} waiting to be acknowledged`}
        </p>
      </div>

      <div className="panel__body">
        <ul className="quick-actions__list">
          <li>
            <a className="btn" href={hrefs.reports}>
              <Glyph name="shield" />
              Export report
            </a>
            <span className="quick-actions__why">Opens the reports page, which states what can and cannot be exported today.</span>
          </li>
          <li>
            <button type="button" className="btn" onClick={() => { reloadCurrent(); reloadEvents(); }}>
              <Glyph name="cabinet" />
              Refresh data
            </button>
            <span className="quick-actions__why">Re-reads the snapshot and the first page of events from the service.</span>
          </li>
          <li>
            <a className="btn" href={hrefs.inventory}>
              <Glyph name="cabinet" />
              Scan RFID
            </a>
            <span className="quick-actions__why">
              The lookup, not a live scan feed: the service does not store tag reads. See the inventory page.
            </span>
          </li>
          <li>
            <a className="btn" href={hrefs.settings}>
              <Glyph name="menu" />
              Settings
            </a>
            <span className="quick-actions__why">Opens the settings page, which says what has nowhere to save.</span>
          </li>
          <li>
            <a className="btn" href={hrefs.alerts}>
              <Glyph name="shield" />
              Acknowledge alerts
            </a>
            <span className="quick-actions__why">
              Acknowledgement is per condition and is deliberately not offered as one bulk action: it is a statement
              about a specific thing a person looked at, and a button that acknowledges eleven conditions in one click
              records eleven statements nobody made. {conditionCount} active, {unacknowledged} unacknowledged.
            </span>
          </li>
          <li>
            <a className="btn" href={hrefs.thresholds}>
              <Glyph name="cabinet" />
              Thresholds
            </a>
            <span className="quick-actions__why">The limits the device applies, and the audit trail of every change to them.</span>
          </li>
          {dev === null ? null : (
            <li>
              <a className="btn" href={inventoryCsvUrl(dev)} download>
                <Glyph name="shield" />
                Download inventory CSV
              </a>
              <span className="quick-actions__why">
                The one export the service itself serves, so the file is complete whether or not the browser has the rows
                loaded.
              </span>
            </li>
          )}
        </ul>
      </div>

      {/*
        The dangerous block, empty of buttons and explicit about why. §46.8 asks
        for dangerous actions to be visually separated, and the separation that
        matters here is not a rule but an admission.
      */}
      <div className="panel__foot quick-actions__danger">
        <p className="label">Actions that change hardware — none available</p>
        <p className="note">
          §28 lists device restart among the optional extras. It is not rendered as a button: the service exposes no
          restart route, so it would be a control that says a capability exists and is one click away. §23&apos;s cooling
          controls are missing for the same reason and one more — there is no actuator to command and no permission system
          to check first. When either exists, §46.8 requires confirmation on top.
        </p>
      </div>
    </section>
  );
});
