/**
 * The composition donut (guide §16, §25).
 *
 * A ring, not a pie, and never on its own: the component takes a label and a
 * total, and refuses to draw a partial ring for a total of zero — an empty ring
 * with a centre reading "0" is a shape that says "nothing" in a way that reads
 * as "all of it is one colour", and §16's rule is that the chart is never the
 * only representation.
 *
 * Accessibility is by table, not by description. `role="img"` with a sentence
 * naming every slice and its share, plus a hidden table with the same figures.
 * A donut is the one chart where an `aria-label` is genuinely shorter than the
 * data, so both are there.
 *
 * Colours are the four status inks and the segments are additionally separated
 * by a gap, so the ring is readable in greyscale: the gap between two segments
 * is a shape difference, not a hue difference.
 */
import { memo } from 'react';

export interface DonutSlice {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** Any tone name from `components.css`; colour only, never the sole signal. */
  readonly tone: 'ok' | 'warn' | 'crit' | 'unknown' | 'neutral' | 'admin';
  /** Sentence describing what the slice means, read out in the summary. */
  readonly meaning: string;
}

const SIZE = 132;
const THICKNESS = 16;
const RADIUS = (SIZE - THICKNESS) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** A visible gap between segments. 2 units at this size is a clear 2px at 1x. */
const GAP = 2;

export interface DonutProps {
  readonly slices: readonly DonutSlice[];
  /** What the ring is a breakdown of. Appears in the summary and the caption. */
  readonly subject: string;
}

export const Donut = memo(function Donut({ slices, subject }: DonutProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const present = slices.filter((slice) => slice.value > 0);

  if (total === 0) {
    return (
      <figure className="donut donut--empty">
        <figcaption className="donut__caption">No {subject} to break down</figcaption>
        <p className="donut__empty-note">
          An empty ring is not drawn: a ring with nothing in it is read as &quot;all of it is one thing&quot;, which is
          the opposite of what an empty list means.
        </p>
      </figure>
    );
  }

  // Accumulated in a reduce rather than by mutating a `let` inside a map, so
  // the geometry is a pure function of the slices and cannot depend on how many
  // times the map callback runs.
  const { arcs } = present.reduce<{ arcs: { slice: DonutSlice; length: number; offset: number }[]; cursor: number }>(
    (acc, slice) => {
      const fraction = slice.value / total;
      // Every segment gives up the same gap, so the ring has a visible
      // separation between slices in any colour scheme and in greyscale.
      const length = Math.max(0, fraction * CIRCUMFERENCE - GAP);
      acc.arcs.push({ slice, length, offset: acc.cursor });
      acc.cursor += fraction * CIRCUMFERENCE;
      return acc;
    },
    { arcs: [], cursor: 0 },
  );

  const summary =
    `${subject}: ` +
    slices
      .map((slice) => `${slice.value} ${slice.label}${slice.value === 1 ? '' : 's'} (${Math.round((slice.value / total) * 100)} per cent)`)
      .join(', ') +
    `. Total ${total}.`;

  return (
    <figure className="donut">
      <svg
        className="donut__ring"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={summary}
        focusable="false"
      >
        <circle className="donut__track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={THICKNESS} />
        {arcs.map((arc) => (
          <circle
            key={arc.slice.id}
            className="donut__slice"
            data-tone={arc.slice.tone}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={THICKNESS}
            strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </svg>
      <figcaption className="donut__caption">
        <span className="donut__total num">{total}</span>
        <span className="donut__total-label">{subject}</span>
      </figcaption>

      {/*
        The non-visual equivalent, inside a hidden wrapper. A hidden table cannot
        take `visually-hidden` itself — see the note in base.css — so the class
        is on the wrapper and the table keeps `display: table` with its caption
        and header relationships intact.
      */}
      <div className="visually-hidden">
        <table>
          <caption>{summary}</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Count</th>
              <th scope="col">Share</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((slice) => (
              <tr key={slice.id}>
                <th scope="row">{slice.label}</th>
                <td>{slice.value}</td>
                <td>{Math.round((slice.value / total) * 100)}%</td>
                <td>{slice.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
});
