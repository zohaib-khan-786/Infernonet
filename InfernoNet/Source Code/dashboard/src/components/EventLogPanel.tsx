/**
 * Event log.
 *
 * The device's own alert history, newest first, paged with the `before` cursor
 * the service returns. It is deliberately not fed by the SSE stream: a
 * snapshot is a full *state*, and a log is a history. Reading it from
 * `/events` on demand is both cheaper and the only way to page.
 *
 * The time rule is the interesting part. Each event carries the device's own
 * timestamp and a `time_valid` flag. When the flag is false there is no device
 * timestamp at all, so the row shows the service's receipt time, says so, and
 * marks the stamp as untrusted rather than quietly substituting one for the
 * other.
 */
import { memo } from 'react';
import { dateTime, number, timeWithSeconds } from '../lib/format';
import { useDashboard, useDashboardActions } from '../store/DashboardProvider';
import { EmptyState, ErrorNotice, LoadingLine } from './Notices';

export const EventLogPanel = memo(function EventLogPanel() {
  const { events } = useDashboard();
  const { loadMoreEvents, reloadEvents } = useDashboardActions();

  return (
    <section className="panel" aria-labelledby="log-title">
      <div className="panel__head">
        <h2 className="panel__title" id="log-title">
          Event log
        </h2>
        <p className="panel__sub">
          {events.items.length === 0 ? (
            'No events yet'
          ) : (
            <>
              <span className="num">{number(events.items.length, 0)}</span> shown, newest first
            </>
          )}
        </p>
      </div>

      {events.loading ? <LoadingLine>Loading the event log…</LoadingLine> : null}

      {events.error !== null ? (
        <div className="panel__body">
          <ErrorNotice what="Loading the event log" error={events.error} onRetry={reloadEvents} />
        </div>
      ) : null}

      {!events.loading && events.error === null && events.items.length === 0 ? (
        <div className="panel__body">
          <EmptyState title="This device has not reported any events">
            <p>
              Events are raised by the device itself when a threshold latch changes, when the door stays open, or when a
              required input stops producing data. An empty log means none of those has happened since the device
              started reporting.
            </p>
          </EmptyState>
        </div>
      ) : null}

      {events.items.length > 0 ? (
        <ul>
          {events.items.map((event) => {
            const untrusted = !event.time_valid;
            // Keyed on the server row id: `event_id` restarts every boot, so it
            // repeats across boot generations and React may omit/duplicate children.
            return (
              <li className="log-item" key={event.id}>
                <p className="log-item__stamp">
                  <span className={untrusted ? 'log-item__time log-item__time--untrusted' : 'log-item__time'}>
                    {untrusted ? timeWithSeconds(event.received_at) : timeWithSeconds(event.timestamp)}
                  </span>
                  <span>{untrusted ? 'received · device time not trusted' : 'reported by the device'}</span>
                  {untrusted ? null : <span title={dateTime(event.timestamp)}>{dateTime(event.timestamp)}</span>}
                </p>
                <div className="log-item__body">
                  <p className="log-item__type" translate="no">
                    {event.type}
                  </p>
                  <p className="log-item__message">{event.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {events.hasMore || events.loadingMore ? (
        <div className="panel__foot">
          <button type="button" className="btn" onClick={loadMoreEvents} disabled={events.loadingMore}>
            {events.loadingMore ? 'Loading…' : 'Load older events'}
          </button>
          {events.hasMore ? (
            <p className="hint">Older events exist. Loading them keeps the newest at the top.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
