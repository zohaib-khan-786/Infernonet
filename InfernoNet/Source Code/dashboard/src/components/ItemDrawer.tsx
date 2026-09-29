/**
 * The food item detail drawer (guide §17).
 *
 * §17 wants a temperature exposure timeline, and this builds one from real data
 * rather than declaring it unavailable. The reasoning:
 *
 * The device does not store a per-item temperature history, and it never will —
 * there is one cabinet and one thermometer, and per-item history would mean one
 * trace per tag. But an item's exposure IS knowable, because an item spends its
 * whole life in one place, and the cabinet's own trace is kept. So the drawer
 * fetches `/readings` across the item's storage window and plots the cabinet
 * temperature over exactly the period this item was inside the cabinet.
 *
 * That is the exposure the item actually experienced, as far as the record goes,
 * and the two things it is not are printed above the plot: it is not a
 * per-item record, and it is not continuous — buckets with no reading are gaps.
 *
 * The temperature of the item itself is a fourth thing and is not in the record
 * at all. A tag in a fridge is at cabinet temperature to within a degree or two
 * and nobody has ever measured it, so the "current storage temperature" row below
 * is labelled as the cabinet's reading rather than the item's.
 *
 * §17's "door events" and "temperature excursions" are answered in different
 * ways too. An excursion is countable from the trace, and is counted. A door
 * event is not attributable to an item — the device raises one event per open
 * cycle and says nothing about what was inside — so the count is shown with the
 * attribution explicitly denied, because a number labelled "door events: 2"
 * beside an item name reads as "this item had two warm spells".
 */
import { useCallback, useMemo } from 'react';
import { getReadings } from '../api/endpoints';
import type { ApiError } from '../api/client';
import type { CurrentResponse, DeviceEvent, InventoryItem, ReadingsResponse } from '../api/types';
import { bandFor } from '../lib/metrics';
import { dateTime, number } from '../lib/format';
import { duration, outsideSeconds, summariseSeries } from '../lib/series';
import { useResource } from '../lib/useResource';
import { Drawer } from './Drawer';
import { ErrorNotice, LoadingLine } from './Notices';
import { LineChart, type MetricSpec } from './LineChart';
import { StatusChip } from './StatusChip';
import { eventLabel } from '../lib/events';

const CHART_SPEC: MetricSpec = {
  field: 'temperature_c',
  title: 'Cabinet temperature across this item’s storage window',
  unit: '°C',
  digits: 1,
  band: null,
};

function deadlineSentence(item: InventoryItem): string {
  switch (item.derived.deadline_source) {
    case 'expiry':
      return 'from the expiry date the device holds';
    case 'duration':
      return `from the ${number(item.duration_limit_days, 0)}-day storage limit the device holds`;
    default:
      return 'the device holds neither an expiry date nor a storage limit for this item, so the window is zero-length and the device reports Sensor Fault';
  }
}

/**
 * The exposure fetch failed. Not every failure is the same failure, and the two
 * that can happen here want different sentences.
 *
 *   `range_too_wide` is the interesting one. An item stored for longer than the
 *     service keeps readings cannot have its exposure reconstructed, and the
 *     naive response — the generic `ErrorNotice` — puts a service error in the
 *     middle of a food item's record and offers a "Try again" button that cannot
 *     succeed. Worse, it hides the fact that the exposure is *unknown* behind
 *     something that reads as transient. So this says the exposure is not
 *     available and why, states the item's own storage window so the reader can
 *     see how far past the record it reaches, and points at the page that does
 *     hold the retained window. No retry button: retrying the same request
 *     returns the same answer.
 *
 *   anything else is transient and keeps the standard notice.
 */
function ExposureFailure({ error, item, onRetry }: { readonly error: ApiError; readonly item: InventoryItem; readonly onRetry: () => void }) {
  if (error.code === 'range_too_wide') {
    return (
      <div className="notice" data-tone="unknown" role="note">
        <p className="notice__kind">Not available. This is an absence in the record, not a fault in the monitor.</p>
        <p className="notice__title">This item&apos;s temperature exposure is not reconstructable</p>
        <div className="notice__body">
          <p>
            {item.name} has been in the cabinet since{' '}
            {item.store_date === null ? 'a date the service cannot derive' : dateTime(item.store_date)}, against a storage
            window of {item.derived.window_seconds <= 0 ? 'zero length' : duration(item.derived.window_seconds)}. The
            service keeps readings for a limited period and prunes the rest, so the window from the store date to now is
            wider than anything it will return.
          </p>
          <p>
            <strong>No exposure figure is shown for this item, because none exists to show.</strong> The cabinet trace on
            the monitoring page covers the retained window only, and it is not a substitute: reading it as this
            item&apos;s exposure would silently shorten a window that is longer than the record.
          </p>
          <p>The service said: {error.message}</p>
        </div>
      </div>
    );
  }
  return <ErrorNotice what={`Loading the cabinet trace for ${item.name}`} error={error} onRetry={onRetry} />;
}

export interface ItemDrawerProps {
  readonly item: InventoryItem;
  readonly snapshot: CurrentResponse;
  readonly events: readonly DeviceEvent[];
  readonly onClose: () => void;
}

export function ItemDrawer({ item, snapshot, events, onClose }: ItemDrawerProps) {
  const from = item.store_date_epoch;
  const to = Math.floor(Date.now() / 1000);

  // `1m` is requested and the service is allowed to answer with a coarser
  // bucket; it says which in `bucket` and sets `downgraded`, and both are shown
  // above the plot. Asking for a bucket this panel invented would be the same
  // mistake as inventing a threshold.
  const load = useCallback(
    () =>
      getReadings(snapshot.device.dev, {
        from,
        to: Math.max(from + 60, to),
        bucket: '1m',
        fields: ['temperature_c'],
      }),
    [snapshot.device.dev, from, to],
  );

  const readings = useResource<ReadingsResponse>(load);
  const data = readings.data;
  const band = useMemo(() => bandFor('temperature', snapshot.device.thresholds), [snapshot.device.thresholds]);
  const stats = useMemo(
    () => (data === null ? null : summariseSeries('temperature_c', data.series, Date.parse(data.from), Date.parse(data.to), band)),
    [data, band],
  );

  const chartSpec: MetricSpec = band === null ? CHART_SPEC : { ...CHART_SPEC, band: { min: band.min, max: band.max, source: band.source } };

  const windowLabel = `${dateTime(item.store_date)} to ${dateTime(new Date(to * 1000).toISOString())}`;
  const cabinet = snapshot.readings?.temperature_c ?? null;

  // The door-event window is the item's own, NOT the readings window. Deriving it
  // from the trace meant an item whose exposure fetch failed — a long-stored
  // item, which is exactly the interesting case — sat on "counted once the
  // cabinet trace above has loaded" for ever, because it never would.
  const windowFrom = item.store_date_epoch * 1000;
  const windowTo = to * 1000;
  const doorEvents = useMemo(() => {
    if (!Number.isFinite(windowFrom) || windowFrom <= 0) return [];
    return events.filter((event) => {
      if (event.type !== 'door_open') return false;
      const at = Date.parse(event.received_at);
      return Number.isFinite(at) && at >= windowFrom && at <= windowTo;
    });
  }, [events, windowFrom, windowTo]);

  return (
    <Drawer open onClose={onClose} title={item.name} subtitle={`${item.uid} · ${snapshot.device.dev}`}>
      <div className="item-detail">
        <p className="item-detail__status">
          <StatusChip status={item.status} />
          <span className="item-detail__status-note">
            The device&apos;s own verdict for this item, shown as reported. Nothing on this page recomputes it.
          </span>
        </p>

        <div className="facts">
          <div className="fact">
            <span className="fact__label">RFID / ID</span>
            <span className="fact__value" translate="no">
              {item.uid}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Category</span>
            <span className="fact__value">{item.category ?? 'not reported'}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Quantity</span>
            <span className="fact__value">{item.quantity ?? 'not reported'}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Location</span>
            <span className="fact__value">{item.location ?? 'not reported'}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Stored</span>
            <span className="fact__value">{item.store_date === null ? 'not reported' : dateTime(item.store_date)}</span>
          </div>
          <div className="fact">
            <span className="fact__label">Expiry / limit</span>
            <span className="fact__value">
              {item.derived.deadline === null ? 'none held by the device' : dateTime(item.derived.deadline)}
              <span className="withheld__note">{deadlineSentence(item)}</span>
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Storage window</span>
            <span className="fact__value">
              {item.derived.window_seconds <= 0 ? 'zero-length' : duration(item.derived.window_seconds)}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Time remaining</span>
            <span className="fact__value">
              {item.derived.remaining_seconds === null
                ? 'withheld'
                : item.derived.remaining_seconds < 0
                  ? `${duration(-item.derived.remaining_seconds)} past the limit`
                  : duration(item.derived.remaining_seconds)}
              {item.derived.note === null ? null : <span className="withheld__note">{item.derived.note}</span>}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Cabinet temperature now</span>
            <span className="fact__value">
              {cabinet === null ? 'not reported' : `${number(cabinet, 1)} °C`}
              <span className="withheld__note">
                The cabinet&apos;s reading, not this item&apos;s. The item carries a passive RFID tag and has no
                temperature sensor of its own.
              </span>
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Revisions</span>
            <span className="fact__value">
              {number(item.revisions.first, 0)}
              {item.revisions.last === item.revisions.first ? '' : ` to ${number(item.revisions.last, 0)}`}
              {item.revisions.retired ? ' · retired' : ''}
            </span>
          </div>
        </div>

        <section className="item-detail__exposure" aria-label="Temperature exposure">
          <h3 className="chart__title">Temperature exposure</h3>
          <p className="note">
            This is the cabinet&apos;s own trace over the period this item was inside it ({windowLabel}). It is not a
            per-item record — the device keeps one trace for the cabinet — and it is the closest thing to an exposure
            record that exists. The item&apos;s own temperature has never been measured.
          </p>

          {readings.loading ? <LoadingLine>Loading the cabinet trace for this item&apos;s window…</LoadingLine> : null}

          {readings.error !== null ? <ExposureFailure error={readings.error} item={item} onRetry={readings.reload} /> : null}

          {data !== null && data.points === 0 ? (
            <p className="note">
              The service has no retained readings from this item&apos;s storage window. Readings are pruned on a
              retention schedule and this item has been stored longer than the window the service keeps, so its exposure
              is not reconstructable — which is itself the honest answer.
            </p>
          ) : null}

          {data !== null && data.points > 0 ? (
            <>
              {data.downgraded ? (
                <p className="panel__note-strip panel__note-strip--spaced">
                  The service could not return the requested <span className="num">{data.requested_bucket}</span> bucket
                  within its {number(data.max_points, 0)}-point limit, so it used <span className="num">{data.bucket}</span>.
                  Each point is an average over that much time, so a short warm spell inside one bucket is not visible in
                  the time-outside-the-limit figure below.
                </p>
              ) : null}
              <LineChart
                spec={chartSpec}
                points={data.series}
                from={Date.parse(data.from)}
                to={Date.parse(data.to)}
                rangeLabel="time this item has been stored"
              />
              <div className="facts">
                <div className="fact">
                  <span className="fact__label">Lowest</span>
                  <span className="fact__value">{stats?.min === null || stats === null ? '—' : `${number(stats.min.value, 1)} °C`}</span>
                </div>
                <div className="fact">
                  <span className="fact__label">Average</span>
                  <span className="fact__value">{stats?.average === null || stats === null ? '—' : `${number(stats.average, 1)} °C`}</span>
                </div>
                <div className="fact">
                  <span className="fact__label">Highest</span>
                  <span className="fact__value">{stats?.max === null || stats === null ? '—' : `${number(stats.max.value, 1)} °C`}</span>
                </div>
                <div className="fact">
                  <span className="fact__label">Time outside the device limits</span>
                  <span className="fact__value">
                    {stats === null || band === null
                      ? 'not computed — the device configures no temperature limit'
                      : outsideSeconds(stats) === 0
                        ? 'none of the retained window'
                        : duration(outsideSeconds(stats))}
                  </span>
                </div>
                <div className="fact">
                  <span className="fact__label">Temperature excursions</span>
                  <span className="fact__value">
                    {stats === null || band === null
                      ? 'not computable'
                      : outsideSeconds(stats) === 0
                        ? 'none in the retained window'
                        : `at least one — ${duration(outsideSeconds(stats))} of buckets averaged outside the limits`}
                  </span>
                </div>
                <div className="fact">
                  <span className="fact__label">Window with no reading</span>
                  <span className="fact__value">
                    {stats === null
                      ? '—'
                      : stats.unknownSeconds === 0
                        ? 'none'
                        : `${duration(stats.unknownSeconds)} unknown, not counted as in range`}
                  </span>
                </div>
              </div>
            </>
          ) : null}
        </section>

        <section className="item-detail__door" aria-label="Door events during this item's storage window">
          <h3 className="chart__title">Door events while this item was stored</h3>
          {item.store_date_epoch <= 0 ? (
            <p className="note">
              The device holds no store date for this item, so there is no window in which to count door events and none
              is counted.
            </p>
          ) : (
            <>
              <p className="note">
                <strong>{doorEvents.length}</strong> door-open event{doorEvents.length === 1 ? '' : 's'} between{' '}
                {dateTime(item.store_date)} and now. These are the cabinet&apos;s, not this item&apos;s: the device raises
                one event per open cycle, records nothing about what was inside, and cannot attribute an open period to
                a tag. A number beside this item&apos;s name that implied &quot;this item warmed twice&quot; would be a
                false statement, so the count is the cabinet&apos;s and is labelled that way. The window is the item&apos;s
                own store date to now; it is not limited by the readings retention the exposure section above is.
              </p>
              {doorEvents.length === 0 ? null : (
                <ul className="marker-list">
                  {doorEvents.slice(0, 10).map((event) => (
                    // `id`, not `event_id`: the device's counter restarts every boot, so the
                    // same `event_id` recurs across boot generations and React may omit children.
                    <li className="marker-list__item" key={event.id}>
                      <span className="num marker-list__time">{dateTime(event.received_at)}</span>
                      <span className="marker-list__type">{eventLabel(event.type)}</span>
                      <span className="marker-list__message">{event.message}</span>
                    </li>
                  ))}
                  {doorEvents.length > 10 ? (
                    <li className="marker-list__item marker-list__more">
                      {number(doorEvents.length - 10, 0)} more in the event log.
                    </li>
                  ) : null}
                </ul>
              )}
            </>
          )}
        </section>

        <section className="item-detail__history" aria-label="History the device holds for this item">
          <h3 className="chart__title">History the device holds</h3>
          <ul className="absence-list">
            <li>
              Store epoch <span className="num">{number(item.store_date_epoch, 0)}</span>
              {item.store_date === null ? ' (no date is derivable from it)' : ` → ${dateTime(item.store_date)}`}
            </li>
            <li>
              Expiry epoch <span className="num">{number(item.expiry_epoch, 0)}</span>
              {item.expiry === null ? ' (no date is derivable from it)' : ` → ${dateTime(item.expiry)}`}
            </li>
            <li>
              Storage limit <span className="num">{number(item.duration_limit_days, 0)}</span> days
              {item.derived.deadline_source === 'duration' ? ' (this is what sets the deadline)' : ' (expiry wins over it)'}
            </li>
            <li>
              Revisions {number(item.revisions.first, 0)}
              {item.revisions.last === item.revisions.first ? '' : ` to ${number(item.revisions.last, 0)}`}
              {item.revisions.retired
                ? ` · retired at revision ${number(item.revisions.retired_at_revision, 0)}`
                : ' · not retired'}
            </li>
            <li>
              Progress <span className="num">{item.derived.progress_percent === null ? 'withheld' : `${number(item.derived.progress_percent, 1)}%`}</span>{' '}
              of the window
            </li>
          </ul>
          <p className="hint">
            The device keeps these five numbers and nothing else. There is no per-item log, no per-item reading and no
            per-item last-seen time, so this list is the whole of the item&apos;s history.
          </p>
        </section>
      </div>
    </Drawer>
  );
}
