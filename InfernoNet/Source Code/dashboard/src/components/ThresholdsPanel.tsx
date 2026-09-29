/**
 * Administrator thresholds.
 *
 * This is the operator's one configurable surface (SRS requirement xii), and it
 * is deliberately built around three things a settings form usually gets wrong:
 *
 * 1. IT NEVER SHOWS A VERDICT. The device is the sole authority for freshness.
 *    This panel sets the limits the device applies; it does not display, predict
 *    or adjust a status. Anything that looked like a computed outcome here would
 *    be a second opinion disagreeing with the hardware, which is exactly the
 *    failure the single-authority rule exists to prevent.
 *
 * 2. SAVED IS NOT APPLIED. `in_sync` is its own state. An operator who saves a
 *    change and then sees the device still reporting the old revision is told so
 *    plainly, rather than left to assume the new numbers are in force.
 *
 * 3. UNSOURCED VALUES SAY SO. `source` is mandatory and a note is required when
 *    it is `prototype_assumption`, enforced server-side and mirrored here. A
 *    prototype number must never be mistakable for a cited food-safety limit.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { getThresholdHistory, getThresholds, putThresholds } from '../api/endpoints';
import type {
  ThresholdHistoryResponse,
  ThresholdScope,
  ThresholdSource,
  ThresholdUpdate,
  ThresholdViewResponse,
} from '../api/types';

interface Props {
  readonly dev: string;
}

/** One editable limit. `id` is both the DOM id and the request field name. */
interface Field {
  readonly id: keyof Omit<ThresholdUpdate, 'scope' | 'source' | 'reference' | 'note' | 'changed_by'>;
  readonly label: string;
  readonly unit: string;
  readonly step: number;
  readonly min: number;
  readonly max: number;
  /** A bare millivolt threshold explains nothing, so every field carries one. */
  readonly hint: string;
}

const FIELDS: readonly Field[] = [
  {
    id: 'temperature_min_c',
    label: 'Temperature min',
    unit: '°C',
    step: 0.5,
    min: -40,
    max: 90,
    hint: 'Below this the zone is too cold for the stored food.',
  },
  {
    id: 'temperature_max_c',
    label: 'Temperature max',
    unit: '°C',
    step: 0.5,
    min: -40,
    max: 90,
    hint: 'Above this the zone is too warm and deterioration accelerates.',
  },
  {
    id: 'humidity_min_pct',
    label: 'Humidity min',
    unit: '%RH',
    step: 1,
    min: 0,
    max: 100,
    hint: 'Below this, food dries out and quality is lost.',
  },
  {
    id: 'humidity_max_pct',
    label: 'Humidity max',
    unit: '%RH',
    step: 1,
    min: 0,
    max: 100,
    hint: 'Above this, condensation and mould become likely.',
  },
  {
    id: 'gas_delta_abnormal_mv',
    label: 'Gas abnormal',
    unit: 'mV delta',
    step: 1,
    min: 0.1,
    max: 10000,
    hint: 'MQ-135 rise over baseline that flags the zone. Not a gas concentration.',
  },
  {
    id: 'gas_delta_clear_mv',
    label: 'Gas clear',
    unit: 'mV delta',
    step: 1,
    min: 0.1,
    max: 10000,
    hint: 'Must stay below the abnormal figure, or the alert can never reset.',
  },
  {
    id: 'use_soon_percent',
    label: 'Use-soon at',
    unit: '% of limit',
    step: 1,
    min: 1,
    max: 100,
    hint: 'Share of the storage limit after which an item reads Use Soon.',
  },
  {
    id: 'door_timeout_ms',
    label: 'Door open limit',
    unit: 's',
    step: 5,
    min: 1,
    max: 86400,
    hint: 'How long the door may stay open before an alert is raised.',
  },
];

type Draft = Record<string, string>;

/**
 * Door timeout is stored in milliseconds but edited in seconds, which is the
 * unit a person actually reasons in ("two minutes", not "120000"). Converting in
 * exactly one place keeps the factor from being applied twice.
 */
const DOOR_FACTOR = 1000;

function toDraft(view: ThresholdViewResponse | null): Draft {
  const values = view?.configured?.values ?? view?.applied_by_device ?? null;
  const draft: Draft = {};
  for (const field of FIELDS) {
    const raw = values ? values[field.id] : null;
    if (raw == null) {
      draft[field.id] = '';
    } else if (field.id === 'door_timeout_ms') {
      draft[field.id] = String(Math.round(raw / DOOR_FACTOR));
    } else {
      draft[field.id] = String(raw);
    }
  }
  return draft;
}

export const ThresholdsPanel = memo(function ThresholdsPanel({ dev }: Props) {
  const [scope, setScope] = useState<ThresholdScope>('zone');
  const [view, setView] = useState<ThresholdViewResponse | null>(null);
  const [history, setHistory] = useState<ThresholdHistoryResponse | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [source, setSource] = useState<ThresholdSource>('prototype_assumption');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [changedBy, setChangedBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setProblem(null);
    try {
      const [next, past] = await Promise.all([
        getThresholds(dev, { scope }),
        getThresholdHistory(dev, { scope }),
      ]);
      setView(next);
      setHistory(past);
      setDraft(toDraft(next));
      if (next.configured) {
        setSource(next.configured.source);
        setReference(next.configured.reference ?? '');
        setNote(next.configured.note ?? '');
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [dev, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Client-side mirror of the server's cross-field rules. The server rejects
   * these regardless; catching them here turns a round trip into an inline
   * message next to the field that caused it. Kept to the rules an operator can
   * plausibly hit by typing, not a duplicate of the full schema.
   */
  const localProblems = useMemo(() => {
    const out: string[] = [];
    const num = (id: string) => (draft[id] === '' ? null : Number(draft[id]));
    const tmin = num('temperature_min_c');
    const tmax = num('temperature_max_c');
    const hmin = num('humidity_min_pct');
    const hmax = num('humidity_max_pct');
    const gclr = num('gas_delta_clear_mv');
    const gabn = num('gas_delta_abnormal_mv');
    if (tmin !== null && tmax !== null && tmin >= tmax) out.push('Temperature min must be below the maximum.');
    if (hmin !== null && hmax !== null && hmin >= hmax) out.push('Humidity min must be below the maximum.');
    if (gclr !== null && gabn !== null && gclr >= gabn) out.push('Gas clear must be below the abnormal figure.');
    if (source === 'prototype_assumption' && note.trim() === '') {
      out.push('A prototype assumption needs a note saying where the numbers came from.');
    }
    return out;
  }, [draft, note, source]);

  const outOfRange = useMemo(
    () =>
      FIELDS.filter((field) => {
        const raw = draft[field.id];
        if (raw === '') return false;
        const value = Number(raw);
        if (Number.isNaN(value)) return true;
        const min = field.id === 'door_timeout_ms' ? 1 : field.min;
        const max = field.id === 'door_timeout_ms' ? 86400 : field.max;
        return value < min || value > max;
      }).map((field) => `${field.label} must be between ${field.min} and ${field.max} ${field.unit}.`),
    [draft],
  );

  const blocked = localProblems.length > 0 || outOfRange.length > 0;

  async function save() {
    if (blocked) return;
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      // Built field by field rather than with a cast: the loop is the only place
      // that knows the door-timeout unit conversion, and a cast would let any
      // string key through unnoticed.
      const limits: Record<string, number | null> = {};
      for (const field of FIELDS) {
        const raw = draft[field.id];
        if (raw === '') {
          limits[field.id] = null;
        } else if (field.id === 'door_timeout_ms') {
          limits[field.id] = Math.round(Number(raw) * DOOR_FACTOR);
        } else {
          limits[field.id] = Number(raw);
        }
      }
      const body: ThresholdUpdate = {
        ...(limits as Omit<ThresholdUpdate, 'scope' | 'source' | 'reference' | 'note' | 'changed_by'>),
        scope,
        source,
        ...(changedBy.trim() ? { changed_by: changedBy.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      await putThresholds(dev, body);
      await load();
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const configured = view?.configured ?? null;
  const deviceRevision = view?.device_reported?.revision ?? null;

  return (
    <section className="panel" aria-labelledby="thresholds-heading">
      <div className="panel__head">
        <h2 id="thresholds-heading" className="panel__title">
          Administrator limits
        </h2>
        <p className="panel__sub">
          The limits the device applies. It decides freshness — this page does not.
        </p>
      </div>

      <div className="panel__body">
        <div className="panel__tools">
          <div className="chip-group" role="group" aria-label="Scope">
            {(['zone', 'item'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="chip chip--plain"
                aria-pressed={scope === option}
                onClick={() => setScope(option)}
              >
                {option === 'zone' ? 'Shared zone' : 'Per item'}
              </button>
            ))}
          </div>
        </div>

        <div className="status-band__stat" aria-live="polite">
          <span className="status-band__stat-value">
            {configured ? `rev ${configured.revision}` : '—'}
          </span>
          <span>
            {configured
              ? `configured · device ${deviceRevision === null ? 'reports none' : `on rev ${deviceRevision}`}`
              : 'nothing configured — the device is using its built-in defaults'}
          </span>
        </div>

        {view && (
          <div className="notice" data-tone={view.in_sync === true ? 'neutral' : 'warn'} role="status">
            <p className="notice__kind">
              {view.in_sync === true
                ? 'In sync'
                : view.in_sync === false
                  ? 'Not in sync'
                  : 'Sync unknown'}
            </p>
            <p className="notice__body">
              {view.in_sync === true
                ? 'The device is applying the limits configured here.'
                : view.in_sync === false
                  ? 'The device has not picked up the latest change yet. Its old limits stay in force until it does.'
                  : 'The device does not report a revision, so agreement cannot be confirmed or denied.'}
            </p>
          </div>
        )}

        {configured?.source === 'prototype_assumption' && (
          <div className="notice" data-tone="warn" role="note">
            <p className="notice__kind">Prototype assumption</p>
            <p className="notice__body">
              These are not certified food-safety limits.
              {configured.note ? ` ${configured.note}` : ''}
            </p>
          </div>
        )}

        <div className="fields">
          {FIELDS.map((field) => (
            <div className="field" key={field.id}>
              <label className="field__label" htmlFor={`threshold-${field.id}`}>
                {field.label} <span className="field__unit">({field.unit})</span>
              </label>
              <input
                id={`threshold-${field.id}`}
                className="field__input"
                type="number"
                inputMode="decimal"
                step={field.step}
                min={field.min}
                max={field.max}
                value={draft[field.id] ?? ''}
                aria-describedby={`threshold-${field.id}-hint`}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, [field.id]: event.target.value }))
                }
              />
              <p className="field__hint" id={`threshold-${field.id}-hint`}>
                {field.hint}
              </p>
            </div>
          ))}
        </div>

        <div className="fields">
          <div className="field">
            <label className="field__label" htmlFor="threshold-source">
              Basis
            </label>
            <select
              id="threshold-source"
              className="field__input"
              value={source}
              onChange={(event) => setSource(event.target.value as ThresholdSource)}
            >
              <option value="prototype_assumption">Prototype assumption — not sourced</option>
              <option value="authoritative">Authoritative — from a cited source</option>
            </select>
            <p className="field__hint">
              Shown on the dashboard verbatim. An unsourced value must never read as a
              food-safety limit.
            </p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="threshold-reference">
              Citation
            </label>
            <input
              id="threshold-reference"
              className="field__input"
              type="text"
              value={reference}
              placeholder="e.g. FDA Food Code 3-501.16"
              onChange={(event) => setReference(event.target.value)}
            />
            <p className="field__hint">Required when the basis is authoritative.</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="threshold-changed-by">
              Changed by
            </label>
            <input
              id="threshold-changed-by"
              className="field__input"
              type="text"
              value={changedBy}
              onChange={(event) => setChangedBy(event.target.value)}
            />
            <p className="field__hint">Recorded in the change history.</p>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="threshold-note">
            Note
          </label>
          <textarea
            id="threshold-note"
            className="field__input"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="field__hint">
            Required when the basis is a prototype assumption. Say where the numbers came
            from, or that they are a bench default.
          </p>
        </div>

        {blocked && (
          <div className="notice" data-tone="warn" role="alert">
            <p className="notice__kind">Cannot save yet</p>
            <ul className="notice__body notice__list">
              {[...outOfRange, ...localProblems].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {problem && (
          <div className="notice" data-kind="service" role="alert">
            <p className="notice__kind">Save failed</p>
            <p className="notice__body">{problem}</p>
          </div>
        )}
        {saved && (
          <div className="notice" data-tone="neutral" role="status">
            <p className="notice__body">
              Saved. The device applies it on its next connection or heartbeat — watch the
              sync line above for confirmation.
            </p>
          </div>
        )}

        <div className="panel__tools">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || blocked}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save limits'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => void load()} disabled={busy}>
            Discard changes
          </button>
        </div>

        {history && history.changes.length > 0 && (
          <>
            <h3 className="panel__sub history__title">Change history</h3>
            <ol className="history">
              {history.changes.map((change) => (
                <li className="history__item" key={change.revision}>
                  <span className="history__rev">rev {change.revision}</span>
                  <span className="history__meta">
                    {new Date(change.changed_at).toLocaleString()}
                    {change.changed_by ? ` · ${change.changed_by}` : ''}
                    {` · ${change.after.source === 'authoritative' ? 'authoritative' : 'prototype assumption'}`}
                  </span>
                  {change.note && <span className="history__note">{change.note}</span>}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
});
