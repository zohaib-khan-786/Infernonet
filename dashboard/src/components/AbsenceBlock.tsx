/**
 * The absence block: two kinds, one shape.
 *
 * This is the component that makes "not built" and "not installed" say
 * something, instead of leaving a gap on the page that a reader fills in with
 * an assumption. It is the single most load-bearing piece of this pass, because
 * most of guide §6–§34 is about hardware and backends that do not exist in this
 * product, and guide §46.13 ("do not use fake success states") is a rule about
 * exactly this situation.
 *
 * THE TWO KINDS ARE NOT INTERCHANGEABLE
 * -----------------------------------------------------------------------------
 *   not-installed   The thing could be measured or commanded if hardware were
 *                   fitted. A compressor has a state; this cabinet has no
 *                   compressor, so there is no state to report. Nothing is sent,
 *                   nothing is withheld, nothing is wrong.
 *
 *   not-available   The thing is not part of this product at all. There is no
 *                   report service, no settings store and no identity system,
 *                   and adding hardware would not change that.
 *
 * Collapsing the two would be the more comfortable screen and the more
 * dangerous one: "compressor not installed" next to "settings not available"
 * reads as two gaps in a list of hardware, and invites the reader to conclude
 * that a software update would fill both in. It would not.
 *
 * WHY THE SENSOR-FAULT TREATMENT
 * -----------------------------------------------------------------------------
 * The hatched diamond and the cold slate are the system's "there is no data
 * here" vocabulary, and they are used for a fact rather than a verdict: the
 * device never said anything, because there is nothing to say. The word beside
 * the mark is always present, so the shape carries no information a screen
 * reader or a greyscale print does not already carry in words. What this block
 * deliberately does NOT wear is a verdict treatment — no check_food square, no
 * use_soon triangle — because nothing here is a statement about food.
 */
import { memo, type ReactNode } from 'react';
import { Mark } from './Mark';

export type AbsenceKind = 'not-installed' | 'not-available';

const KIND_WORD: Readonly<Record<AbsenceKind, string>> = {
  'not-installed': 'Hardware not installed',
  'not-available': 'Not part of this build',
};

const KIND_SENTENCE: Readonly<Record<AbsenceKind, string>> = {
  'not-installed':
    'No value is being reported for this, and none is being withheld. The service has no field for it because the device has no sensor to fill one.',
  'not-available':
    'Nothing in this product can report it, so there is no value to show and nothing is failing.',
};

export interface AbsenceBlockProps {
  readonly kind: AbsenceKind;
  /** What the page would have shown. "Compressor", "Report history", "Roles". */
  readonly subject: string;
  /** The part, service or subsystem that would have to exist. */
  readonly wouldBe: string;
  /** Bullet list of what specifically is absent. */
  readonly missing: readonly string[];
  /** Why it is absent, in the project's own terms. */
  readonly why: ReactNode;
  /** Extra honest content rendered after the list. */
  readonly children?: ReactNode;
}

export const AbsenceBlock = memo(function AbsenceBlock({ kind, subject, wouldBe, missing, why, children }: AbsenceBlockProps) {
  const headingId = `absence-${kind}-${subject.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section className="notice" data-tone="unknown" role="note" aria-labelledby={headingId}>
      <Mark shape="hatched-diamond" className="mark--lg" />
      <div>
        <p className="notice__kind">{KIND_WORD[kind]}</p>
        <h3 className="notice__title" id={headingId}>
          {subject} — no value is being reported
        </h3>
        <div className="notice__body">
          <p>{KIND_SENTENCE[kind]}</p>
          <p>
            <strong>What would be measured:</strong> {wouldBe}
          </p>
          {missing.length === 0 ? null : (
            <>
              <p>
                <strong>What is absent here:</strong>
              </p>
              <ul className="notice__list">
                {missing.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </>
          )}
          <p>{why}</p>
          {children}
        </div>
      </div>
    </section>
  );
});

/**
 * The compact form, for a panel the guide calls "quick".
 *
 * §11 asks for four compact operational states. Rendering three absences at the
 * full `AbsenceBlock` length — three multi-paragraph notices inside a 27rem rail
 * — pushed device health and the conditions list most of a screen down, which is
 * the exact inversion guide §39 warns about: the diagnostics got the top of the
 * rail and the food verdicts got the bottom. The same copy rules apply in three
 * lines instead of twelve: the kind, the subject, and one sentence naming what
 * would be measured and why it is not.
 *
 * Where each absence deserves a full paragraph — the Refrigeration page, where
 * §21, §22, §23 and §24 are four separate guide sections a reader arrived
 * deliberately to read — `AbsenceBlock` is used instead. The choice is per
 * screen, and the two forms carry the same tone, the same shape and the same
 * "no value is being reported" wording so nothing is ambiguous between them.
 */
export interface AbsenceRowProps {
  readonly kind: AbsenceKind;
  readonly subject: string;
  /** One sentence: what would be measured, and why it is not. */
  readonly why: ReactNode;
}

export const AbsenceRow = memo(function AbsenceRow({ kind, subject, why }: AbsenceRowProps) {
  const headingId = `absence-row-${kind}-${subject.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section className="absence-row" data-tone="unknown" role="note" aria-labelledby={headingId}>
      <Mark shape="hatched-diamond" className="mark--sm" />
      <div>
        <p className="absence-row__kind">{KIND_WORD[kind]}</p>
        <h3 className="absence-row__subject" id={headingId}>
          {subject}
        </h3>
        <p className="absence-row__why">{why}</p>
      </div>
    </section>
  );
});
