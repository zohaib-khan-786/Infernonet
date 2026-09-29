/**
 * The recent-events timeline (guide §19).
 *
 * §19 wants a chronological stream with a timestamp, a type, a description, a
 * device, a severity and a related entity. The event record carries a
 * timestamp, a type, a message, a device (it is the selected one) and — for the
 * item events — a message that names the item. It carries no severity and no
 * entity id, so those two columns are absent and the reason is printed once
 * above the list rather than as two columns of em dashes.
 *
 * A timeline rather than a table, because the order IS the content here: this is
 * the "what changed recently" answer, and it is read top to bottom. The full
 * searchable log is a different screen with a different job.
 */
import { memo } from 'react';
import type { DeviceEvent } from '../api/types';
import { dateTime, timeWithSeconds } from '../lib/format';
import { eventLabel, isKnownEventType } from '../lib/events';

export interface EventTimelineProps {
  readonly dev: string;
  readonly events: readonly DeviceEvent[];
  /** How many rows to show. The caller owns the "View all" destination. */
  readonly limit: number;
  /** Omitted on the full log page, where it is already the page. */
  readonly onViewAll?: (() => void) | undefined;
  readonly onLoadMore?: (() => void) | undefined;
  readonly loadingMore?: boolean;
  readonly hasMore?: boolean;
}

export const EventTimeline = memo(function EventTimeline({
  dev,
  events,
  limit,
  onViewAll,
  onLoadMore,
  loadingMore,
  hasMore,
}: EventTimelineProps) {
  const shown = events.slice(0, limit);

  if (events.length === 0) {
    return (
      <div className="panel__body">
        <p className="note">
          This device has not reported any events. Events are raised by the device when a threshold latch changes, when
          the door stays open past its limit, or when a required input stops producing data — so an empty log is a
          quiet device rather than a broken one.
        </p>
      </div>
    );
  }

  return (
    <>
      <ol className="timeline">
        {shown.map((event) => {
          const untrusted = !event.time_valid;
          // Keyed on the server row id: `event_id` restarts every boot, so it
          // repeats across boot generations and React may omit/duplicate children.
          return (
            <li className="timeline__item" key={event.id}>
              <p className="timeline__stamp">
                <span className={untrusted ? 'log-item__time log-item__time--untrusted' : 'log-item__time'}>
                  {timeWithSeconds(untrusted ? event.received_at : event.timestamp)}
                </span>
                <span className="timeline__stamp-day">{dateTime(event.received_at)}</span>
                <span className="timeline__stamp-when">
                  {untrusted ? 'received · device time not trusted' : 'reported by the device'}
                </span>
              </p>
              <div className="timeline__body">
                <p className="timeline__type">
                  {eventLabel(event.type)}
                  {isKnownEventType(event.type) ? null : <span className="chip chip--plain">type not in this build</span>}
                </p>
                <p className="timeline__message">{event.message}</p>
                <p className="timeline__meta">
                  <span className="chip chip--plain">{event.type}</span>
                  <span className="chip chip--plain" translate="no">
                    {dev}
                  </span>
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="panel__foot">
        {onViewAll === undefined ? null : (
          <button type="button" className="btn btn--quiet" onClick={onViewAll}>
            View all
          </button>
        )}
        {onLoadMore === undefined || hasMore !== true ? null : (
          <button type="button" className="btn btn--quiet" onClick={onLoadMore} disabled={loadingMore === true}>
            {loadingMore === true ? 'Loading…' : 'Load older'}
          </button>
        )}
        <p className="hint">
          Showing {shown.length} of {events.length} loaded. Older events exist in the service and are fetched on demand.
        </p>
      </div>
    </>
  );
});
