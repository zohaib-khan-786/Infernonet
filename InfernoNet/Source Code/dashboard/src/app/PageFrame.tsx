/**
 * What every page shares: a heading, and the states a page can be in before it
 * has anything to say.
 *
 * THE FIVE STATES, AND WHY THEY ARE IN ONE PLACE
 * -----------------------------------------------------------------------------
 * Guide §36 asks for loading, empty, offline, error and stale on every page.
 * Four of the five are not per-page decisions — they are the same decision about
 * the same store, made once. If each page worked them out for itself, nine pages
 * would each invent an empty state and the tenth would forget the offline one,
 * and a reader would learn that an empty region sometimes means "loading" and
 * sometimes means "broken".
 *
 * `DeviceGate` therefore owns:
 *
 *   no device       the service has never received a snapshot. An invitation
 *                   with a checklist, because the cause is always one of five
 *                   things and they are checkable in order.
 *   device error    the service answered and said no. The service's own words,
 *                   its code and its request id, because that is the diagnosis.
 *   loading         one line, and a live region so it is announced once.
 *   clock untrusted the banner. Not a page state: the page still renders, and
 *                   the banner says the times below are withheld.
 *   link degraded   the banner, plus the short announcer. Again not a page
 *                   state — the page is showing the last data the service had.
 *
 * A page's own `data === null` case is then the only thing left to it, and that
 * is genuinely per-page: no devices at all, no readings in this window, no items.
 */
import { memo, type ReactNode } from 'react';
import { API_BASE } from '../api/client';
import { healthUrl } from '../api/endpoints';
import type { CurrentResponse } from '../api/types';
import type { EventsSlice, StreamState } from '../store/DashboardProvider';
import { useDashboard, useDashboardActions } from '../store/DashboardProvider';
import { Mark } from '../components/Mark';
import { ErrorNotice, LoadingLine } from '../components/Notices';
import { DeviceClockBanner, LinkNotice, MonitorAnnouncer } from '../components/Banners';
import { useFreshness } from '../lib/freshness';

export interface DeviceContext {
  readonly dev: string;
  readonly snapshot: CurrentResponse;
  readonly events: EventsSlice;
  readonly streamState: StreamState;
  readonly streamNote: string | null;
}

/** Shown when the service has no devices at all. An invitation, not an apology. */
export const NoDeviceState = memo(function NoDeviceState() {
  const { reloadDevices } = useDashboardActions();
  return (
    <div className="notice" data-tone="neutral">
      <Mark shape="circle" className="mark--lg" />
      <div>
        <h2 className="notice__title">No device has reported yet</h2>
        <div className="notice__body">
          <p>
            The service is running and has answered, but it has never received a snapshot from a device. A device
            appears here the moment its first snapshot is accepted, so there is nothing to configure on this page — the
            monitor itself has to report first.
          </p>
          <p>To check, in this order:</p>
          <ol>
            <li>
              The cabinet is powered and its Wi-Fi is up. The device prints its own state on the LCD and the LEDs.
            </li>
            <li>
              The device can reach this service. Its address is the one the backend is bound to, here{' '}
              <code className="num">{API_BASE}</code>.
            </li>
            <li>
              The ingest key on the device matches the one the backend was started with. A mismatch is rejected as{' '}
              <span className="num">forbidden</span> and nothing is stored.
            </li>
            <li>
              The service is healthy: <a href={healthUrl()}>{API_BASE}/healthz</a>.
            </li>
            <li>
              Without hardware, generate realistic data instead: in the <code className="num">backend/</code> folder,{' '}
              <code className="num">npm run mock</code>.
            </li>
          </ol>
        </div>
        <div className="notice__actions">
          <button type="button" className="btn" onClick={reloadDevices}>
            Check again
          </button>
        </div>
      </div>
    </div>
  );
});

/**
 * The page's own heading.
 *
 * An `h2`, never an `h1`: the shell's header already owns the `h1` and it names
 * the device every panel below is about. Two `h1`s in one document is not a
 * hierarchy, and a screen-reader user navigating by heading would be sent to the
 * device name twice.
 */
export function PageHeader({ title, lede }: { readonly title: string; readonly lede?: ReactNode }) {
  return (
    <div className="page-head">
      <h2 className="page-head__title">{title}</h2>
      {lede === undefined ? null : <p className="page-head__lede">{lede}</p>}
    </div>
  );
}

export interface DeviceGateProps {
  /**
   * Rendered after the loading/error states resolve but BEFORE the banners.
   *
   * The dashboard passes its status band here. §47 puts the critical verdict at
   * the top of the page and §39 puts diagnostics at the bottom, and the clock
   * and link banners belong between them — a volunteer needs "Check food" above
   * "the device clock is not trusted", not the other way round, because the first
   * one is the answer to "is the food safe" and the second is the reason some of
   * the timings are missing.
   */
  readonly lead?: ReactNode;
  readonly children: (context: DeviceContext) => ReactNode;
}

export function DeviceGate({ lead, children }: DeviceGateProps) {
  const { devices, devicesLoading, devicesError, dev, snapshot, currentError, events, streamState, streamNote } = useDashboard();
  const { reloadDevices, reloadCurrent } = useDashboardActions();
  // Measured once here and handed to the banner, the announcer and the panels
  // that print an age, so the header lamp, the banner and the card footers can
  // never tell three different stories about the same frame. See
  // `lib/freshness.ts`.
  const freshness = useFreshness(snapshot?.transport ?? null);

  return (
    <>
      {devicesError !== null ? (
        <ErrorNotice what="Loading the device list" error={devicesError} onRetry={reloadDevices} />
      ) : null}

      {devicesLoading && devices.length === 0 && devicesError === null ? (
        <LoadingLine>Asking the service which devices it knows…</LoadingLine>
      ) : null}

      {!devicesLoading && devicesError === null && devices.length === 0 ? <NoDeviceState /> : null}

      {dev === null ? null : currentError !== null ? (
        <ErrorNotice what={`Loading the current state of ${dev}`} error={currentError} onRetry={reloadCurrent} />
      ) : snapshot === null ? (
        <LoadingLine>Loading {dev}…</LoadingLine>
      ) : (
        <>
          {lead}
          {snapshot.device.time_valid ? null : <DeviceClockBanner />}
          <LinkNotice transport={snapshot.transport} stale={freshness.stale} streamState={streamState} streamNote={streamNote} />
          <MonitorAnnouncer
            clockTrusted={snapshot.device.time_valid}
            transport={snapshot.transport}
            stale={freshness.stale}
            streamState={streamState}
          />
          {children({ dev, snapshot, events, streamState, streamNote })}
        </>
      )}
    </>
  );
}
