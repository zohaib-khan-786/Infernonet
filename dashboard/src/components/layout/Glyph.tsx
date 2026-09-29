/**
 * Interface glyphs.
 *
 * Four shapes, all of them non-semantic: a shield for the product, a cabinet for
 * a device, a hamburger and a cross for the drawer. They are deliberately NOT in
 * `Mark.tsx`, because every shape in that file is a status — circle is fresh,
 * triangle is use-soon, square is check-food, diamond is a fact about the
 * monitor — and the mapping between them and the four device verdicts is a
 * contract held in three files at once. Adding a hamburger to that set would put
 * a navigation control into the vocabulary a volunteer learns to read verdicts
 * with, and would eventually be picked up by `groupAlerts` or a `Tone` union
 * because nothing would say it could not be.
 *
 * So: separate file, separate name, one rule — a glyph here never carries state
 * and never carries a meaning that a word does not also carry. All four are
 * `aria-hidden` and `focusable="false"`, and every one of them sits next to a
 * visible label or an `aria-label` on its control.
 *
 * The viewBox is 24×24 and the stroke is 2 units, which is `Mark`'s 2.5 within
 * a stroke, so a glyph and a status mark have the same visual weight at the
 * same size. `.glyph` is sized in shell.css for the same reason `.mark` is sized
 * in components.css: an inline `<svg>` with a viewBox and no width or height
 * has no intrinsic size, and inside a flex button it collapses or balloons.
 */
import { memo, type ReactElement } from 'react';

export type GlyphName = 'shield' | 'cabinet' | 'menu' | 'close';

const PATHS: Readonly<Record<GlyphName, ReactElement>> = {
  // A shield, because the product's job is to guard stored food. No check mark
  // inside it: a tick is a verdict shape in this system.
  shield: <path d="M12 2.5 20 5v6.2c0 4.6-3.2 8.4-8 10.3-4.8-1.9-8-5.7-8-10.3V5Z" />,
  // A cold cabinet: door line, handle, and the three vents along the bottom that
  // every refrigerated cabinet has. It is a picture of the thing, not a
  // temperature, and nothing reads a value out of it.
  cabinet: (
    <g>
      <rect x="5" y="2.5" width="14" height="19" rx="1.5" />
      <path d="M5 12.5h14" />
      <path d="M8 5.5v4" />
      <path d="M8 15h8M8 17.5h8" />
    </g>
  ),
  menu: <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export interface GlyphProps {
  readonly name: GlyphName;
  /** The class to put on the `<svg>`, normally the size rule in the stylesheet. */
  readonly className?: string;
}

export const Glyph = memo(function Glyph({ name, className }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className === undefined ? 'glyph' : `glyph ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
});
