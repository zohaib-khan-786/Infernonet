/**
 * Stored food.
 *
 * The workhorse table, ordered by what a volunteer should deal with first:
 * check_food, then use_soon, then sensor_fault, then fresh. Within a rank, the
 * item the device says has least time left comes first — using only the
 * `remaining_seconds` the service sent. A withheld duration leaves the item in
 * its status rank and falls back to name order rather than inventing a sort key.
 *
 * The two rules that shape this file:
 *
 *   A withheld duration is a first-class state. `remaining_seconds === null`
 *   with a note about the clock is rendered as "withheld" plus the service's own
 *   reason. It is never 0 s, never a dash, and never a guess. A progress bar is
 *   hatched rather than empty for the same reason: an empty bar reads as 0% used.
 *
 *   The status column is the device's verdict and only the device's verdict. It
 *   is rendered from `status.label`; nothing here re-evaluates a threshold, and
 *   the sort key is the same code, not a re-derivation.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { getInventory, inventoryCsvUrl } from '../api/endpoints';
import type { CurrentResponse, InventoryItem, InventoryResponse } from '../api/types';
import { count, dateTime, number, remaining } from '../lib/format';
import { byUrgency } from '../lib/status';
import { useResource } from '../lib/useResource';
import { useDashboardActions } from '../store/DashboardProvider';
import { ErrorNotice, LoadingLine } from './Notices';
import { StatusChip } from './StatusChip';

/* --- Progress meter -------------------------------------------------------- */

interface MeterProps {
  readonly percent: number | null;
  readonly note: string | null;
  readonly windowLabel: string;
  readonly withheldLabel: string;
}

const ProgressMeter = memo(function ProgressMeter({ percent, note, windowLabel, withheldLabel }: MeterProps) {
  if (percent === null) {
    return (
      <div className="meter meter--withheld">
        <div
          className="meter__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={withheldLabel}
        >
          <span className="meter__notch" aria-hidden="true" />
        </div>
        <p className="meter__scale">
          <span className="withheld__value">{withheldLabel}</span>
        </p>
        {note === null ? null : <p className="withheld__note">{note}</p>}
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="meter">
      <div
        className="meter__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-valuetext={`${number(clamped, 1)}% of the storage window elapsed. The device's use-soon threshold is 75%.`}
      >
        <span className="meter__fill" style={{ width: `${clamped}%` }} />
        <span className="meter__notch" aria-hidden="true" />
      </div>
      <p className="meter__scale">
        <span className="meter__value">{number(clamped, 1)}%</span>
        <span>{windowLabel}</span>
      </p>
    </div>
  );
});

/* --- Row ------------------------------------------------------------------- */

function windowLabelFor(item: InventoryItem): string {
  const days = item.derived.window_seconds / 86_400;
  if (item.derived.window_seconds <= 0) return 'no window';
  if (days >= 1 && Number.isInteger(days)) return `${days} d window`;
  if (days >= 1) return `${number(days, 1)} d window`;
  return `${number(item.derived.window_seconds / 3600, 1)} h window`;
}

function deadlineFoot(item: InventoryItem): string | null {
  switch (item.derived.deadline_source) {
    case 'expiry':
      return 'from the expiry date the device holds';
    case 'duration':
      return `from the ${item.duration_limit_days}-day storage limit the device holds`;
    case 'none':
    default:
      return 'the device holds no expiry date and no storage limit for this item';
  }
}

interface RowProps {
  readonly item: InventoryItem;
}

const InventoryRow = memo(function InventoryRow({ item }: RowProps) {
  const remainingText = remaining(item.derived.remaining_seconds);
  const withheld = remainingText === null;
  const note = item.derived.note;
  const deadline = item.derived.deadline;
  const deadlineFootText = deadlineFoot(item);

  return (
    <tr className={item.revisions.retired ? 'row-retired' : undefined}>
      <th scope="row" className="cell-head">
        <span className="food-cell">
          <span className="food-cell__name">{item.name}</span>
          <span className="food-cell__uid" translate="no">
            {item.uid}
          </span>
          <span className="food-cell__meta">
            <span>{item.category ?? 'No category'}</span>
            <span aria-hidden="true"> </span>
            <span>{item.location ?? 'No location'}</span>
          </span>
          {item.revisions.retired ? <span className="chip chip--plain">Retired</span> : null}
        </span>
      </th>

      <td className="cell-num">
        <span className="cell-label">Quantity</span>
        {item.quantity ?? '—'}
      </td>

      <td>
        <span className="cell-label">Status</span>
        <StatusChip status={item.status} />
      </td>

      <td className="cell-num">
        <span className="cell-label">Deadline</span>
        {deadline === null ? (
          <span className="withheld">
            <span className="withheld__value">none</span>
            {deadlineFootText === null ? null : <span className="withheld__note">{deadlineFootText}</span>}
          </span>
        ) : (
          <span className="num">{dateTime(deadline)}</span>
        )}
        {deadline !== null && deadlineFootText !== null && item.derived.deadline_source !== 'none' ? (
          <span className="food-cell__meta">{deadlineFootText}</span>
        ) : null}
      </td>

      <td className="cell-num">
        <span className="cell-label">Time remaining</span>
        {withheld ? (
          <span className="withheld">
            <span className="withheld__value">withheld</span>
            <span className="withheld__note">
              {note ?? 'The service withheld this duration without giving a reason.'}
            </span>
          </span>
        ) : (
          <span className="num">{remainingText}</span>
        )}
        {note !== null && !withheld ? <span className="food-cell__meta">{note}</span> : null}
      </td>

      <td>
        <span className="cell-label">Storage window</span>
        <ProgressMeter
          percent={item.derived.progress_percent}
          note={withheld ? null : note}
          windowLabel={windowLabelFor(item)}
          withheldLabel={item.derived.deadline_source === 'none' ? 'no window' : 'withheld'}
        />
        {withheld && item.derived.deadline_source === 'none' && note !== null ? (
          <span className="withheld__note">{note}</span>
        ) : null}
      </td>
    </tr>
  );
});

/* --- Panel ----------------------------------------------------------------- */

export interface InventoryPanelProps {
  readonly dev: string;
  readonly snapshot: CurrentResponse;
}

export const InventoryPanel = memo(function InventoryPanel({ dev, snapshot }: InventoryPanelProps) {
  const { reloadCurrent } = useDashboardActions();

  const [showRetired, setShowRetired] = useState(false);
  // The first paint uses the active list that already arrived inside the
  // snapshot, so the common case costs no extra request. The retired toggle is
  // the only thing that needs the inventory endpoint.
  const loadAll = useCallback(() => getInventory(dev, { retired: true }), [dev]);
  const all = useResource<InventoryResponse>(showRetired ? loadAll : null);

  const retiredCount = snapshot.counts.inventory_retired;
  const activeCount = snapshot.counts.inventory_active;

  const rows = useMemo(() => {
    const source = showRetired && all.data !== null ? all.data.items : snapshot.inventory;
    const active = byUrgency(source.filter((item) => !item.revisions.retired));
    if (!showRetired) return active;
    return [...active, ...byUrgency(source.filter((item) => item.revisions.retired))];
  }, [showRetired, all.data, snapshot.inventory]);

  const clockTrusted = snapshot.device.time_valid && snapshot.device.reported_at !== null;

  return (
    <section className="panel" aria-labelledby="food-title">
      <div className="panel__head">
        <h2 className="panel__title" id="food-title">
          Stored food
        </h2>
        <p className="panel__sub">
          {count(activeCount, 'active item')}
          {retiredCount > 0 ? ` · ${count(retiredCount, 'retired item')}` : ''} · ordered by urgency
        </p>
        <div className="panel__tools">
          {retiredCount > 0 ? (
            <button
              type="button"
              className="btn btn--quiet"
              aria-pressed={showRetired}
              onClick={() => setShowRetired((value) => !value)}
            >
              {showRetired ? 'Hide retired items' : 'Show retired items'}
            </button>
          ) : null}
          <a className="btn" href={inventoryCsvUrl(dev)} download>
            Download CSV
          </a>
        </div>
      </div>

      {!clockTrusted ? (
        <p className="panel__note-strip">
          The device clock is not trusted, so every time remaining and every progress figure below is withheld by the
          service. Deadlines are still shown because they come from dates the device holds, not from a clock comparison.
        </p>
      ) : null}

      {showRetired && all.loading ? <LoadingLine>Loading retired items…</LoadingLine> : null}
      {showRetired && all.error !== null ? (
        <div className="panel__body">
          <ErrorNotice what="Loading the full item list" error={all.error} onRetry={all.reload} />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="panel__body">
          <p className="note">
            No food is registered on this device. Items are registered by scanning their RFID tag against the reader
            inside the cabinet; the device reports the new list on its next snapshot. An empty list is not a fault — the
            device would report{' '}
            <span className="num">Sensor Fault</span> if it could not send one.
          </p>
        </div>
      ) : (
        <div className="panel__body panel__body--flush">
          {/* Scroll container, not decoration: it is what stops a
              non-wrapping table from painting over the sibling panel. See
              .food-table-scroll in components.css. */}
          <div className="food-table-scroll" tabIndex={0} role="region" aria-label="Stored food table">
            <table className="data-table food-table">
            <caption className="visually-hidden">
              Stored food for device {dev}, ordered by urgency. The status column is the verdict the device reported;
              the time and progress columns are withheld when the device clock is not trusted.
            </caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="cell-num">
                  Quantity
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="cell-num">
                  Deadline
                </th>
                <th scope="col" className="cell-num">
                  Time remaining
                </th>
                <th scope="col">Storage window</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <InventoryRow key={item.uid} item={item} />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="panel__foot">
        <p className="hint">
          Status is the device&apos;s own verdict, shown as reported. Times are the service&apos;s projection of the
          device&apos;s own dates; where they are withheld it says why.
        </p>
        <button type="button" className="btn btn--quiet" onClick={reloadCurrent}>
          Refresh list
        </button>
      </div>
    </section>
  );
});
