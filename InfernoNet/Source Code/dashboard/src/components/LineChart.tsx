/**
 * A hand-rolled SVG line chart. No charting library.
 *
 * What it has to get right, in order of importance:
 *
 *   A real time axis. Ticks are chosen from a ladder of human intervals and
 *   labelled through `Intl`, so the axis reads as a clock rather than as a
 *   pixel offset. The x position is the time the *service received* the
 *   sample - the backend stores that as `recorded_at` - which is stated on the
 *   axis so nobody mistakes it for the device's own clock.
 *
 *   Honest gaps. The line breaks on a null value, and it also breaks where the
 *   time between two points is more than about two and a half buckets wide,
 *   because a straight line drawn through an hour of power-off is a lie. A
 *   broken line is a gap; the axis and the point count say how many.
 *
 *   A non-visual equivalent. Each plot is `role="img"` with a summary label,
 *   and a visually hidden table repeats the numbers, because an `aria-label`
 *   long enough to be useful is not pleasant to read aloud.
 */
import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SeriesPoint } from '../api/types';
import { dateTime, dayMonth, number, timeOnly } from '../lib/format';

export interface MetricBand {
  readonly min: number;
  readonly max: number;
  /** Short description of where the band came from. */
  readonly source: string;
}

export interface MetricSpec {
  readonly field: 'temperature_c' | 'humidity_pct' | 'pressure_hpa';
  readonly title: string;
  readonly unit: string;
  readonly digits: number;
  readonly band: MetricBand | null;
}

const PADDING = { top: 12, right: 10, bottom: 22, left: 46 };
/**
 * The plot's height in SVG user units, which is also its viewBox height and
 * must also be `--chart-plot-height` in tokens.css.
 *
 * All three used to disagree: this said 168 and the token said 8.5rem (136px).
 * With no `preserveAspectRatio`, the default `xMidYMid meet` fits the smaller
 * ratio, so the entire plot was scaled uniformly by 0.8095 at every viewport.
 * Axis text is sized in user units, so it scaled with everything else: a token
 * that declares 10px rendered at 8.1px, at 320px and at 1400px alike. The line
 * did not, because it carries `vector-effect: non-scaling-stroke`, which left
 * the trace at a full 1.75px while everything around it shrank. The mismatch
 * is fixed in the token; this comment is the half of the contract that lives
 * here.
 */
const HEIGHT = 168;

/**
 * Subscribe to a container's width so the plot can be drawn at real pixels.
 *
 * Starts at 0, not at a guess, and the first measurement is taken synchronously
 * in the layout effect rather than waiting for ResizeObserver's first delivery.
 *
 * A fallback width is not a placeholder, it is a wrong answer rendered for a
 * frame: the viewBox would be drawn at a width the plot is not about to occupy,
 * and because the whole plot is scaled to fit, a wrong viewBox means a wrong
 * glyph size on screen for that frame. The previous 560 fallback did exactly
 * that on every load. Measuring in `useLayoutEffect` means the real width is in
 * state before the browser paints, so there is no frame to see.
 */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const last = useRef(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const apply = (next: number) => {
      // 1px of slack keeps sub-pixel resizes from looping. The first
      // measurement always applies, because `last` starts at 0.
      if (next > 0 && Math.abs(next - last.current) > 1) {
        last.current = next;
        setWidth(next);
      }
    };

    // Synchronous first measure: this runs before the first paint, so the plot
    // is never painted at the wrong size.
    apply(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}

function valueAxis(min: number, max: number, target: number): { lo: number; hi: number; ticks: number[] } {
  const step = niceStep((max - min) / Math.max(1, target - 1));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step * 1e-6; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return { lo, hi, ticks };
}

const TIME_LADDER = [
  60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 3_600_000, 2 * 3_600_000, 3 * 3_600_000,
  6 * 3_600_000, 12 * 3_600_000, 86_400_000, 2 * 86_400_000, 7 * 86_400_000,
];

function timeAxis(from: number, to: number, target: number): { at: number; label: string }[] {
  const wanted = (to - from) / Math.max(1, target);
  const step = TIME_LADDER.find((candidate) => candidate >= wanted) ?? TIME_LADDER[TIME_LADDER.length - 1];
  const spansDays = to - from > 86_400_000 * 1.5;
  const out: { at: number; label: string }[] = [];

  let cursor = from;
  if (step >= 86_400_000) {
    const midnight = new Date(from);
    midnight.setHours(0, 0, 0, 0);
    cursor = midnight.getTime();
  }
  // Local-midnight stepping on a 24h interval drifts across a DST boundary, so
  // day labels carry a time as well. It is a monitoring instrument; an hour of
  // drift in a week view should be visible, not invisible.
  const maxTicks = 24;
  for (let guard = 0; cursor <= to && guard < maxTicks * 4; guard += 1, cursor += step) {
    if (cursor < from) continue;
    const iso = new Date(cursor).toISOString();
    out.push({
      at: cursor,
      label: step >= 86_400_000 ? (spansDays ? `${dayMonth(iso)} ${timeOnly(iso)}` : dayMonth(iso)) : timeOnly(iso),
    });
  }
  return out;
}

interface Segment {
  readonly points: { x: number; y: number; at: number; value: number }[];
}

function buildPath(segments: readonly Segment[]): string {
  return segments
    .map((segment) =>
      segment.points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(' '),
    )
    .filter((path) => path !== '')
    .join(' ');
}

interface Summary {
  readonly present: number;
  readonly gaps: number;
  readonly low: { value: number; at: number } | null;
  readonly high: { value: number; at: number } | null;
  readonly last: { value: number; at: number } | null;
}

function summarise(samples: readonly { at: number; value: number }[], totalPoints: number): Summary {
  let low: { value: number; at: number } | null = null;
  let high: { value: number; at: number } | null = null;
  for (const sample of samples) {
    if (low === null || sample.value < low.value) low = sample;
    if (high === null || sample.value > high.value) high = sample;
  }
  return {
    present: samples.length,
    gaps: Math.max(0, totalPoints - samples.length),
    low,
    high,
    last: samples.length === 0 ? null : samples[samples.length - 1],
  };
}

export interface LineChartProps {
  readonly spec: MetricSpec;
  readonly points: readonly SeriesPoint[];
  readonly from: number;
  readonly to: number;
  /** Human label of the selected range, e.g. "last 6 hours". */
  readonly rangeLabel: string;
  readonly legend?: ReactNode;
}

export const LineChart = memo(function LineChart({ spec, points, from, to, rangeLabel, legend }: LineChartProps) {
  const { ref, width } = useContainerWidth();
  const plotWidth = Math.max(120, width - PADDING.left - PADDING.right);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const samples = points
    .map((point) => ({ at: Date.parse(point.t), value: point[spec.field] }))
    .filter((sample): sample is { at: number; value: number } => Number.isFinite(sample.at) && sample.value !== null)
    .toSorted((a, b) => a.at - b.at);

  // Break the line on a missing value, and on a hole in time.
  const nominalStep = points.length > 1 ? (to - from) / points.length : (to - from);
  const gapLimit = Math.max(nominalStep * 2.5, 1);

  const summary = summarise(samples, points.length);

  if (samples.length === 0) {
    return (
      <figure className="chart">
        <figcaption className="chart__head">
          <h3 className="chart__title">{spec.title}</h3>
          <span className="panel__sub">no values</span>
        </figcaption>
        <div ref={ref} className="chart__plot-wrap">
          <p className="chart__empty-text-block">
            No {spec.title.toLowerCase()} values in the {rangeLabel}. The device may not have reported during this
            window, or this measurement may have been unavailable for the whole of it.
          </p>
        </div>
      </figure>
    );
  }

  /* Nothing is drawn until the container has been measured. See useContainerWidth:
     a viewBox built from a guessed width is not a placeholder for a frame, it is
     a different chart, and every length inside it - including the axis type - is
     scaled to fit. The title is rendered so the panel does not change height
     underneath the reader, and because the measurement is taken in a layout
     effect this state is never painted.

     The wrapper div is here in both states and is not decoration: it is the
     measured element, and the layout effect that takes the first measurement
     only runs once. Returning a figure without it would leave ref.current null
     on that first pass, width stuck at 0, and no chart at all. It is a block
     child of the same `.chart` with the same padding in both states, so it
     measures the same width either way. */
  if (width === 0) {
    return (
      <figure className="chart">
        <figcaption className="chart__head">
          <h3 className="chart__title">{spec.title}</h3>
        </figcaption>
        <div ref={ref} />
      </figure>
    );
  }

  const values = samples.map((sample) => sample.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin) * 0.12 || Math.abs(rawMax || 1) * 0.05;
  const axis = valueAxis(rawMin - pad, rawMax + pad, 4);
  const spanValue = axis.hi - axis.lo || 1;
  const spanTime = to - from || 1;

  const x = (at: number) => PADDING.left + ((at - from) / spanTime) * plotWidth;
  const y = (value: number) => PADDING.top + plotHeight - ((value - axis.lo) / spanValue) * plotHeight;

  const segments: Segment[] = [];
  let current: { x: number; y: number; at: number; value: number }[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = index === 0 ? null : samples[index - 1];
    const broke = previous === null || sample.at - previous.at > gapLimit;
    if (broke && current.length > 0) {
      segments.push({ points: current });
      current = [];
    }
    current.push({ x: x(sample.at), y: y(sample.value), at: sample.at, value: sample.value });
  }
  if (current.length > 0) segments.push({ points: current });

  const xTicks = timeAxis(from, to, Math.max(2, Math.min(7, Math.floor(plotWidth / 78))));
  const last = summary.last!;

  const bandVisible = spec.band !== null && spec.band.max >= axis.lo && spec.band.min <= axis.hi;
  const bandTop = spec.band === null ? 0 : y(Math.min(spec.band.max, axis.hi));
  const bandBottom = spec.band === null ? 0 : y(Math.max(spec.band.min, axis.lo));

  const label =
    `${spec.title} over the ${rangeLabel}. ${number(summary.present, 0)} of ${number(points.length, 0)} points carry a value, ` +
    `across ${segments.length === 1 ? 'one continuous run' : `${segments.length} runs`}. ` +
    (summary.low === null
      ? 'No values.'
      : `Lowest ${number(summary.low.value, spec.digits)} ${spec.unit} at ${timeOnly(new Date(summary.low.at).toISOString())}. `) +
    (summary.high === null ? '' : `Highest ${number(summary.high.value, spec.digits)} ${spec.unit} at ${timeOnly(new Date(summary.high.at).toISOString())}. `) +
    `Latest ${number(last.value, spec.digits)} ${spec.unit} at ${timeOnly(new Date(last.at).toISOString())}. ` +
    'The horizontal axis is the time the service received the sample, not the device clock.';

  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <h3 className="chart__title">{spec.title}</h3>
        <p className="chart__readout">
          <span className="chart__readout-value">{number(last.value, spec.digits)}</span>
          <span className="reading__unit">{spec.unit}</span>
        </p>
      </figcaption>

      <div ref={ref}>
        <svg
          className="chart__plot"
          viewBox={`0 0 ${Math.round(width)} ${HEIGHT}`}
          width={Math.round(width)}
          height={HEIGHT}
          role="img"
          aria-label={label}
        >
          {/* Value grid and axis */}
          {axis.ticks.map((tick) => (
            <g key={`v${tick}`}>
              <line
                className="chart__grid-line"
                x1={PADDING.left}
                x2={PADDING.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="chart__axis-text" x={PADDING.left - 6} y={y(tick) + 3} textAnchor="end">
                {number(tick, tick % 1 === 0 ? 0 : 1)}
              </text>
            </g>
          ))}

          {/* The device's own configured band, when it is on this scale. */}
          {bandVisible && spec.band !== null ? (
            <g>
              <rect
                className="chart__band"
                x={PADDING.left}
                y={bandTop}
                width={plotWidth}
                height={Math.max(0, bandBottom - bandTop)}
              />
              <line className="chart__band-edge" x1={PADDING.left} x2={PADDING.left + plotWidth} y1={bandTop} y2={bandTop} />
              <line
                className="chart__band-edge"
                x1={PADDING.left}
                x2={PADDING.left + plotWidth}
                y1={bandBottom}
                y2={bandBottom}
              />
            </g>
          ) : null}

          <line
            className="chart__axis-line"
            x1={PADDING.left}
            x2={PADDING.left + plotWidth}
            y1={PADDING.top + plotHeight}
            y2={PADDING.top + plotHeight}
          />

          {/* Time axis */}
          {xTicks.map((tick) => (
            <text
              className="chart__axis-text"
              key={`t${tick.at}`}
              x={x(tick.at)}
              y={HEIGHT - 7}
              textAnchor="middle"
            >
              {tick.label}
            </text>
          ))}
          <text className="chart__axis-title" x={PADDING.left} y={9}>
            {spec.unit} · {spec.title}
          </text>

          {/* The series, broken at every gap */}
          <path className="chart__series" d={buildPath(segments)} />
          <circle className="chart__last" cx={x(last.at)} cy={y(last.value)} r="3" />
        </svg>
      </div>

      <p className="chart__foot">
        {legend}
        {spec.band === null ? null : bandVisible ? (
          <span className="chart-legend__key">
            <span className="chart-legend__swatch chart-legend__swatch--band" aria-hidden="true" />
            Device-configured band {number(spec.band.min, 0)} to {number(spec.band.max, 0)} {spec.unit} ({spec.band.source})
          </span>
        ) : (
          <span className="chart-legend__key">
            The configured band {number(spec.band.min, 0)} to {number(spec.band.max, 0)} {spec.unit} sits outside this
            plot&apos;s range.
          </span>
        )}
        <span className="chart-legend__key">
          {summary.gaps === 0
            ? 'No missing points in this window.'
            : `${number(summary.gaps, 0)} point${summary.gaps === 1 ? '' : 's'} carry no value; the line breaks there rather than crossing a gap.`}
        </span>
      </p>

      {/* The non-visual equivalent, inside a hidden WRAPPER.
       *
       * `.visually-hidden` cannot be put on a table. `width: 1px` is a minimum
       * on a box that establishes a table formatting context, so under
       * `table-layout: auto` the 1px loses to the min-content width and the box
       * computes to 325/355/362px. Being absolutely positioned against the
       * initial containing block, its right edge then extended the document:
       * 403px of scrollWidth in a 320px viewport, 83px of horizontal page
       * scroll, and a WCAG 1.4.10 failure. `overflow: hidden` and `clip-path`
       * on the table itself do not help, because the overflow is the box's own
       * size rather than content escaping from it, and `max-inline-size` was
       * measured and does not clamp a table either.
       *
       * A block wrapper is 1px for real, its own overflow contains the table's,
       * and the table keeps `display: table` - so `<caption>`, `<th scope>` and
       * the row and column relationships are all still in the accessibility
       * tree. Verified in the AX tree after the change: role=table, not
       * ignored, named by its caption. This is the non-visual equivalent, and
       * it is the only reason someone who cannot see the plot can trust it. */}
      <div className="visually-hidden">
        <table>
          <caption>{`${spec.title} summary for the ${rangeLabel}`}</caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">Value</th>
              <th scope="col">At</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Points in range</th>
              <td>{points.length}</td>
              <td>—</td>
            </tr>
            <tr>
              <th scope="row">Points with a value</th>
              <td>{summary.present}</td>
              <td>—</td>
            </tr>
            <tr>
              <th scope="row">Continuous runs</th>
              <td>{segments.length}</td>
              <td>—</td>
            </tr>
            {summary.low === null ? null : (
              <tr>
                <th scope="row">Lowest</th>
                <td>
                  {number(summary.low.value, spec.digits)} {spec.unit}
                </td>
                <td>{dateTime(new Date(summary.low.at).toISOString())}</td>
              </tr>
            )}
            {summary.high === null ? null : (
              <tr>
                <th scope="row">Highest</th>
                <td>
                  {number(summary.high.value, spec.digits)} {spec.unit}
                </td>
                <td>{dateTime(new Date(summary.high.at).toISOString())}</td>
              </tr>
            )}
            <tr>
              <th scope="row">Latest</th>
              <td>
                {number(last.value, spec.digits)} {spec.unit}
              </td>
              <td>{dateTime(new Date(last.at).toISOString())}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </figure>
  );
});
