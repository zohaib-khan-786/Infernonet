/**
 * Masthead: identity, the device switch, and the link indicator.
 *
 * The link indicator is here, in the bezel, and it is deliberately the least
 * colourful thing on the page. It is grey unless data is arriving, it never
 * turns red, and the `transport` note from the service is one click away. A
 * volunteer must never read a dropped connection as a food-safety warning.
 */
import { memo } from 'react';
import { useDashboard, useDashboardActions } from '../store/DashboardProvider';
import { ago } from '../lib/format';

type LinkLevel = 'live' | 'waiting' | 'connecting' | 'down';

function useLinkPresentation(): { level: LinkLevel; text: string; detail: string; title: string } {
  const { streamState, streamNote, snapshot } = useDashboard();
  const transport = snapshot?.transport ?? null;

  if (streamState === 'failed') {
    return { level: 'down', text: 'Live feed off', detail: '', title: streamNote ?? 'The live connection failed.' };
  }
  if (streamState === 'reconnecting') {
    return {
      level: 'down',
      text: 'Reconnecting',
      detail: '',
      title: streamNote ?? 'The browser is retrying the live connection on its own.',
    };
  }
  if (transport === null) {
    return {
      level: streamState === 'live' ? 'live' : 'connecting',
      text: streamState === 'live' ? 'Live' : 'Connecting',
      detail: '',
      title: 'No link information yet.',
    };
  }
  if (transport.stale) {
    return {
      level: 'waiting',
      text: 'No new data',
      detail: ago(transport.age_seconds),
      title: `The service last accepted a snapshot ${ago(transport.age_seconds)}. Stale after ${transport.stale_after_seconds} s.`,
    };
  }
  return {
    level: streamState === 'live' ? 'live' : 'connecting',
    text: streamState === 'live' ? 'Live' : 'Connecting',
    detail: ago(transport.age_seconds),
    title: `Last accepted snapshot ${ago(transport.age_seconds)}.`,
  };
}

export const LinkStatus = memo(function LinkStatus() {
  const { level, text, detail, title } = useLinkPresentation();
  return (
    <span className="link-state" data-link={level} title={title}>
      <span className="link-state__dot" aria-hidden="true" />
      <span>
        Live feed: {text}
        {detail === '' ? null : <span className="link-state__detail"> · {detail}</span>}
      </span>
    </span>
  );
});

export const Masthead = memo(function Masthead() {
  const { devices, dev, devicesLoading, devMismatch, snapshot } = useDashboard();
  const { selectDevice, reloadCurrent } = useDashboardActions();

  const showPicker = devices.length > 1;
  const deviceName = snapshot?.device.dev ?? dev;

  return (
    <header className="masthead on-dark">
      <div className="masthead__inner">
        <div className="masthead__identity">
          <h1 className="masthead__mark">FreshGuard</h1>
          {deviceName === null || deviceName === undefined ? (
            <span className="masthead__device masthead__device-empty">no device has reported</span>
          ) : (
            <span className="masthead__device" translate="no">
              {deviceName}
            </span>
          )}
        </div>

        <div className="masthead__tools">
          {showPicker ? (
            <div className="masthead__switch">
              <label className="label" htmlFor="device-select">
                Device
              </label>
              <select
                id="device-select"
                className="input"
                value={dev ?? ''}
                onChange={(event) => selectDevice(event.target.value)}
                autoComplete="off"
              >
                {devices.map((entry) => (
                  <option key={entry.dev} value={entry.dev}>
                    {entry.dev}
                    {entry.transport.stale ? ' (no new data)' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <LinkStatus />

          <button type="button" className="btn btn--quiet" onClick={reloadCurrent} disabled={dev === null}>
            Reload
          </button>
        </div>

        {devicesLoading ? null : devMismatch ? (
          <p className="masthead__notice">
            The device id in the link is not one this service knows about, so the first device it does know is shown.
          </p>
        ) : null}
      </div>
    </header>
  );
});
