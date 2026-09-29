/**
 * The application shell (guide 3 and guide 41).
 *
 * Sidebar, header, content. That is the whole component, and it is the whole of
 * Phase 1: everything below the frame is a page, and pages are the next passes.
 *
 * WHAT THIS FILE OWNS
 * -----------------------------------------------------------------------------
 * Three things that are decisions rather than markup, and that would otherwise
 * be repeated in every page:
 *
 *   1. Whether the sidebar is a column or a drawer. One `matchMedia`, the same
 *      64rem boundary the CSS uses, and no other source of truth.
 *   2. What happens to the rest of the page while the drawer is open. Answered
 *      with `inert`, which is the whole focus trap - see the note on
 *      `trapped` below.
 *   3. The skip link, which has to be the first focusable thing in the document
 *      and has to exist before anything else renders.
 *
 * THE GRID IS THE PAGE'S GRID
 * -----------------------------------------------------------------------------
 * `.app-shell__content` is a 12-column grid and every child spans all twelve by
 * default, so a page is written top to bottom and places nothing itself. The
 * shell ships no `span-*` classes; they would be twelve rules with no user until
 * the dashboard page exists to place a card.
 *
 * WHY THE SKIP LINK SAYS "SKIP TO THE DEVICE VERDICT"
 * -----------------------------------------------------------------------------
 * Because that is what it does. The verdict is the first thing inside `<main>`
 * and the thing a volunteer opened the page for. "Skip to the content" would be
 * a true sentence about a place and no help at all; "skip to the readings" named
 * a panel four panels down, and on the no-device path named nothing.
 *
 * `tabIndex={-1}` on `<main>` is load-bearing: Safari will not move focus to a
 * fragment target that is not natively focusable, so without it the link scrolls
 * the page and leaves focus up in the header.
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MarkDefs } from '../Mark';
import { Glyph } from './Glyph';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { NAV_ID } from './navigation';

/**
 * The rail/drawer boundary. 64rem = 1024px, and it is the guide's own laptop
 * floor: at and above it the sidebar is always visible, below it the sidebar is
 * something you open. The CSS spells the same number out in
 * `@media (max-width: 63.9375rem)`; this is the only place in JavaScript that
 * knows it, and it has to agree with that one rule or the toggle will appear on
 * a layout that has nowhere to put it.
 */
const DRAWER_QUERY = '(max-width: 63.9375rem)';

export interface AppShellProps {
  /** The page. Rendered into the content well, full width by default. */
  readonly children: ReactNode;
}

export const AppShell = memo(function AppShell({ children }: AppShellProps) {
  // `null` until the media query has been read, so the first paint cannot put a
  // drawer on a desktop or a rail on a phone. The header and sidebar both
  // tolerate it: the toggle is not rendered until the mode is known.
  const [isRail, setIsRail] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Set when the drawer is closing because a destination was chosen. The browser
  // moves focus to the fragment target in that case, and handing focus back to
  // the trigger would undo the one thing the user just asked for.
  const keepFocus = useRef(false);

  useEffect(() => {
    const query = window.matchMedia(DRAWER_QUERY);
    const sync = (): void => {
      setIsRail(!query.matches);
      // Crossing the boundary closes the drawer rather than leaving a scrim over
      // a layout that no longer has a drawer in it.
      setOpen(false);
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  /** Close after a destination was chosen, and leave focus where the browser puts it. */
  const afterNavigate = useCallback(() => {
    keepFocus.current = true;
    setOpen(false);
  }, []);

  // Focus in on open, focus back to the trigger on close. Seeded from a ref so
  // mounting the page never steals focus, and it only ever moves on a real
  // transition of the drawer's own state.
  useEffect(() => {
    if (open) {
      navRef.current?.focus();
    } else if (wasOpen.current && !keepFocus.current) {
      // On a rail there is no trigger rendered, so this is a no-op - which is
      // right: the layout just stopped being a drawer and there is nothing to
      // hand focus back to.
      toggleRef.current?.focus();
    }
    wasOpen.current = open;
    keepFocus.current = false;
  }, [open]);

  // Escape closes. Bound only while the drawer is open, so the key does nothing
  // at all on a desktop instead of intercepting a key the page might want.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const drawerMode = isRail === false;
  /**
   * The focus trap, in one attribute.
   *
   * With the page inert and the drawer left live, the drawer is the only
   * focusable content in the document, so Tab cannot leave it. The alternative -
   * a keydown loop cycling a list of focusable children - has to be re-implemented
   * correctly for every control the shell will ever gain, and gets it wrong the
   * first time a control is added to a portal. `inert` also takes the hidden nav
   * out of the accessibility tree, which a transform does not: an off-canvas nav
   * that is still in the tree is still read out by a screen reader that walks
   * the landmarks.
   */
  const trapped = drawerMode && open;

  return (
    <div className="app-shell" data-nav={open ? 'open' : 'closed'}>
      {/* The hatch pattern every `sensor_fault` mark references, rendered once
          for the whole app. It was in App.tsx before the shell existed. */}
      <MarkDefs />

      <a className="skip-link" href="#main-content" inert={trapped}>
        Skip to the device verdict
      </a>

      <Sidebar
        // A closed drawer is off screen and nothing else, so it is inert: a
        // transform does not take eleven links out of the tab order.
        inert={drawerMode && !open}
        navRef={navRef}
        onNavigate={drawerMode ? afterNavigate : undefined}
        closeControl={
          drawerMode ? (
            <button
              type="button"
              className="btn btn--quiet sidebar__close"
              onClick={close}
              aria-label="Close navigation"
              title="Close navigation"
            >
              <Glyph name="close" />
            </button>
          ) : null
        }
      />

      {/*
        A pointer-only affordance, and deliberately not a button. It is a
        redundant way to dismiss the drawer; the accessible ways are Escape, the
        close button inside the drawer and the header's own trigger, and a
        fourth focusable element labelled "close" that sits under a scrim would be
        a control nobody can see. `aria-hidden` says so rather than leaving a
        silent region in the tree.
      */}
      {trapped ? (
        <div className="app-shell__scrim" aria-hidden="true" onClick={close} />
      ) : null}

      <div className="app-shell__body" inert={trapped}>
        <Header
          navToggle={
            drawerMode ? (
              <button
                type="button"
                ref={toggleRef}
                className="btn btn--quiet"
                onClick={() => setOpen((was) => !was)}
                aria-expanded={open}
                aria-controls={NAV_ID}
                aria-label={open ? 'Close navigation' : 'Open navigation'}
                title={open ? 'Close navigation' : 'Open navigation'}
              >
                <Glyph name="menu" />
              </button>
            ) : null
          }
        />

        <main className="app-shell__content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
});
