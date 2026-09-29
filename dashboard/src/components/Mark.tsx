/**
 * Status shape marks.
 *
 * The redundant channel that makes colour optional. Five shapes, five meanings,
 * each legible in greyscale, at 13px, and to a reader who sees one colour.
 * The hatched fill for `sensor_fault` is a second, non-colour signal: it is
 * what a lab instrument prints when it has no data.
 */
import { memo, type ReactElement } from 'react';
import type { Shape } from '../lib/status';

export interface MarkProps {
  readonly shape: Shape;
  /** Decorative by default: the word next to it carries the meaning. */
  readonly label?: string;
  readonly className?: string;
}

/** The hatch pattern every `hatched-diamond` references. Rendered once, in App. */
export function MarkDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="visually-hidden">
      <defs>
        <pattern id="fg-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          {/* The hatch belongs to sensor_fault and to nothing else, so it is
              painted from the sensor-fault tokens directly. It used to read
              `var(--tone-tint, #e2e7ea)`, but this element is rendered once at
              the top of the tree, outside every tone scope, so the var() could
              never resolve and only the off-palette fallback ever painted. */}
          <rect width="6" height="6" fill="var(--status-sensor-fault-tint)" />
          <rect width="3" height="6" fill="var(--status-sensor-fault-edge)" opacity="0.85" />
        </pattern>
      </defs>
    </svg>
  );
}

const PATHS: Readonly<Record<Shape, ReactElement>> = {
  circle: <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.5" />,
  triangle: <path d="M12 3.5 21.2 19.5H2.8Z" fill="currentColor" />,
  square: <rect x="4.5" y="4.5" width="15" height="15" fill="currentColor" />,
  diamond: <path d="M12 3 21 12 12 21 3 12Z" fill="currentColor" />,
  'hatched-diamond': (
    <path
      d="M12 2.5 21.5 12 12 21.5 2.5 12Z"
      fill="url(#fg-hatch)"
      stroke="currentColor"
      strokeWidth="2"
    />
  ),
  'slashed-circle': (
    <g fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="8" />
      <path d="M6.5 17.5 17.5 6.5" />
    </g>
  ),
};

export const Mark = memo(function Mark({ shape, label, className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ? `mark ${className}` : 'mark'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      {PATHS[shape]}
    </svg>
  );
});
