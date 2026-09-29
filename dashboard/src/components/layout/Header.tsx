/**
 * The global header (guide 5).
 *
 * Left: which device this page is about. Centre-left: the device switch. Right:
 * whether what is on screen is live, and the browser's own clock.
 *
 * WHAT IS NOT HERE, AND WHY
 * -----------------------------------------------------------------------------
 * The guide's header also carries a notification bell, a user avatar, a user
 * name and a role dropdown. None of them exist in this product and none of them
 * are stubbed:
 *
 *   - there is no session. The read API has no user, no token and no identity of
 *     any kind, so an avatar would be a picture of nobody and a role dropdown
 *     would be a permission system that does not exist. A user menu that says
 *     "Operator" is a claim about who is looking at the screen.
 *   - there is no notification source. Alerts are in the snapshot, they are
 *     already rendered in full by ConditionsPanel, and a bell would either count
 *     them a second time in a different place or be a button that does nothing.
 *
 * A dead control is the same defect as a dead link: it says a capability exists
 * and is one click away. Both belong in the phase that builds users (guide 48,
 * phase 8) and the header has room for them then.
 *
 * THE CLOCK IS THE BROWSER'S, AND SAYS SO
 * -----------------------------------------------------------------------------
 * The device has its own clock, and it is not trusted often enough to be shown
 * next to "now" without a word of difference: guide 36 treats an untrusted
 * device clock as the most misleading state in the product, and the page's clock
 * banner exists because of it. So this readout is captioned "browser time" and
 * the device's stamp is only ever rendered as device time, next to the device's
 * own `time_valid` verdict, where the page already puts it.
 */
import { memo, type ReactNode } from 'react';
import { useDashboard } from '../../store/DashboardProvider';
import { useNow } from '../../hooks/useNow';
import { ConnectionIndicator } from './ConnectionIndicator';
import { DeviceSelector } from './DeviceSelector';
import { Glyph } from './Glyph';

const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

/** The browser's own wall clock, ticking. */
const Clock = memo(function Clock() {
  const now = useNow();
  return (
    <p className="app-header__clock">
      <time className="app-header__clock-time" dateTime={new Date(now).toISOString()}>
        {CLOCK.format(now)}
      </time>
      <span className="app-header__clock-caption">browser time</span>
    </p>
  );
});

export interface HeaderProps {
  /**
   * Drawer controls. Rendered here because the header is the only persistent
   * chrome, and a trigger that scrolls away with the page is not a trigger.
   */
  readonly navToggle?: ReactNode;
}

export const Header = memo(function Header({ navToggle }: HeaderProps) {
  const { dev, snapshot } = useDashboard();

  // The device's own id, once it has one. `snapshot.device.dev` and `dev` are
  // the same string and using the store's `dev` keeps the header correct during
  // the window where a snapshot is still loading.
  const name = dev;
  const firmware = snapshot?.device.firmware ?? null;

  return (
    // `on-dark` is base.css's bezel focus-ring variant: --accent-on-dark is
    // 9.56:1 on this surface where the default --accent-focus ring's halo is
    // tuned for a light panel.
    <header className="app-header on-dark">
      {navToggle}

      <div className="app-header__identity">
        <Glyph name="cabinet" className="app-header__cabinet" />
        <div className="app-header__titles">
          <h1 className={name === null ? 'app-header__title app-header__title--empty' : 'app-header__title'}>
            {name ?? 'FreshGuard — no device has reported'}
          </h1>
          <p className="app-header__meta">
            {name === null ? (
              'Nothing to show until a device sends its first snapshot.'
            ) : firmware === null ? (
              /* An absence is a sentence. The device did not report a firmware
               * version, and rendering that as a dash would read as a version
               * nobody has filled in yet. */
              'firmware not reported'
            ) : (
              <span translate="no">firmware {firmware}</span>
            )}
          </p>
        </div>
      </div>

      <div className="app-header__tools">
        <ConnectionIndicator />
        <DeviceSelector />
        <Clock />
      </div>
    </header>
  );
});
