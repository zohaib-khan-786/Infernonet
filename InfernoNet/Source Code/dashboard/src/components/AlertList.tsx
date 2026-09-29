/**
 * The alert list (guide §14).
 *
 * §14 wants severity, title, explanation, timestamp, device, current value,
 * threshold and an action on every row. Five of the eight are fields the service
 * sends. The other three are handled rather than filled in:
 *
 *   current value / threshold    read from the live snapshot for the measurement
 *                               the condition's key names, and shown only when
 *                               the key names one. For a whole-zone condition the
 *                               backend says in its own words that the threshold
 *                               is not transmitted, so nothing is claimed.
 *   timestamp                   the snapshot's receipt time is shown, labelled as
 *                               the time the service received the snapshot rather
 *                               than as when the condition started — which the
 *                               service does not record. See `lib/conditions`.
 *
 * Every row is a button that opens the detail (§15), because a list of eleven
 * sentences with an Acknowledge button is not a list anybody can act on.
 */
import { memo, useMemo } from 'react';
import type { Alert, ReadingBlock, Thresholds } from '../api/types';
import { humaniseLabel, number } from '../lib/format';
import { conditionFacts } from '../lib/conditions';
import { conditionPresentation, groupAlerts, type Lane } from '../lib/status';
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

/** §14: rows that only mean the gas path has not settled are expected, not faults. */
function isExpected(alert: Alert): boolean {
  return alert.kind === 'sensor_unavailable' && /warming up|capturing a baseline/i.test(alert.detail);
}

export type AckFilter = 'all' | 'unacknowledged' | 'acknowledged';
export type SeverityFilter = 'all' | 'error' | 'warning' | 'info';

interface RowProps {
  readonly alert: Alert;
  readonly dev: string;
  readonly readings: ReadingBlock | null;
  readonly thresholds: Thresholds | null;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onAcknowledge: (key: string) => void;
  readonly onUnacknowledge: (key: string) => void;
  readonly onOpen: (alert: Alert) => void;
  readonly open: boolean;
}

const AlertRow = memo(function AlertRow({
  alert,
  dev,
  readings,
  thresholds,
  pending,
  error,
  onAcknowledge,
  onUnacknowledge,
  onOpen,
  open,
}: RowProps) {
  const severity = conditionPresentation(alert);
  const expected = isExpected(alert);
  const tone = expected ? 'neutral' : severity.tone;
  const facts = useMemo(() => conditionFacts(alert, readings, thresholds), [alert, readings, thresholds]);

  return (
    <li className={`condition${alert.acknowledged ? ' condition--acked' : ''}${pending ? ' condition--pending' : ''}`} data-tone={tone}>
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
          <span className="chip chip--plain" translate="no">
            {dev}
          </span>
        </p>
        <p className="condition__detail">{alert.detail}</p>

        <p className="condition__facts">
          <span className="condition__fact">
            <span className="condition__fact-label">Current value</span>
            {facts.metric === null ? (
              <span className="withheld__value">not transmitted</span>
            ) : facts.value === null ? (
              <span className="withheld__value">not reported</span>
            ) : (
              <span className="num">
                {number(facts.value.value, facts.metric.digits)} {facts.metric.unit}
              </span>
            )}
          </span>
          <span className="condition__fact">
            <span className="condition__fact-label">Limit</span>
            {facts.band === null ? (
              <span className="withheld__value">
                {facts.metric === null ? 'not transmitted' : 'none configured'}
              </span>
            ) : (
              <span className="num">
                {number(facts.band.min, facts.metric?.digits ?? 1)} to {number(facts.band.max, facts.metric?.digits ?? 1)}{' '}
                {facts.metric?.unit ?? ''}
              </span>
            )}
          </span>
          <span className="condition__fact">
            <span className="condition__fact-label">Started</span>
            <span className="withheld__value">not recorded</span>
          </span>
        </p>

        {alert.acknowledged ? (
          <p className="condition__ack">
            <span>Acknowledged</span>
            {alert.acknowledged_by === null ? null : <span>by {alert.acknowledged_by}</span>}
            {alert.acknowledgement_note === null ? null : <span>“{alert.acknowledgement_note}”</span>}
          </p>
        ) : null}

        {error === undefined ? null : <p className="condition__error">{error}</p>}

        <p className="condition__actions">
          <button type="button" className="btn" onClick={() => onOpen(alert)} aria-expanded={open}>
            View details
          </button>
          {alert.acknowledged ? (
            <button type="button" className="btn btn--quiet" onClick={() => onUnacknowledge(alert.condition_key)} disabled={pending}>
              {pending ? 'Saving…' : 'Un-acknowledge'}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => onAcknowledge(alert.condition_key)} disabled={pending}>
              {pending ? 'Saving…' : 'Acknowledge'}
            </button>
          )}
        </p>
      </div>
    </li>
  );
});

function LaneGroup({
  lane,
  alerts,
  dev,
  readings,
  thresholds,
  pendingAcks,
  ackErrors,
  onAcknowledge,
  onUnacknowledge,
  onOpen,
  openKey,
}: {
  readonly lane: Lane;
  readonly alerts: readonly Alert[];
  readonly dev: string;
  readonly readings: ReadingBlock | null;
  readonly thresholds: Thresholds | null;
  readonly pendingAcks: ReadonlySet<string>;
  readonly ackErrors: ReadonlyMap<string, string>;
  readonly onAcknowledge: (key: string) => void;
  readonly onUnacknowledge: (key: string) => void;
  readonly onOpen: (alert: Alert) => void;
  readonly openKey: string | null;
}) {
  return (
    <section className="lane" aria-label={`${lane.title}: ${alerts.length}`}>
      <div className="lane__head">
        <h3 className="lane__title">{lane.title}</h3>
        <span className="lane__count num">{alerts.length}</span>
        <p className="lane__blurb">{lane.blurb}</p>
      </div>
      <ul>
        {alerts.map((alert) => (
          <AlertRow
            key={alert.condition_key}
            alert={alert}
            dev={dev}
            readings={readings}
            thresholds={thresholds}
            pending={pendingAcks.has(alert.condition_key)}
            error={ackErrors.get(alert.condition_key)}
            onAcknowledge={onAcknowledge}
            onUnacknowledge={onUnacknowledge}
            onOpen={onOpen}
            open={openKey === alert.condition_key}
          />
        ))}
      </ul>
    </section>
  );
}

export interface AlertListProps {
  readonly dev: string;
  readonly alerts: readonly Alert[];
  readonly readings: ReadingBlock | null;
  readonly thresholds: Thresholds | null;
  readonly pendingAcks: ReadonlySet<string>;
  readonly ackErrors: ReadonlyMap<string, string>;
  readonly onAcknowledge: (key: string) => void;
  readonly onUnacknowledge: (key: string) => void;
  readonly onOpen: (alert: Alert) => void;
  readonly openKey: string | null;
  readonly query: string;
  readonly ackFilter: AckFilter;
  readonly severityFilter: SeverityFilter;
}

export const AlertList = memo(function AlertList({
  dev,
  alerts,
  readings,
  thresholds,
  pendingAcks,
  ackErrors,
  onAcknowledge,
  onUnacknowledge,
  onOpen,
  openKey,
  query,
  ackFilter,
  severityFilter,
}: AlertListProps) {
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return alerts.filter((alert) => {
      if (severityFilter !== 'all' && alert.severity !== severityFilter) return false;
      if (ackFilter === 'unacknowledged' && alert.acknowledged) return false;
      if (ackFilter === 'acknowledged' && !alert.acknowledged) return false;
      if (needle === '') return true;
      return `${alert.title} ${alert.detail} ${alert.condition_key}`.toLowerCase().includes(needle);
    });
  }, [alerts, query, ackFilter, severityFilter]);

  if (alerts.length === 0) {
    return (
      <p className="note">
        No conditions are active. This is not a statement about the food&apos;s quality — it means no sensor, storage,
        status or item condition is raised, and the verdict at the top of the dashboard is the device&apos;s own.
      </p>
    );
  }

  if (filtered.length === 0) {
    return (
      <p className="note">
        No condition matches these filters. There {alerts.length === 1 ? 'is 1 active condition' : `are ${alerts.length} active conditions`},
        none of which matches.
      </p>
    );
  }

  return (
    <>
      {groupAlerts(filtered).map((group) => (
        <LaneGroup
          key={group.lane.id}
          lane={group.lane}
          alerts={group.items}
          dev={dev}
          readings={readings}
          thresholds={thresholds}
          pendingAcks={pendingAcks}
          ackErrors={ackErrors}
          onAcknowledge={onAcknowledge}
          onUnacknowledge={onUnacknowledge}
          onOpen={onOpen}
          openKey={openKey}
        />
      ))}
    </>
  );
});

/** The filter bar. Kept here so the list and its controls cannot drift apart. */
export function AlertFilters({
  query,
  onQuery,
  ackFilter,
  onAckFilter,
  severityFilter,
  onSeverityFilter,
  onReset,
}: {
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly ackFilter: AckFilter;
  readonly onAckFilter: (value: AckFilter) => void;
  readonly severityFilter: SeverityFilter;
  readonly onSeverityFilter: (value: SeverityFilter) => void;
  readonly onReset: () => void;
}) {
  return (
    <div className="filter-bar">
      <div className="field filter-bar__search">
        <label className="field__label" htmlFor="alert-search">
          Search conditions
        </label>
        <input
          id="alert-search"
          className="input"
          type="search"
          value={query}
          placeholder="Search title, detail or key…"
          autoComplete="off"
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <div className="chip-group" role="group" aria-label="Severity">
        {(['all', 'error', 'warning', 'info'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="chip chip--plain"
            aria-pressed={severityFilter === option}
            onClick={() => onSeverityFilter(option)}
          >
            {option === 'all' ? 'Every severity' : `${option} · ${option === 'error' ? 'needs action' : option === 'warning' ? 'watch' : 'information'}`}
          </button>
        ))}
      </div>
      <div className="chip-group" role="group" aria-label="Acknowledgement">
        {(['all', 'unacknowledged', 'acknowledged'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="chip chip--plain"
            aria-pressed={ackFilter === option}
            onClick={() => onAckFilter(option)}
          >
            {option === 'all' ? 'All' : option === 'unacknowledged' ? 'Needs acknowledging' : 'Acknowledged'}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn--quiet" onClick={onReset}>
        Reset filters
      </button>
    </div>
  );
}
