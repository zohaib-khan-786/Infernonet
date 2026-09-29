/**
 * A drawer: an in-page panel that takes the reading position.
 *
 * Guide §8 and §17 both end in "opens the detail drawer", and guide §38 asks for
 * modal focus trapping, so this is the component both of them use rather than
 * two near-identical ones.
 *
 * WHY NOT `<dialog>` + `showModal()`
 * -----------------------------------------------------------------------------
 * The native modal dialog does the focus trapping correctly and would be one
 * line less. It is not used here for one reason that is not preference: it
 * renders in the top layer, so a drawer that is part of a grid column — which is
 * where the inventory item drawer and the metric drawer both sit — would be
 * lifted out of that column and centred over the whole viewport, and the page
 * behind it would be `inert` without the layout being able to say so. The
 * metric drawer in particular is opened from a KPI card and has to stay visually
 * attached to it on a laptop.
 *
 * So the trap is hand-written, and it is small:
 *
 *   - the panel itself is `tabIndex={-1}` and takes focus on open, so a screen
 *     reader lands on the heading rather than on whatever was last focused
 *   - Tab and Shift+Tab wrap inside the panel, computed from the focusable
 *     children that exist at the time of the keypress rather than from a cached
 *     list, so a control that is disabled mid-drawer cannot trap the keyboard
 *   - Escape closes
 *   - the element that had focus before opening gets it back on close
 *
 * The rest of the page is not inert. A full-page `inert` would need AppShell's
 * cooperation, and a shell that is not this pass's to change is a worse trade
 * than a correct Tab loop in the one place focus is supposed to be held.
 */
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  readonly open: boolean;
  /** Must be stable: it is in the effect's dependency list, and a new function on
   *  every render would close and re-open the drawer visually each time. */
  readonly onClose: () => void;
  /** The word used in the close control and in the heading. */
  readonly title: string;
  /** Optional line under the title. */
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  /** Rendered in the head, beside the close control. */
  readonly tools?: ReactNode;
}

export function Drawer({ open, onClose, title, subtitle, children, tools }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();
  const describedById = useId();

  // Focus goes back where it came from, and only when there was somewhere to go
  // back to. Mounting a drawer from a click means there always is.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      previous?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (panel === null) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const onBackdrop = useCallback(() => onClose(), [onClose]);

  if (!open) return null;

  return (
    <div className="drawer-layer" onMouseDown={onBackdrop}>
      {/*
        The panel stops the backdrop's mousedown from reaching it. `onMouseDown`
        rather than `onClick` on the backdrop, so a drag that starts inside the
        panel and ends on the scrim does not close it.
      */}
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={subtitle === undefined ? undefined : describedById}
        tabIndex={-1}
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer__head">
          <div className="drawer__titles">
            <h2 className="drawer__title" id={headingId}>
              {title}
            </h2>
            {subtitle === undefined ? null : (
              <p className="drawer__sub" id={describedById}>
                {subtitle}
              </p>
            )}
          </div>
          <div className="drawer__tools">
            {tools}
            <button type="button" className="btn btn--quiet" onClick={onClose} aria-label={`Close ${title}`}>
              Close
            </button>
          </div>
        </div>
        <div className="drawer__body">{children}</div>
      </div>
    </div>
  );
}
