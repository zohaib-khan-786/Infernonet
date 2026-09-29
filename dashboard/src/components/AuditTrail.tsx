/**
 * The audit trail (guide §31).
 *
 * §31's rule is one sentence: "never silently overwrite configuration history".
 * The service already honours it — every revision is a row with its before, its
 * after, a note and a `changed_by` — and this renders the rows at the level the
 * rule is about, which is the individual limit.
 *
 * WHY FIELD BY FIELD RATHER THAN ONE LINE PER REVISION
 * -----------------------------------------------------------------------------
 * A revision line that says "rev 7, some limits changed" is a summary of a
 * history, and a summary of a history is the thing §31 is warning about: a
 * reader cannot tell which limit moved, so they cannot tell whether the limit
 * they rely on is the one that changed. So each revision is expanded into one row
 * per limit that actually differs between `before` and `after`, each reading
 * previous → new, and limits that did not change are not listed at all — which
 * is also what makes "nothing was silently overwritten" checkable by eye.
 *
 * `null` IS A VALUE HERE
 * -----------------------------------------------------------------------------
 * `ThresholdValues` fields are `number | null`, and the two absences mean
 * different things: a number the operator never set, and an explicit null that
 * switches a limit off. `thresholds.js` in the backend is careful about the
 * difference and this is careful about it too — the previous value reads "not
 * set" and the new value reads "turned off" when it is an explicit null, so a
 * disabled limit is visible as a decision rather than as a gap.
 */
import { memo } from 'react';
import type { ThresholdChange, ThresholdScope, ThresholdValues } from '../api/types';
import { number } from '../lib/format';

interface FieldSpec {
  readonly key: keyof ThresholdValues;
  readonly label: string;
  readonly unit: string;
  readonly digits: number;
  /** Rendered in seconds, because that is the unit a person reasons in. */
  readonly inMilliseconds?: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  { key: 'temperature_min_c', label: 'Temperature minimum', unit: '°C', digits: 1 },
  { key: 'temperature_max_c', label: 'Temperature maximum', unit: '°C', digits: 1 },
  { key: 'humidity_min_pct', label: 'Humidity minimum', unit: '%RH', digits: 0 },
  { key: 'humidity_max_pct', label: 'Humidity maximum', unit: '%RH', digits: 0 },
  { key: 'gas_delta_abnormal_mv', label: 'Gas abnormal', unit: 'mV delta', digits: 1 },
  { key: 'gas_delta_clear_mv', label: 'Gas clear', unit: 'mV delta', digits: 1 },
  { key: 'use_soon_percent', label: 'Use-soon at', unit: '% of limit', digits: 0 },
  { key: 'door_timeout_ms', label: 'Door open limit', unit: 's', digits: 0, inMilliseconds: true },
];

const DOOR_FACTOR = 1000;

function display(field: FieldSpec, value: number | null): string {
  if (value === null) return 'turned off';
  if (field.inMilliseconds === true) return `${number(value / DOOR_FACTOR, 0)} ${field.unit}`;
  return `${number(value, field.digits)} ${field.unit}`;
}

/** The shape `ThresholdChange.before` has: a values block and its basis. */
type Before = ThresholdChange['before'];

function changed(before: Before, after: ThresholdValues, field: FieldSpec): boolean {
  const next = after[field.key];
  if (before === null) return next !== null;
  return before.values[field.key] !== next;
}

const SOURCE_WORD = {
  authoritative: 'authoritative — from a cited source',
  prototype_assumption: 'prototype assumption — not sourced',
} as const;

export interface AuditTrailProps {
  readonly dev: string;
  readonly scope: ThresholdScope;
  readonly changes: readonly ThresholdChange[];
}

export const AuditTrail = memo(function AuditTrail({ dev, scope, changes }: AuditTrailProps) {
  return (
    <section className="panel" aria-labelledby="audit-title">
      <div className="panel__head">
        <h2 className="panel__title" id="audit-title">
          Audit trail
        </h2>
        <p className="panel__sub">
          {changes.length === 0
            ? 'no configuration change has been recorded'
            : `${changes.length} recorded change${changes.length === 1 ? '' : 's'} · ${scope === 'zone' ? 'shared zone' : 'per item'} scope · ${dev}`}
        </p>
      </div>

      <div className="panel__body">
        <p className="note">
          Every saved limit is kept as its own revision with the values it replaced, so nothing here has been
          overwritten. Each revision below lists only the limits that actually changed.
        </p>
      </div>

      {changes.length === 0 ? (
        <div className="panel__body">
          <p className="note">
            Nothing has been configured for this device in this scope yet, so the device is using the limits compiled
            into its firmware. Saving a limit from the form above creates the first revision here.
          </p>
        </div>
      ) : (
        <div className="panel__body panel__body--flush">
          <ol className="audit">
            {changes.map((change) => {
              const moved = FIELDS.filter((field) => changed(change.before, change.after.values, field));
              return (
                <li className="audit__entry" key={change.revision}>
                  <div className="audit__head">
                    <span className="audit__rev num">rev {change.revision}</span>
                    <span className="audit__when">{new Date(change.changed_at).toLocaleString()}</span>
                    <span className="audit__user">
                      {change.changed_by === null || change.changed_by === '' ? 'no name recorded' : `by ${change.changed_by}`}
                    </span>
                  </div>

                  <p className="audit__basis">
                    Basis after this change: {SOURCE_WORD[change.after.source]}
                    {change.before === null ? ' (the first configuration for this scope)' : ''}
                    {change.before !== null && change.before.source !== change.after.source ? (
                      <>
                        {' '}
                        <strong>Changed from {SOURCE_WORD[change.before.source]}.</strong> A change of basis is a change
                        of kind, not of number, whichever way it goes: a limit that stops being cited stops being a
                        food-safety limit, and that is a bigger change than any number in it.
                      </>
                    ) : null}
                  </p>

                  {moved.length === 0 ? (
                    <p className="note">
                      No limit value differs from the previous revision. The basis or the note changed; the numbers did
                      not.
                    </p>
                  ) : (
                    <table className="data-table audit__table">
                      <caption className="visually-hidden">
                        Limits changed at revision {change.revision}, with the previous value and the new value.
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Limit</th>
                          <th scope="col">Previous</th>
                          <th scope="col">New</th>
                        </tr>
                      </thead>
                      <tbody>
                        {moved.map((field) => (
                          <tr key={field.key}>
                            <th scope="row" className="cell-head">
                              {field.label}
                            </th>
                            <td>
                              {change.before === null ? (
                                <span className="withheld">
                                  <span className="withheld__value">not set</span>
                                  <span className="withheld__note">nothing was configured for this scope before this revision</span>
                                </span>
                              ) : (
                                display(field, change.before.values[field.key])
                              )}
                            </td>
                            <td className="cell-num">{display(field, change.after.values[field.key])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <p className="audit__reason">
                    <span className="audit__reason-label">Reason</span>
                    {change.note === null || change.note.trim() === '' ? (
                      <span className="withheld__value">no reason recorded</span>
                    ) : (
                      change.note
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
});
