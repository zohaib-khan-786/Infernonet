/**
 * The alert detail drawer (guide §15).
 *
 * §15's layout is: current value, threshold, started, duration, device, sensor,
 * related events, and five actions. Read against what the service actually
 * returns, here is where each of those lands.
 *
 *   current value   real, for a condition whose key names a measurement; an
 *                   explicit absence with a reason otherwise
 *   threshold       the device's own configured limit for that measurement, with
 *                   its source. Where the backend says the threshold is not
 *                   transmitted, this says so in the backend's own terms
 *   started         NOT AVAILABLE, and the panel is built to make that legible
 *   duration        NOT AVAILABLE, and it follows from `started`
 *   device          real
 *   sensor          real, from the fault-bit name in the condition key
 *   related events  a correlation over the loaded event log, labelled as one
 *   acknowledge     real, through the store
 *   resolve         NOT AVAILABLE — the device has no resolve path. A condition
 *                   clears when the underlying state clears, and nothing here
 *                   can clear it by hand
 *   add note        the acknowledgement carries a name; a per-alert note is not
 *                   reachable from the store's action in this build
 *   view chart      real, for a condition that names a measurement
 *   view related    the correlation list, in place
 *
 * The `started`/`duration` pair is the load-bearing honesty decision on this
 * screen. A volunteer looking at a condition wants to know how long the food has
 * been like this, and the two numbers that could stand in — the time the
 * dashboard first noticed, and the age of the current snapshot — are both facts
 * about the browser. Substituting either would put a confident duration on
 * screen that no system ever measured, on the page where somebody decides
 * whether to throw food away.
 */
import { useMemo, type ReactNode } from 'react';
import type { Alert, CurrentResponse, DeviceEvent } from '../api/types';
import { dateTime, number } from '../lib/format';
import { conditionFacts } from '../lib/conditions';
import { eventLabel, relatedEvents, subjectFor } from '../lib/events';
import type { MetricId } from '../lib/metrics';
import { conditionPresentation } from '../lib/status';
import { Drawer } from './Drawer';
import { Mark } from './Mark';

/** The measurements the shared chart component plots. See `lib/metrics`. */
const CHARTABLE = new Set<string>(['temperature', 'humidity', 'pressure', 'gas']);

export interface AlertDetailProps {
  readonly alert: Alert;
  readonly dev: string;
  readonly snapshot: CurrentResponse;
  readonly events: readonly DeviceEvent[];
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onAcknowledge: (key: string) => void;
  readonly onUnacknowledge: (key: string) => void;
  /** Called with no arguments to close. Must be stable. */
  readonly onClose: () => void;
  /** Opens the metric detail for a measurement, when the condition names one. */
  readonly onViewChart: (metricId: MetricId) => void;
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="fact">
      <span className="fact__label">{label}</span>
      <span className="fact__value">{children}</span>
    </div>
  );
}

export function AlertDetail({ alert, dev, snapshot, events, pending, error, onAcknowledge, onUnacknowledge, onClose, onViewChart }: AlertDetailProps) {
  const facts = useMemo(
    () => conditionFacts(alert, snapshot.readings, snapshot.device.thresholds),
    [alert, snapshot.readings, snapshot.device.thresholds],
  );
  const severity = conditionPresentation(alert);
  const related = useMemo(() => relatedEvents(alert, events), [alert, events]);
  const subject = subjectFor(alert);

  const chartId: MetricId | null = facts.metric !== null && CHARTABLE.has(facts.metric.id) ? facts.metric.id : null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={alert.title}
      subtitle={
        <>
          {dev} · <span className="num">{alert.condition_key}</span>
        </>
      }
    >
      <div className="alert-detail">
        <p className="alert-detail__status">
          <span className="chip" data-tone={severity.tone}>
            <Mark shape={severity.shape} className="mark--sm" />
            {severity.title}
          </span>
          <span className="chip chip--plain">kind: {alert.kind}</span>
          {alert.uid === undefined ? null : (
            <span className="chip chip--plain">
              item <span translate="no">{alert.uid}</span>
            </span>
          )}
        </p>

        {/* The backend's own prose, verbatim. It encodes the requirement rules
            and paraphrasing a safety rule is not this page's job. */}
        <p className="alert-detail__detail">{alert.detail}</p>

        <div className="facts">
          <Row label="Current value">
            {facts.metric === null ? (
              <span className="withheld">
                <span className="withheld__value">not transmitted</span>
                <span className="withheld__note">
                  This condition does not name a measurement. The device reports the condition and says nothing about
                  which reading produced it.
                </span>
              </span>
            ) : facts.value === null ? (
              <span className="withheld">
                <span className="withheld__value">not reported</span>
                <span className="withheld__note">{facts.valueAbsence}</span>
              </span>
            ) : (
              <span className="num">
                {number(facts.value.value, facts.metric.digits)} {facts.metric.unit}
                <span className="withheld__note">from the reading received {dateTime(facts.value.at)}</span>
              </span>
            )}
          </Row>

          <Row label="Threshold">
            {facts.band === null ? (
              <span className="withheld">
                <span className="withheld__value">
                  {facts.metric === null ? 'not transmitted' : 'none configured'}
                </span>
                <span className="withheld__note">
                  {facts.metric === null
                    ? 'The device does not send the threshold a condition was raised against. Its own detail text above says which of its cases this is.'
                    : 'The device configures no limit for this measurement, so there is no threshold to compare against.'}
                </span>
              </span>
            ) : (
              <>
                <span className="num">
                  {number(facts.band.min, facts.metric?.digits ?? 1)} to {number(facts.band.max, facts.metric?.digits ?? 1)}{' '}
                  {facts.metric?.unit ?? ''}
                </span>
                <span className="withheld__note">{facts.band.source}</span>
              </>
            )}
          </Row>

          <Row label="Started">
            <span className="withheld">
              <span className="withheld__value">not recorded</span>
              <span className="withheld__note">{facts.startedNote}</span>
            </span>
          </Row>

          <Row label="Duration">
            <span className="withheld">
              <span className="withheld__value">not computable</span>
              <span className="withheld__note">There is no onset time to measure from. The event log records transitions; this condition is a state.</span>
            </span>
          </Row>

          <Row label="Device">
            <span translate="no">{dev}</span>
            <span className="withheld__note">
              Zone verdict {snapshot.device.zone_status.label} · overall {snapshot.device.overall_status.label} · snapshot received{' '}
              {dateTime(snapshot.readings?.recorded_at ?? snapshot.device.last_ingest_at)}
            </span>
          </Row>

          <Row label="Sensor">
            {facts.sensor === null ? (
              <span className="withheld">
                <span className="withheld__value">not named</span>
                <span className="withheld__note">The condition covers the device as a whole rather than one input.</span>
              </span>
            ) : (
              <span translate="no">{facts.sensor}</span>
            )}
          </Row>

          <Row label="Acknowledged">
            {alert.acknowledged ? (
              <>
                yes
                {alert.acknowledged_by === null ? null : ` by ${alert.acknowledged_by}`}
                {alert.acknowledged_at === null ? null : ` at ${dateTime(alert.acknowledged_at)}`}
                {alert.acknowledgement_note === null ? null : ` — “${alert.acknowledgement_note}”`}
              </>
            ) : (
              'not yet'
            )}
          </Row>
        </div>

        <section className="alert-detail__related" aria-label="Related events">
          <h3 className="chart__title">Related events</h3>
          {subject === null ? (
            <p className="note">
              None can be listed for this condition, and the reason is worth stating rather than hiding behind an empty
              list. The device reports a whole-zone or whole-inventory status without saying which measurement produced
              it — the backend&apos;s own words are &quot;which specific threshold raised it is not transmitted&quot; — so
              there is nothing to match an event against. The event log below the conditions is the complete record of
              what the device did record.
            </p>
          ) : related.length === 0 ? (
            <p className="note">
              The device raised no events about this subject in the {events.length} event{events.length === 1 ? '' : 's'}{' '}
              loaded on this page. That is not the whole log — load more on the event log to widen the window.
            </p>
          ) : (
            <>
              <p className="note">
                A correlation, not a link: the service stores no association between a condition and an event. These are
                the {related.length} loaded event{related.length === 1 ? '' : 's'} whose type is about the same subject
                ({subject}). The full log is on the Logs page.
              </p>
              <ul className="marker-list">
                {related.slice(0, 10).map((event) => (
                  // `id`, not `event_id`: the device's counter restarts every boot, so the
                  // same `event_id` recurs across boot generations and React may omit children.
                  <li className="marker-list__item" key={event.id}>
                    <span className="num marker-list__time">{dateTime(event.received_at)}</span>
                    <span className="marker-list__type">{eventLabel(event.type)}</span>
                    <span className="marker-list__message">{event.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {error === undefined ? null : (
          <div className="notice" data-kind="service" role="alert">
            <p className="notice__title">The acknowledgement did not save</p>
            <p className="notice__body">{error}</p>
          </div>
        )}

        <div className="notice__actions">
          {alert.acknowledged ? (
            <button type="button" className="btn btn--quiet" onClick={() => onUnacknowledge(alert.condition_key)} disabled={pending}>
              {pending ? 'Saving…' : 'Un-acknowledge'}
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => onAcknowledge(alert.condition_key)} disabled={pending}>
              {pending ? 'Saving…' : 'Acknowledge'}
            </button>
          )}
          {chartId === null ? null : (
            <button type="button" className="btn" onClick={() => onViewChart(chartId)}>
              View chart
            </button>
          )}
          {/*
            The two actions §15 lists that cannot exist here, stated rather than
            rendered. "Resolve" would need a device that accepts a resolve; the
            firmware has none, and a button that cleared a local flag while the
            device kept the condition raised is the worst of both. "Add note" is
            reachable only through a store action whose signature takes a
            condition key and a name.
          */}
          <span className="hint">
            Resolve is not available: the device has no resolve path, and a condition clears when the underlying state
            clears. A per-alert note is not available: acknowledgement records a name only.
          </span>
        </div>
      </div>
    </Drawer>
  );
}
