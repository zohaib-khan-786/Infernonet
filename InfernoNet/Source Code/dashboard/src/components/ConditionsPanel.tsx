/**
 * Active conditions.
 *
 * Grouped by *what the condition is about* before it is grouped by how loud it
 * is. The backend files a LittleFS fault at `severity: error`, the same level
 * as an item that reached its limit, and says in its own detail text that
 * freshness is unaffected. Sorting purely by severity would therefore put a
 * filing problem in the same list as "throw this food out". So the lanes come
 * first — Food status, Device health, Administration — and severity orders
 * within a lane.
 *
 * The `detail` line is the backend's prose and is rendered verbatim. It encodes
 * the requirement rules (R-09, R-10, R-11, R-12, R-13) in the only place they
 * can be accurate, which is next to the condition they describe. Rewriting it
 * here would be paraphrasing a safety rule.
 */
import { memo, useId } from 'react';
import type { Alert } from '../api/types';
import { dateTime, humaniseLabel } from '../lib/format';
import { conditionPresentation, groupAlerts, type Lane } from '../lib/status';
import { useDashboard, useDashboardActions } from '../store/DashboardProvider';
import { Mark } from './Mark';

const KIND_LABEL: Readonly<Record<Alert['kind'], string>> = {
  item: 'Item',
  status: 'Device status',
  sensor_unavailable: 'Sensor unavailable',
  sensor_fault: 'Sensor fault',
  storage_fault: 'Storage',
  optional_fault: 'Optional hardware',
  door: 'Door',
};

/** Rows that only mean "the gas path has not settled yet" are expected, not faults. */
function isExpected(alert: Alert): boolean {
  return alert.kind === 'sensor_unavailable' && /warming up|capturing a baseline/i.test(alert.detail);
}

interface ConditionRowProps {
  readonly alert: Alert;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onAcknowledge: (key: string) => void;
  readonly onUnacknowledge: (key: string) => void;
}

const ConditionRow = memo(function ConditionRow({
  alert,
  pending,
  error,
  onAcknowledge,
  onUnacknowledge,
}: ConditionRowProps) {
  // Lane decides the semantic class, severity only the urgency. A LittleFS
  // fault and a dead sensor are both `severity: error`, but neither is a
  // verdict about food and neither may borrow the check_food square.
  const severity = conditionPresentation(alert);
  const expected = isExpected(alert);
  // An expected condition never wears an error treatment, whatever severity the
  // service attached to it.
  const tone = expected ? 'neutral' : severity.tone;
  const className = [
    'condition',
    alert.acknowledged ? 'condition--acked' : '',
    pending ? 'condition--pending' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={className} data-tone={tone}>
      <p className="condition__mark">
        <Mark shape={severity.shape} className="mark--sm" />
      </p>
      <div>
        <p className="condition__title">{alert.title}</p>
        <p className="condition__meta">
          <span className="chip chip--plain">{KIND_LABEL[alert.kind] ?? humaniseLabel(alert.kind)}</span>
          <span className="chip chip--plain">{severity.title}</span>
          {expected ? <span className="chip chip--plain">Expected</span> : null}
          {alert.uid === undefined ? null : (
            <span className="food-cell__uid" translate="no">
              {alert.uid}
            </span>
          )}
        </p>
        <p className="condition__detail">{alert.detail}</p>

        {alert.acknowledged ? (
          <p className="condition__ack">
            <span>Acknowledged</span>
            {alert.acknowledged_at === null ? null : (
              <span className="num">{dateTime(alert.acknowledged_at)}</span>
            )}
            {alert.acknowledged_by === null ? null : <span>by {alert.acknowledged_by}</span>}
            {alert.acknowledgement_note === null ? null : <span>“{alert.acknowledgement_note}”</span>}
          </p>
        ) : null}

        {error === undefined ? null : <p className="condition__error">{error}</p>}

        <p className="condition__actions">
          {alert.acknowledged ? (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => onUnacknowledge(alert.condition_key)}
              disabled={pending}
            >
              {pending ? 'Saving…' : 'Un-acknowledge'}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => onAcknowledge(alert.condition_key)} disabled={pending}>
              {pending ? 'Saving…' : 'Acknowledge'}
            </button>
          )}
          {pending ? (
            <span className="hint" role="status">
              Saving…
            </span>
          ) : null}
        </p>
      </div>
    </li>
  );
});

interface LaneGroupProps {
  readonly lane: Lane;
  readonly alerts: readonly Alert[];
  readonly pendingAcks: ReadonlySet<string>;
  readonly ackErrors: ReadonlyMap<string, string>;
  readonly onAcknowledge: (key: string) => void;
  readonly onUnacknowledge: (key: string) => void;
}

const LaneGroup = memo(function LaneGroup({
  lane,
  alerts,
  pendingAcks,
  ackErrors,
  onAcknowledge,
  onUnacknowledge,
}: LaneGroupProps) {
  const headingId = useId();
  return (
    <section className="lane" aria-labelledby={headingId}>
      <div className="lane__head">
        <h3 className="lane__title" id={headingId}>
          {lane.title}
        </h3>
        <span className="lane__count num">{alerts.length}</span>
        <p className="lane__blurb">{lane.blurb}</p>
      </div>
      <ul>
        {alerts.map((alert) => (
          <ConditionRow
            key={alert.condition_key}
            alert={alert}
            pending={pendingAcks.has(alert.condition_key)}
            error={ackErrors.get(alert.condition_key)}
            onAcknowledge={onAcknowledge}
            onUnacknowledge={onUnacknowledge}
          />
        ))}
      </ul>
    </section>
  );
});

export const ConditionsPanel = memo(function ConditionsPanel() {
  const { alerts, pendingAcks, ackErrors, ackName, snapshot } = useDashboard();
  const { acknowledge, unacknowledge, setAckName } = useDashboardActions();
  const nameFieldId = useId();

  const groups = groupAlerts(alerts);
  const unacknowledged = alerts.filter((alert) => !alert.acknowledged).length;

  return (
    <section className="panel" aria-labelledby="conditions-title">
      <div className="panel__head">
        <h2 className="panel__title" id="conditions-title">
          Conditions
        </h2>
        <p className="panel__sub">
          <span className="num">{alerts.length}</span> active
          {unacknowledged > 0 ? (
            <>
              {' · '}
              <span className="num">{unacknowledged}</span> unacknowledged
            </>
          ) : alerts.length > 0 ? (
            ' · all acknowledged'
          ) : (
            ' · nothing to report'
          )}
        </p>
      </div>

      <div className="ack-form">
        <label className="ack-form__label" htmlFor={nameFieldId}>
          Your name
        </label>
        <input
          id={nameFieldId}
          className="input"
          type="text"
          value={ackName}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          placeholder="optional"
          onChange={(event) => setAckName(event.target.value)}
          aria-describedby={`${nameFieldId}-hint`}
        />
        <p className="hint" id={`${nameFieldId}-hint`}>
          Recorded against anything you acknowledge. Leave it empty to acknowledge anonymously.
        </p>
      </div>

      {alerts.length === 0 ? (
        <div className="panel__body">
          <p className="note">
            Nothing is wrong that the device has reported. This is not a statement about the food&apos;s quality — it
            means no sensor, storage or status condition is active, and the verdict at the top of the page is the
            device&apos;s own.
          </p>
        </div>
      ) : (
        <div className="panel__body panel__body--flush">
          {groups.map((group) => (
            <LaneGroup
              key={group.lane.id}
              lane={group.lane}
              alerts={group.items}
              pendingAcks={pendingAcks}
              ackErrors={ackErrors}
              onAcknowledge={acknowledge}
              onUnacknowledge={unacknowledge}
            />
          ))}
        </div>
      )}

      <div className="panel__foot">
        <p className="hint">
          Acknowledging records that a person has seen a condition. It does not tell the device anything — the firmware
          has no acknowledgement path — and it never changes a verdict.
        </p>
        {snapshot === null ? null : (
          <p className="hint">
            Device is reporting <span className="num">{snapshot.counts.alerts_active}</span> condition
            {snapshot.counts.alerts_active === 1 ? '' : 's'}.
          </p>
        )}
      </div>
    </section>
  );
});
