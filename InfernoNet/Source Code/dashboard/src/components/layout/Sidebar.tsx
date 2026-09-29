/**
 * The sidebar (guide 4): brand block, navigation, and the status card at the
 * bottom.
 *
 * A column in the shell grid on a laptop or a desktop, an off-canvas drawer
 * below 1024px. AppShell owns which of the two is happening and passes the close
 * control down; the sidebar itself does not care.
 *
 * THE BRAND BLOCK
 * -----------------------------------------------------------------------------
 * Logo, name, subtitle and the running version, which is the whole of guide 4's
 * brand area. The wordmark is a `<p>`, not a heading: the page's `h1` is the
 * device the header is about, and two `h1`s in one document is not a hierarchy.
 *
 * THE STATUS CARD
 * -----------------------------------------------------------------------------
 * Guide 4 asks for a card that reads one of three things - system online,
 * degraded, offline - and this is built by counting the SERVICE's own per-device
 * `transport.stale`. That is a statement about links and nothing else.
 *
 * Specifically, it is not a verdict and it does not read like one:
 *
 *   - "All systems operational" from the guide is not the copy used. It is a
 *     claim about the whole installation, and a link status cannot support it: a
 *     device can be reporting perfectly and have food in it that the device
 *     itself has marked `check_food`. The card says what it knows - how many
 *     devices are reporting - and stops.
 *   - the lamps take the transport colours, never the status palette. Green in
 *     this system means the device said `fresh` about stored food, and a green
 *     dot for "the network is fine" would spend a colour that already means
 *     something else.
 *   - the words are always present (guide 37), so the state survives greyscale,
 *     forced colours and a colourblind reader.
 */
import { memo, type ReactNode, type Ref } from 'react';
import { count } from '../../lib/format';
import { useDashboard } from '../../store/DashboardProvider';
import { APP_VERSION } from '../../app/version';
import { useRoute } from '../../app/useRoute';
import { Glyph } from './Glyph';
import { NAV_ID, NAV_SECTIONS, PLANNED_DESCRIPTION, type NavItem } from './navigation';

/** Stable identity for the no-op, so a rail sidebar does not re-render every row. */
const NOOP = (): void => undefined;

/** One nav row. A real link when the page exists, a disabled button when it does not. */
const NavRow = memo(function NavRow({
  item,
  onNavigate,
  active,
}: {
  readonly item: NavItem;
  readonly onNavigate: () => void;
  readonly active: boolean;
}) {
  if (item.href === null) {
    return (
      <li>
        <button
          type="button"
          className="nav-item"
          // `aria-disabled`, not `disabled`: a `disabled` button is out of the
          // tab order, and a keyboard user must still be able to find out the
          // destination exists. Clicking it does nothing because there is
          // nothing to go to, which is also why it is not a link - see
          // navigation.ts.
          aria-disabled="true"
          aria-describedby="nav-planned-note"
        >
          <span className="nav-item__label">{item.label}</span>
          <span className="chip chip--plain">Not built</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <a
        className="nav-item"
        href={item.href}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
      >
        <span className="nav-item__label">{item.label}</span>
      </a>
    </li>
  );
});

/** The card. Counts the service's own per-device link state; renders no verdict. */
const StatusCard = memo(function StatusCard() {
  const { devices, devicesLoading } = useDashboard();

  if (devicesLoading && devices.length === 0) {
    return (
      <div className="link-state sidebar__status" data-link="down">
        <span className="link-state__dot" aria-hidden="true" />
        <span className="sidebar__status-word">Checking</span>
        <span className="sidebar__status-sentence">Asking the service which devices it knows.</span>
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="link-state sidebar__status" data-link="down">
        <span className="link-state__dot" aria-hidden="true" />
        <span className="sidebar__status-word">No devices</span>
        <span className="sidebar__status-sentence">
          The service has not received a snapshot from any device, so there is nothing to report on.
        </span>
      </div>
    );
  }

  const quiet = devices.filter((entry) => entry.transport.stale).length;
  const reporting = devices.length - quiet;
  const lamp = quiet === 0 ? 'live' : reporting === 0 ? 'down' : 'waiting';
  const word = quiet === 0 ? 'System online' : reporting === 0 ? 'Offline' : 'Degraded';
  const sentence =
    quiet === 0
      ? 'Every device is reporting. This is about the connection, not about the food.'
      : reporting === 0
        ? 'Live telemetry unavailable. Every device has stopped reporting.'
        : `${count(quiet, 'device')} stopped reporting; the rest are still reporting.`;

  return (
    <div className="link-state sidebar__status" data-link={lamp}>
      <span className="link-state__dot" aria-hidden="true" />
      <span className="sidebar__status-word">{word}</span>
      <span className="sidebar__status-sentence">{sentence}</span>
      {/* The counts are the same two facts the sentence already states in words,
          so they are hidden from the tree rather than read out twice. */}
      <p className="sidebar__status-counts" aria-hidden="true">
        <span className="status-band__stat">
          <span className="status-band__stat-value num">{reporting}</span>
          <span>reporting</span>
        </span>
        {quiet === 0 ? null : (
          <span className="status-band__stat">
            <span className="status-band__stat-value num">{quiet}</span>
            <span>quiet</span>
          </span>
        )}
      </p>
    </div>
  );
});

export interface SidebarProps {
  /**
   * `true` while the sidebar is an off-canvas drawer that is not open. It is
   * then off screen by `translateX(-100%)` and nothing else, and a transform does
   * not remove anything from the tab order or from the accessibility tree - so a
   * phone user Tabbing through the page would walk into eleven invisible
   * navigation links and a screen reader would still offer the drawer as a
   * landmark. `inert` is the fix for both at once.
   */
  readonly inert?: boolean | undefined;
  /**
   * On the `<nav>` so focus can be moved onto it when the drawer opens: a
   * focused landmark is announced by name, which is how a screen-reader user
   * finds out the drawer is a drawer. It is `tabIndex={-1}` there for the same
   * reason it is not a tab stop on the rail.
   */
  readonly navRef?: Ref<HTMLElement>;
  /** Rendered beside the wordmark in drawer mode. `null` on the rail. */
  readonly closeControl?: ReactNode;
  /**
   * Called after a destination is chosen, so a drawer can close itself. The
   * explicit `| undefined` is this project's `exactOptionalPropertyTypes`, which
   * will not let a caller pass `undefined` for an optional prop that does not
   * name it.
   */
  readonly onNavigate?: (() => void) | undefined;
}

export const Sidebar = memo(function Sidebar({ inert, navRef, closeControl, onNavigate }: SidebarProps) {
  const afterNavigate = onNavigate ?? NOOP;
  // Subscribing to the route here is what keeps `aria-current="page"` on the
  // destination the reader is actually looking at, and the list itself is data,
  // so this is the only subscription the nav needs.
  const active = useRoute();

  return (
    <div className="app-sidebar" inert={inert}>
      <div className="sidebar__brand">
        <Glyph name="shield" className="sidebar__shield" />
        <p className="sidebar__wordmark">
          <span className="sidebar__name">FreshGuard</span>
          <span className="sidebar__tagline">Cold-Storage Safety Monitor</span>
          <span className="sidebar__version">v{APP_VERSION}</span>
        </p>
        {closeControl}
      </div>

      <nav className="sidebar__nav" id={NAV_ID} aria-label="FreshGuard sections" ref={navRef} tabIndex={-1}>
        {NAV_SECTIONS.map((section) => (
          <section className="nav-section" key={section.id} aria-labelledby={`nav-${section.id}`}>
            <h2 className="nav-section__title" id={`nav-${section.id}`}>
              {section.title}
            </h2>
            <ul className="nav-section__list">
              {section.items.map((item) => (
                <NavRow key={item.id} item={item} onNavigate={afterNavigate} active={item.id === active} />
              ))}
            </ul>
          </section>
        ))}

        {/* Referenced by `aria-describedby` from every not-yet-built item, so it
            is a real element with a real id rather than the same sentence eleven
            times. Written once, read on demand. */}
        <p className="hint sidebar__note" id="nav-planned-note">
          {PLANNED_DESCRIPTION} Only the dashboard is in this build; the rest arrive in later phases.
        </p>
      </nav>

      <StatusCard />
    </div>
  );
});
