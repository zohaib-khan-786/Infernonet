/**
 * The status band.
 *
 * The verdict, stated once, with nothing above it. Two annunciator plates, one
 * per verdict the device reports:
 *
 *   Overall    the most severe of the zone and every registered item
 *   Cabinet    the environment on its own
 *
 * Each plate carries three independent signals: a tone bar, a shape, and the
 * word. The backend's own label is printed next to the readable spelling, so a
 * volunteer can see the exact token the service used and nothing has been
 * re-derived on the way to the screen.
 *
 * Each plate states its verdict once to assistive technology, not three times.
 * The word and the raw token are real text; the shape mark is decorative and is
 * hidden from the tree, so the plate reads "Overall. Check food check_food. A
 * confirmed threshold breach..." in the order it is laid out. See the comment on
 * the mark below.
 *
 * A polite live region announces a verdict *change* only. It is fed by a
 * comparison, not by every snapshot, so a device reporting every five seconds
 * does not make a screen reader talk over itself.
 */
import { memo, useEffect, useRef, useState } from 'react';
import type { StatusBlock } from '../api/types';
import { dateTime, humaniseLabel } from '../lib/format';
import { statusPresentation } from '../lib/status';
import { Mark } from './Mark';

interface AnnunciatorProps {
  readonly scope: string;
  readonly status: StatusBlock;
  readonly scopeNote: string;
}

const Annunciator = memo(function Annunciator({ scope, status, scopeNote }: AnnunciatorProps) {
  const presentation = statusPresentation(status);
  return (
    <div className="annunciator" data-tone={presentation.tone}>
      <p className="annunciator__lamp">
        {/* Decorative, and hidden from assistive technology on purpose.
         *
         * This mark used to carry `aria-label="Check food (check_food)"`, so the
         * plate announced its own verdict three times over: the mark's label,
         * the word beside it, and the raw token chip. Three utterances of the
         * most important string on the page, on the element a screen-reader
         * user lands on first, every time the verdict was read.
         *
         * The mark's label was a duplicate of the word that sits immediately
         * next to it, and a worse one: it spoke the word and then the token
         * inside parentheses, before the real heading, in the wrong order. The
         * word and the token are real text in the reading order the rest of the
         * product uses, and a shape has nothing to say to someone who cannot
         * see it - DESIGN_SYSTEM.md §5.2 names word and shape as the two
         * channels that carry status, and only the word is available here.
         *
         * The shape still reaches the accessibility tree through the sibling
         * that matters: StatusChip gives every compact mark the same treatment
         * elsewhere, and nothing about what the device reported has been lost. */}
        <Mark shape={presentation.shape} className="mark--lg" />
      </p>
      <div className="annunciator__body">
        <p className="annunciator__scope">
          {scope}
          <span className="visually-hidden">. {scopeNote}.</span>
        </p>
        <p className="annunciator__verdict">
          <span className="annunciator__label">{presentation.label}</span>
          <span className="annunciator__token num" title="The exact label the service reported">
            {presentation.token}
          </span>
        </p>
        <p className="annunciator__meaning">{presentation.meaning}</p>
      </div>
    </div>
  );
});

/**
 * Announces a verdict change once, politely. Holding the previous pair in a ref
 * and writing only on a real change is what keeps a five-second snapshot cadence
 * from turning into constant screen-reader chatter.
 */
function useVerdictAnnouncement(overall: StatusBlock | null, zone: StatusBlock | null): string {
  const [message, setMessage] = useState('');
  const previous = useRef<{ overall: string; zone: string } | null>(null);

  useEffect(() => {
    if (overall === null || zone === null) {
      previous.current = null;
      setMessage('');
      return;
    }
    const next = { overall: overall.label, zone: zone.label };
    const last = previous.current;
    previous.current = next;
    if (last === null) {
      setMessage(`Verdict: overall ${humaniseLabel(overall.label)}, cabinet ${humaniseLabel(zone.label)}.`);
      return;
    }
    if (last.overall === next.overall && last.zone === next.zone) return;
    const parts: string[] = [];
    if (last.overall !== next.overall) parts.push(`overall status is now ${humaniseLabel(overall.label)}`);
    if (last.zone !== next.zone) parts.push(`cabinet status is now ${humaniseLabel(zone.label)}`);
    setMessage(`Verdict changed: ${parts.join(', ')}.`);
  }, [overall, zone]);

  return message;
}

export interface StatusBandProps {
  readonly overall: StatusBlock;
  readonly zone: StatusBlock;
  readonly reportedAt: string | null;
  readonly timeValid: boolean;
  readonly itemCount: number;
  readonly retiredCount: number;
  readonly unacknowledged: number;
  readonly needsAttention: number;
}

export const StatusBand = memo(function StatusBand({
  overall,
  zone,
  reportedAt,
  timeValid,
  itemCount,
  retiredCount,
  unacknowledged,
  needsAttention,
}: StatusBandProps) {
  const announcement = useVerdictAnnouncement(overall, zone);
  const reportedLabel = timeValid ? dateTime(reportedAt) : 'not reported';

  return (
    <section className="status-band" aria-labelledby="status-band-title">
      <div className="status-band__head">
        <h2 className="status-band__title" id="status-band-title">
          Device verdict
        </h2>
        <p className="panel__sub">
          Reported by the device
          {timeValid ? <span className="num"> · {reportedLabel}</span> : null}
          {timeValid ? null : ' · device time not trusted'}
        </p>
      </div>

      <div className="status-band__readouts">
        <Annunciator scope="Overall" scopeNote="The most severe verdict across the cabinet and every stored item" status={overall} />
        <Annunciator scope="Cabinet zone" scopeNote="The environment on its own" status={zone} />
      </div>

      <div className="status-band__foot">
        <p className="status-band__stat">
          <span className="status-band__stat-value num">{itemCount}</span>
          <span>items stored</span>
        </p>
        {retiredCount > 0 ? (
          <p className="status-band__stat">
            <span className="status-band__stat-value num">{retiredCount}</span>
            <span>retired</span>
          </p>
        ) : null}
        <p className="status-band__stat">
          <span className="status-band__stat-value num">{needsAttention}</span>
          <span>needing attention</span>
        </p>
        <p className="status-band__stat">
          <span className="status-band__stat-value num">{unacknowledged}</span>
          <span>conditions unacknowledged</span>
        </p>
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
});
