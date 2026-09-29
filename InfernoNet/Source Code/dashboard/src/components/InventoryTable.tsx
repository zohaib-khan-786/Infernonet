/**
 * The inventory table (guide §16).
 *
 * §16 asks for nine columns: Item, RFID / ID, Category, Stored, Last checked,
 * Temperature exposure, Status, Expiry, Actions. Five of the nine are fields the
 * service sends. The other four are absences, and they are absences for
 * different reasons, so they are absences in four different ways:
 *
 *   Last checked           The device keeps no per-item "last seen" record. A
 *                          snapshot is a state, not a log, and the only item
 *                      field that changes over time is a revision number. There
 *                          is no timestamp to show, so none is.
 *
 *   Temperature exposure   The device records no per-item temperature history.
 *                      An item's exposure is a function of where it sat and when,
 *                      and only the cabinet's own trace is kept. The item detail
 *                      drawer draws exactly that trace across the item's storage
 *                      window, which is the real exposure as far as the record
 *                      goes, and this cell links to it rather than summarising
 *                      something nobody stored.
 *
 *   Stored                 Real: the service's projection of the store epoch the
 *                      device holds. Its own `derived.note` says when the device
 *                      clock is not trusted, and that note is shown with it.
 *
 *   Expiry                 Real, from the same derivation, with the source named:
 *                      the expiry date the device holds, or the storage limit it
 *                      holds, or neither.
 *
 * The status column is the device's own verdict and only the device's verdict.
 * Nothing in this file re-evaluates a threshold, and the sort is the same code
 * the device sent, not a re-derivation of it.
 */
import { memo } from 'react';
import type { InventoryItem } from '../api/types';
import { dateTime, number, remaining } from '../lib/format';
import { StatusChip } from './StatusChip';

function deadlineSource(item: InventoryItem): string {
  switch (item.derived.deadline_source) {
    case 'expiry':
      return 'from the expiry date the device holds';
    case 'duration':
      return `from the ${number(item.duration_limit_days, 0)}-day storage limit the device holds`;
    default:
      return 'the device holds neither an expiry date nor a storage limit for this item';
  }
}

interface RowProps {
  readonly item: InventoryItem;
  readonly onOpen: (uid: string) => void;
  readonly open: boolean;
}

const InventoryTableRow = memo(function InventoryTableRow({ item, onOpen, open }: RowProps) {
  const remainingText = remaining(item.derived.remaining_seconds);
  const withheld = remainingText === null;
  const deadline = item.derived.deadline;

  return (
    <tr className={item.revisions.retired ? 'row-retired' : undefined}>
      <th scope="row" className="cell-head">
        <span className="food-cell">
          <span className="food-cell__name">{item.name}</span>
          {item.quantity === null ? null : <span className="food-cell__meta">quantity {item.quantity}</span>}
          {item.location === null ? null : <span className="food-cell__meta">at {item.location}</span>}
          {item.revisions.retired ? <span className="chip chip--plain">Retired</span> : null}
        </span>
      </th>

      <td>
        <span className="cell-label">RFID / ID</span>
        <span className="food-cell__uid" translate="no">
          {item.uid}
        </span>
        <span className="food-cell__meta">
          revision {number(item.revisions.first, 0)}
          {item.revisions.last === item.revisions.first ? '' : ` to ${number(item.revisions.last, 0)}`}
        </span>
      </td>

      <td>
        <span className="cell-label">Category</span>
        {item.category ?? <span className="part-cell__na">not reported</span>}
      </td>

      <td>
        <span className="cell-label">Stored</span>
        {item.store_date === null ? (
          <span className="part-cell__na">not reported</span>
        ) : (
          <span className="num">{dateTime(item.store_date)}</span>
        )}
        {item.derived.clock_trusted ? null : (
          <span className="withheld__note">device clock not trusted, so this date is the stored epoch, not a duration</span>
        )}
      </td>

      <td>
        <span className="cell-label">Last checked</span>
        <span className="withheld">
          <span className="withheld__value">not recorded</span>
          <span className="withheld__note">
            The device keeps no per-item last-seen record. A snapshot is a state, not a log.
          </span>
        </span>
      </td>

      <td>
        <span className="cell-label">Temperature exposure</span>
        <span className="withheld">
          <span className="withheld__value">not stored per item</span>
          <span className="withheld__note">
            Only the cabinet&apos;s own trace is kept. Open the item to see that trace across its storage window.
          </span>
        </span>
      </td>

      <td>
        <span className="cell-label">Status</span>
        <StatusChip status={item.status} />
      </td>

      <td>
        <span className="cell-label">Expiry</span>
        {deadline === null ? (
          <span className="withheld">
            <span className="withheld__value">none</span>
            <span className="withheld__note">{deadlineSource(item)}</span>
          </span>
        ) : (
          <>
            <span className="num">{dateTime(deadline)}</span>
            <span className="food-cell__meta">{deadlineSource(item)}</span>
            {withheld ? null : <span className="food-cell__meta">{remainingText}</span>}
          </>
        )}
        {withheld && deadline !== null && item.derived.note !== null ? (
          <span className="withheld__note">{item.derived.note}</span>
        ) : null}
      </td>

      <td>
        <span className="cell-label">Actions</span>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => onOpen(item.uid)}
          aria-expanded={open}
          aria-label={`Open the detail for ${item.name}`}
        >
          Details
        </button>
      </td>
    </tr>
  );
});

export interface InventoryTableProps {
  readonly items: readonly InventoryItem[];
  readonly dev: string;
  readonly onOpen: (uid: string) => void;
  readonly openUid: string | null;
}

export const InventoryTable = memo(function InventoryTable({ items, dev, onOpen, openUid }: InventoryTableProps) {
  return (
    <div className="food-table-scroll" tabIndex={0} role="region" aria-label="Inventory table">
      <table className="data-table food-table">
        <caption className="visually-hidden">
          Stored food for device {dev}. The status column is the verdict the device reported and is not recomputed
          here; the last-checked and temperature-exposure columns are recorded as absent because the device stores
          neither.
        </caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">RFID / ID</th>
            <th scope="col">Category</th>
            <th scope="col">Stored</th>
            <th scope="col">Last checked</th>
            <th scope="col">Temperature exposure</th>
            <th scope="col">Status</th>
            <th scope="col">Expiry</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <InventoryTableRow key={item.uid} item={item} onOpen={onOpen} open={openUid === item.uid} />
          ))}
        </tbody>
      </table>
    </div>
  );
});
