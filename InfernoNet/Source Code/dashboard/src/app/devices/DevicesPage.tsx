/**
 * Devices (guide §32).
 *
 * §32 asks for a nine-column table: Device ID, Name, Type, Location, Status,
 * Firmware, Last Seen, Health, Actions â€” and a device detail with Rename, Assign
 * location, Update configuration, Restart, Disable and Remove.
 *
 * The service returns a device block with no name, no type and no location. Those
 * three columns read "not reported" and the reason is stated once, because
 * "not reported" without a reason reads as a field somebody left to fill in, and
 * a Name column that is always empty invites somebody to type into it.
 *
 * The Actions column is the more interesting decision. All six of §32's actions
 * are real capabilities that do not exist here: the service has no rename, no
 * location, no configuration, no restart, no disable and no delete route, and
 * there is no identity system to record who did it. A row of six buttons â€” five
 * of them permanently disabled â€” would be a page that advertises device
 * administration and cannot do any of it. So the column says the route does not
 * exist, and lists which of §32's actions are therefore unavailable. §46.8's
 * confirmation requirement is noted against the three that would be dangerous if
 * they existed, so the requirement is not lost.
 *
 * Health is a real summary, built only from fields the service sends: the
 * verdict, the two fault masks, the queue depth, the latched-sample count, the
 * clock trust and the link age. It is a statement about what the device has
 * reported, and it is labelled as such rather than being called "healthy".
 */
import { useMemo } from 'react';
import type { DeviceListEntry } from '../../api/types';
import { PageHeader } from '../PageFrame';
import { StatusChip } from '../../components/StatusChip';
import { Mark } from '../../components/Mark';
import { ErrorNotice, LoadingLine } from '../../components/Notices';
import { ago, dateTime, humaniseLabel, number, span } from '../../lib/format';
import { useDashboard, useDashboardActions } from '../../store/DashboardProvider';
import { routeHref } from '../useRoute';

interface Health {
  readonly tone: 'ok' | 'warn' | 'unknown';
  readonly word: string;
  readonly why: string;
}

/**
 * A summary of what the device reported, not a verdict of our own.
 *
 * The word is chosen from the device's own fields and the sentence underneath
 * says which field produced it, so a reader can check the summary against the
 * table row it came from. A column that said "Healthy" with a green lamp and no
 * evidence would be a second opinion, and the fault map is the device's.
 */
function healthOf(entry: DeviceListEntry): Health {
  const unavailable = entry.unavailable.length;
  const confirmed = entry.confirmed_faults.length;
  if (entry.transport.stale) {
    return { tone: 'unknown', word: 'Not reporting', why: `The service calls a device stale after ${number(entry.transport.stale_after_seconds, 0)} s and the last accepted snapshot is ${ago(entry.transport.age_seconds)}.` };
  }
  if (unavailable > 0 || confirmed > 0) {
    return {
      tone: 'unknown',
      word: 'Faults reported',
      why: `${number(unavailable, 0)} availability bit${unavailable === 1 ? '' : 's'} and ${number(confirmed, 0)} confirmed fault${confirmed === 1 ? '' : 's'} are set in the latest snapshot.`,
    };
  }
  if (!entry.time_valid) {
    return { tone: 'warn', word: 'Clock not trusted', why: 'No fault bit is set, but the device clock is untrusted, so the service withholds every storage duration.' };
  }
  if (entry.pending_count !== null && entry.pending_count > 0) {
    return {
      tone: 'warn',
      word: 'Queue draining',
      why: `No fault bit is set, but ${number(entry.pending_count, 0)} sample${entry.pending_count === 1 ? '' : 's'} are queued on the device awaiting server acknowledgement.`,
    };
  }
  if (!entry.full_snapshot) {
    return { tone: 'warn', word: 'Partial snapshot', why: 'No fault bit is set, but the last snapshot was partial, so any change to the food list arrived earlier than the rest of it.' };
  }
  return { tone: 'ok', word: 'Reporting', why: 'Every fault bit is clear, the clock is trusted and the last snapshot was complete.' };
}

function DeviceRow({ entry, selected }: { readonly entry: DeviceListEntry; readonly selected: boolean }) {
  const health = healthOf(entry);
  return (
    <tr>
      <th scope="row" className="cell-head">
        <span className="food-cell">
          <span className="food-cell__name" translate="no">
            {entry.dev}
          </span>
          {selected ? <span className="chip chip--plain">selected</span> : null}
        </span>
      </th>
      <td>
        <span className="part-cell__na">not reported</span>
        <span className="food-cell__meta">the device sends no name</span>
      </td>
      <td>
        <span className="part-cell__na">not reported</span>
        <span className="food-cell__meta">contract v{number(entry.contract_version, 0)}</span>
      </td>
      <td>
        <span className="part-cell__na">not reported</span>
        <span className="food-cell__meta">no location field exists</span>
      </td>
      <td>
        <StatusChip status={entry.overall_status} />
        <span className="food-cell__meta">zone {entry.zone_status.label}</span>
      </td>
      <td>{entry.firmware ?? <span className="part-cell__na">not reported</span>}</td>
      <td className="cell-num">
        {ago(entry.transport.age_seconds)}
        <span className="food-cell__meta">{dateTime(entry.transport.last_received_at)}</span>
        <span className="food-cell__meta">{entry.transport.stale ? 'stale' : 'within threshold'}</span>
      </td>
      <td>
        <span className="chip" data-tone={health.tone}>
          <Mark shape={health.tone === 'ok' ? 'circle' : health.tone === 'warn' ? 'triangle' : 'hatched-diamond'} className="mark--sm" />
          {health.word}
        </span>
        <span className="food-cell__meta">{health.why}</span>
      </td>
      <td>
        <span className="part-cell__na">no management route</span>
        <span className="food-cell__meta">
          Rename, assign location, update configuration, restart, disable and remove are all unavailable.
        </span>
      </td>
    </tr>
  );
}

export default function DevicesPage() {
  const { devices, devicesLoading, devicesError, dev } = useDashboard();
  const { reloadDevices, selectDevice } = useDashboardActions();

  const totals = useMemo(
    () => ({
      reporting: devices.filter((entry) => !entry.transport.stale).length,
      stale: devices.filter((entry) => entry.transport.stale).length,
      faults: devices.reduce((sum, entry) => sum + entry.unavailable.length + entry.confirmed_faults.length, 0),
    }),
    [devices],
  );

  return (
    <>
      <PageHeader
        title="Devices"
        lede="Every device the service has received a snapshot from, and every field it actually reports. Columns the service does not send read as not reported, with the reason beside them."
      />

      {/*
        Deliberately NOT behind `DeviceGate`. That gate exists for pages about
        one device, and it renders the no-device invitation; on this page the
        empty state is the whole subject, so it is the table's own and putting
        both on screen at once would say the same thing twice. The per-device
        link state that the gate's banners would carry is already a column in
        the table below.
      */}
      {devicesError !== null ? (
        <ErrorNotice what="Loading the device list" error={devicesError} onRetry={reloadDevices} />
      ) : devicesLoading && devices.length === 0 ? (
        <LoadingLine>Asking the service which devices it knowsâ€¦</LoadingLine>
      ) : null}

      {devices.length > 0 ? (
        <div className="panel__foot panel__foot--bare">
          <p className="status-band__stat">
            <span className="status-band__stat-value num">{number(devices.length, 0)}</span>
            <span>known</span>
          </p>
          <p className="status-band__stat">
            <span className="status-band__stat-value num">{number(totals.reporting, 0)}</span>
            <span>reporting</span>
          </p>
          <p className="status-band__stat">
            <span className="status-band__stat-value num">{number(totals.stale, 0)}</span>
            <span>quiet</span>
          </p>
          <p className="status-band__stat">
            <span className="status-band__stat-value num">{number(totals.faults, 0)}</span>
            <span>fault bits set across all of them</span>
          </p>
          <button type="button" className="btn btn--quiet" onClick={reloadDevices}>
            Refresh
          </button>
          {devicesLoading ? <span className="hint">Refreshingâ€¦</span> : null}
        </div>
      ) : null}

      <section className="panel" aria-labelledby="devices-title">
            <div className="panel__head">
              <h2 className="panel__title" id="devices-title">
                Device table
              </h2>
              <p className="panel__sub">
                {devices.length === 0 ? 'No device has reported yet' : `${devices.length} device${devices.length === 1 ? '' : 's'}`}
              </p>
            </div>

            {devices.length === 0 ? (
              <div className="panel__body">
                <p className="note">
                  A device appears here the moment the service accepts its first snapshot. Nothing here can be created by
                  hand: there is no register route, because a device that has never reported has nothing to record
                  about it.
                </p>
              </div>
            ) : (
              <div className="panel__body panel__body--flush">
                <div className="food-table-scroll" tabIndex={0} role="region" aria-label="Device table">
                  <table className="data-table">
                    <caption className="visually-hidden">
                      Every device the service knows, with the fields it reports. Name, type, location and the action
                      column are shown as not reported because the service sends no such fields and has no route to
                      change them.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Device ID</th>
                        <th scope="col">Name</th>
                        <th scope="col">Type</th>
                        <th scope="col">Location</th>
                        <th scope="col">Status</th>
                        <th scope="col">Firmware</th>
                        <th scope="col" className="cell-num">
                          Last seen
                        </th>
                        <th scope="col">Health</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices.map((entry) => (
                        <DeviceRow key={entry.dev} entry={entry} selected={entry.dev === dev} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="panel__foot">
              <p className="hint">
                Selecting a device changes every page, so it is done in the header rather than per row. The row marked
                &quot;selected&quot; is the one every panel below the header is about.
              </p>
              {devices.length > 1 ? (
                <button type="button" className="btn btn--quiet" onClick={() => selectDevice(devices[0]?.dev ?? '')} disabled={devices[0]?.dev === dev}>
                  Use the first device
                </button>
              ) : null}
            </div>
          </section>

          <section className="panel" aria-labelledby="devices-detail-title">
            <div className="panel__head">
              <h2 className="panel__title" id="devices-detail-title">
                Identity, connectivity and counters
              </h2>
              <p className="panel__sub">
                §32&apos;s detail sections, limited to the fields the device block carries
              </p>
            </div>
            <div className="panel__body panel__body--flush">
              {devices.map((entry) => (
                <section className="device-detail" key={entry.dev}>
                  <h3 className="device-detail__name" translate="no">
                    {entry.dev}
                  </h3>
                  <div className="facts">
                    <div className="fact">
                      <span className="fact__label">Contract</span>
                      <span className="fact__value">v{number(entry.contract_version, 0)}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Firmware</span>
                      <span className="fact__value">{entry.firmware ?? 'not reported'}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">First seen</span>
                      <span className="fact__value">{dateTime(entry.first_seen_at)}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Last ingest</span>
                      <span className="fact__value">{dateTime(entry.last_ingest_at)}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Reported at</span>
                      <span className="fact__value">
                        {entry.time_valid ? dateTime(entry.reported_at) : 'device clock not trusted'}
                      </span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Uptime</span>
                      <span className="fact__value">{span(entry.uptime_s)}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Boots</span>
                      <span className="fact__value">{number(entry.boot_count, 0)}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Sequence</span>
                      <span className="fact__value">{number(entry.seq, 0)}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Samples latched</span>
                      <span className="fact__value">
                        {entry.consecutive_samples === null ? 'not reported' : number(entry.consecutive_samples, 0)}
                      </span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Queue pending</span>
                      <span className="fact__value">
                        {entry.pending_count === null ? 'not reported' : number(entry.pending_count, 0)}
                      </span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Inventory revision</span>
                      <span className="fact__value">{number(entry.inv_revision, 0)}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Last snapshot</span>
                      <span className="fact__value">{entry.full_snapshot ? 'complete' : 'partial'}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Availability bits</span>
                      <span className="fact__value">
                        {entry.unavailable.length === 0
                          ? 'none set'
                          : entry.unavailable.map((bit) => `${bit.name} (bit ${number(bit.bit, 0)})`).join(', ')}
                      </span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Confirmed faults</span>
                      <span className="fact__value">
                        {entry.confirmed_faults.length === 0
                          ? 'none set'
                          : entry.confirmed_faults.map((bit) => `${bit.name} (${bit.class})`).join(', ')}
                      </span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Gas path</span>
                      <span className="fact__value">{humaniseLabel(String(entry.gas.state))}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Door</span>
                      <span className="fact__value">
                        {entry.door.stale ? 'unknown â€” the reed input is not reporting' : entry.door.open ? 'open' : 'closed'}
                      </span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Inventory</span>
                      <span className="fact__value">
                        {number(entry.counts.inventory_active, 0)} active · {number(entry.counts.inventory_retired, 0)} retired
                      </span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Events on file</span>
                      <span className="fact__value">{number(entry.counts.events, 0)}</span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Thresholds in force</span>
                      <span className="fact__value">
                        {entry.thresholds === null ? 'no configuration block sent' : 'the device sent its own limits'}
                      </span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Provenance</span>
                      <span className="fact__value">
                        {entry.provenance === null
                          ? 'not reported'
                          : `${entry.provenance.source}${entry.provenance.note === null ? '' : ` â€” ${entry.provenance.note}`}`}
                      </span>
                    </div>
                    <div className="fact">
                      <span className="fact__label">Link state</span>
                      <span className="fact__value">
                        {entry.transport.stale ? 'stale' : 'within threshold'} · {ago(entry.transport.age_seconds)}
                        <span className="withheld__note">{entry.transport.note}</span>
                      </span>
                    </div>
                  </div>
                </section>
              ))}
            </div>
            <div className="panel__foot">
              <p className="hint">
                §32&apos;s maintenance actions are not rendered. The service exposes no rename, location, configuration,
                restart, disable or remove route, and there is no identity system to record who performed one. Restart,
                disable and remove would additionally need the confirmation guide §46.8 requires, and an empty row of
                disabled buttons would say the capability exists and is one click away.
              </p>
              <a className="btn btn--quiet" href={routeHref('thresholds')}>
                Thresholds for the selected device
              </a>
            </div>
          </section>
    </>
  );
}
