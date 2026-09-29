/**
 * The card sparkline (guide §7's "mini sparkline").
 *
 * Deliberately the smallest thing that can be honest:
 *
 *   - no axis, no scale, no grid, no threshold line. It is a shape, not a
 *     chart, and §2 forbids decorative charts. The numbers, the range and the
 *     full plot with a threshold band and a non-visual table are in the metric
 *     detail drawer, one click away.
 *   - `aria-hidden`, because the value, the unit, the timestamp and the device's
 *     own verdict are already real text on the card, and a screen reader given a
 *     20-point path to describe would be reciting the data twice.
 *   - a gap is drawn as a gap. One broken line, not a straight one through a
 *     power cut, for the reason `LineChart` gives.
 *   - nothing at all when there are no values, so a card never shows an empty
 *     frame that could be mistaken for a flat line.
 */
import { memo, useLayoutEffect, useRef, useState } from 'react';

const HEIGHT = 34;
const PAD = 2;

function useWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const apply = (next: number): void => setWidth((previous) => (next > 0 && Math.abs(next - previous) > 1 ? next : previous));
    apply(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export interface SparklineProps {
  /** Values in time order. `null` marks a point with no value. */
  readonly values: readonly (number | null)[];
  /** Sentence for assistive technology, or null to hide the whole thing. */
  readonly title: string | null;
}

export const Sparkline = memo(function Sparkline({ values, title }: SparklineProps) {
  const { ref, width } = useWidth();

  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (present.length === 0) return null;

  const lo = Math.min(...present);
  const hi = Math.max(...present);
  const span = hi - lo || 1;
  const step = values.length > 1 ? (width - PAD * 2) / (values.length - 1) : 0;
  const x = (index: number): number => PAD + (values.length > 1 ? index * step : (width - PAD * 2) / 2);
  const y = (value: number): number => HEIGHT - PAD - ((value - lo) / span) * (HEIGHT - PAD * 2);

  // A break wider than two and a half nominal steps is a hole in time, not a
  // fast change. Same rule as LineChart, and for the same reason.
  const gapLimit = Math.max(step * 2.5, 1);
  const runs: string[] = [];
  let current: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 0) runs.push(current.join(' '));
      current = [];
      continue;
    }
    if (index > 0) {
      const previous = values[index - 1];
      if (previous === null || !Number.isFinite(previous) || (x(index) - x(index - 1)) > gapLimit) {
        if (current.length > 0) runs.push(current.join(' '));
        current = [];
      }
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`);
  }
  if (current.length > 0) runs.push(current.join(' '));

  let lastIndex = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== null) lastIndex = index;
  }
  const lastValue = lastIndex >= 0 ? values[lastIndex] ?? null : null;

  return (
    <div ref={ref} className="sparkline" aria-hidden={title === null ? 'true' : undefined} role={title === null ? undefined : 'img'} aria-label={title ?? undefined}>
      {width === 0 ? null : (
        <svg className="sparkline__plot" viewBox={`0 0 ${Math.round(width)} ${HEIGHT}`} width={Math.round(width)} height={HEIGHT} focusable="false">
          <path className="sparkline__series" d={runs.join(' ')} />
          {lastValue === null ? null : <circle className="sparkline__last" cx={x(lastIndex)} cy={y(lastValue)} r="2.5" />}
        </svg>
      )}
    </div>
  );
});
