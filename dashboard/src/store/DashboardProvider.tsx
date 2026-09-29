/**
 * The dashboard store.
 *
 * One provider, two contexts. The data context changes on every SSE snapshot;
 * the actions context is created once and never changes identity. A component
 * that only needs to acknowledge a condition therefore re-renders when it has
 * something to do, not five seconds after the device last reported.
 *
 * A `snapshot` frame *replaces* everything. It arrives on connect and after
 * every accepted ingest, and the backend builds it as a complete state, so
 * there is no merging to get wrong and no way for a stale field to survive.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { invalidate, invalidateAll } from '../api/client';
import { acknowledge, getCurrent, getEvents, listDevices, streamUrl, unacknowledge } from '../api/endpoints';
import type { Alert, CurrentResponse, DeviceEvent, DeviceListEntry } from '../api/types';
import type { ApiError } from '../api/client';
import { toApiError } from '../lib/useResource';
import { readParam, readStored, writeParams, writeStored } from '../lib/url';

const EVENTS_PAGE = 25;

/**
 * How the browser's connection to the service stands. This describes the link
 * and nothing else; it is never a food-safety verdict.
 */
export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'failed';

export interface EventsSlice {
  readonly items: readonly DeviceEvent[];
  readonly hasMore: boolean;
  readonly nextBefore: number | null;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: ApiError | null;
}

export interface DashboardState {
  readonly devices: readonly DeviceListEntry[];
  readonly devicesLoading: boolean;
  readonly devicesError: ApiError | null;
  /** The device currently shown, or null when none has reported yet. */
  readonly dev: string | null;
  /** True when a stored or linked device id is not in the device list. */
  readonly devMismatch: boolean;
  readonly snapshot: CurrentResponse | null;
  readonly currentLoading: boolean;
  readonly currentError: ApiError | null;
  /** Snapshot alerts with any in-flight acknowledgement applied. */
  readonly alerts: readonly Alert[];
  readonly ackErrors: ReadonlyMap<string, string>;
  readonly pendingAcks: ReadonlySet<string>;
  /** Optional name recorded against an acknowledgement. */
  readonly ackName: string;
  readonly events: EventsSlice;
  readonly streamState: StreamState;
  readonly streamNote: string | null;
}

export interface DashboardActions {
  readonly selectDevice: (dev: string) => void;
  readonly acknowledge: (conditionKey: string) => void;
  readonly unacknowledge: (conditionKey: string) => void;
  readonly setAckName: (name: string) => void;
  readonly loadMoreEvents: () => void;
  readonly reloadEvents: () => void;
  readonly reloadDevices: () => void;
  readonly reloadCurrent: () => void;
}

const StateContext = createContext<DashboardState | null>(null);
const ActionsContext = createContext<DashboardActions | null>(null);

const EMPTY_EVENTS: EventsSlice = {
  items: [],
  hasMore: false,
  nextBefore: null,
  loading: false,
  loadingMore: false,
  error: null,
};

export function DashboardProvider({ children }: { readonly children: ReactNode }) {
  // --- Device list ---------------------------------------------------------
  const [devices, setDevices] = useState<readonly DeviceListEntry[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<ApiError | null>(null);
  const [devicesNonce, setDevicesNonce] = useState(0);

  const reloadDevices = useCallback(() => {
    invalidate('/devices');
    setDevicesNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    setDevicesLoading(true);
    setDevicesError(null);
    listDevices().then(
      (response) => {
        if (!live) return;
        setDevices(response.devices);
        setDevicesLoading(false);
      },
      (cause: unknown) => {
        if (!live) return;
        setDevicesError(toApiError(cause));
        setDevicesLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [devicesNonce]);

  // --- Device selection ----------------------------------------------------
  // URL first, then the last choice, then whichever device exists.
  const [dev, setDev] = useState<string | null>(null);
  const [devMismatch, setDevMismatch] = useState(false);

  useEffect(() => {
    if (devicesLoading) return;
    if (devices.length === 0) {
      setDev(null);
      return;
    }
    const requested = readParam('device') ?? readStored('device');
    const match = requested === null ? undefined : devices.find((entry) => entry.dev === requested);
    setDevMismatch(requested !== null && match === undefined);
    setDev(match?.dev ?? devices[0].dev);
  }, [devices, devicesLoading]);

  const selectDevice = useCallback((next: string) => {
    setDev(next);
    writeStored('device', next);
    writeParams({ device: next });
    // A different device is a different world: nothing cached survives it.
    invalidateAll();
  }, []);

  // --- Snapshot ------------------------------------------------------------
  // `snapshotDev` is the device the snapshot belongs to, so a slow response for
  // a device we have since left can never be shown against the current one.
  const [snapshot, setSnapshot] = useState<CurrentResponse | null>(null);
  const [snapshotDev, setSnapshotDev] = useState<string | null>(null);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentError, setCurrentError] = useState<ApiError | null>(null);
  const [currentNonce, setCurrentNonce] = useState(0);

  const reloadCurrent = useCallback(() => {
    invalidate('/current');
    setCurrentNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (dev === null) {
      setSnapshot(null);
      setSnapshotDev(null);
      setCurrentLoading(false);
      return;
    }
    let live = true;
    setCurrentLoading(true);
    setCurrentError(null);
    getCurrent(dev).then(
      (next) => {
        if (!live) return;
        setSnapshot(next);
        setSnapshotDev(dev);
        setCurrentLoading(false);
      },
      (cause: unknown) => {
        if (!live) return;
        setSnapshot(null);
        setSnapshotDev(dev);
        setCurrentError(toApiError(cause));
        setCurrentLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [dev, currentNonce]);

  // --- Acknowledgement overlay --------------------------------------------
  // Optimistic local state, reconciled against the next snapshot. The device
  // knows nothing about acknowledgements, so this never leaves the browser
  // except as the write the backend records for the dashboard's own history.
  const [ackOverrides, setAckOverrides] = useState<ReadonlyMap<string, Partial<Alert>>>(new Map());
  const [ackErrors, setAckErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [pendingAcks, setPendingAcks] = useState<ReadonlySet<string>>(new Set());
  const [ackName, setAckNameState] = useState<string>(() => readStored('ackName') ?? '');

  const setAckName = useCallback((name: string) => {
    setAckNameState(name);
    writeStored('ackName', name.trim() === '' ? null : name.trim());
  }, []);

  const applySnapshot = useCallback((next: CurrentResponse) => {
    setSnapshot(next);
    setCurrentError(null);
    // Once the service's own state matches an in-flight override, drop the
    // override: from then on the rendered value is the server's, not a guess.
    setAckOverrides((previous) => {
      if (previous.size === 0) return previous;
      const nextOverrides = new Map(previous);
      for (const alert of next.alerts) {
        const override = previous.get(alert.condition_key);
        if (override && override.acknowledged === alert.acknowledged) {
          nextOverrides.delete(alert.condition_key);
        }
      }
      for (const key of previous.keys()) {
        if (!next.alerts.some((alert) => alert.condition_key === key)) nextOverrides.delete(key);
      }
      return nextOverrides.size === previous.size ? previous : nextOverrides;
    });
  }, []);

  const runAck = useCallback(
    (conditionKey: string, acknowledged: boolean) => {
      if (dev === null) return;
      setPendingAcks((previous) => new Set(previous).add(conditionKey));
      setAckErrors((previous) => {
        if (!previous.has(conditionKey)) return previous;
        const next = new Map(previous);
        next.delete(conditionKey);
        return next;
      });
      setAckOverrides((previous) => new Map(previous).set(conditionKey, { acknowledged }));

      const by = ackName.trim();
      const call = acknowledged
        ? acknowledge(dev, conditionKey, by === '' ? {} : { acknowledged_by: by })
        : unacknowledge(dev, conditionKey);

      call.then(
        (response) => {
          setPendingAcks((previous) => {
            if (!previous.has(conditionKey)) return previous;
            const next = new Set(previous);
            next.delete(conditionKey);
            return next;
          });
          setAckOverrides((previous) =>
            new Map(previous).set(conditionKey, {
              acknowledged: response.acknowledged,
              acknowledged_at: response.acknowledged_at ?? null,
            }),
          );
          invalidate('/current');
          invalidate('/alerts');
        },
        (cause: unknown) => {
          const error = toApiError(cause);
          setPendingAcks((previous) => {
            if (!previous.has(conditionKey)) return previous;
            const next = new Set(previous);
            next.delete(conditionKey);
            return next;
          });
          // Roll back to whatever the last snapshot said.
          setAckOverrides((previous) => {
            if (!previous.has(conditionKey)) return previous;
            const next = new Map(previous);
            next.delete(conditionKey);
            return next;
          });
          setAckErrors((previous) => new Map(previous).set(conditionKey, error.message));
        },
      );
    },
    [dev, ackName],
  );

  const acknowledgeCondition = useCallback((key: string) => runAck(key, true), [runAck]);
  const unacknowledgeCondition = useCallback((key: string) => runAck(key, false), [runAck]);

  // Condition keys are per-device; nothing carries over a device switch.
  useEffect(() => {
    setAckOverrides(new Map());
    setAckErrors(new Map());
    setPendingAcks(new Set());
  }, [dev]);

  const alerts = useMemo(() => {
    if (snapshot === null || snapshotDev !== dev) return [];
    if (ackOverrides.size === 0) return snapshot.alerts;
    return snapshot.alerts.map((alert) => {
      const override = ackOverrides.get(alert.condition_key);
      return override ? { ...alert, ...override } : alert;
    });
  }, [snapshot, snapshotDev, dev, ackOverrides]);

  // --- Event log -----------------------------------------------------------
  // Page one is requested in the same commit as /current, so the two requests
  // overlap rather than queueing behind each other.
  const [events, setEvents] = useState<EventsSlice>(EMPTY_EVENTS);
  const [eventsDev, setEventsDev] = useState<string | null>(null);
  const [loadMoreNonce, setLoadMoreNonce] = useState(0);
  const [eventsNonce, setEventsNonce] = useState(0);
  const cursor = useRef<number | null>(null);

  const loadMoreEvents = useCallback(() => setLoadMoreNonce((value) => value + 1), []);
  const reloadEvents = useCallback(() => {
    invalidate('/events');
    setEventsNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (dev === null) {
      setEvents(EMPTY_EVENTS);
      setEventsDev(null);
      return;
    }
    let live = true;
    cursor.current = null;
    setEvents({ ...EMPTY_EVENTS, loading: true });
    setEventsDev(dev);
    getEvents(dev, { limit: EVENTS_PAGE }).then(
      (response) => {
        if (!live) return;
        cursor.current = response.next_before;
        setEvents({
          items: response.events,
          hasMore: response.has_more,
          nextBefore: response.next_before,
          loading: false,
          loadingMore: false,
          error: null,
        });
      },
      (cause: unknown) => {
        if (!live) return;
        setEvents({ ...EMPTY_EVENTS, error: toApiError(cause) });
      },
    );
    return () => {
      live = false;
    };
  }, [dev, eventsNonce]);

  useEffect(() => {
    if (dev === null || eventsDev !== dev || loadMoreNonce === 0) return;
    const before = cursor.current;
    if (before === null) return;
    let live = true;
    setEvents((previous) => ({ ...previous, loadingMore: true, error: null }));
    getEvents(dev, { limit: EVENTS_PAGE, before }, { ttlMs: 0 }).then(
      (response) => {
        if (!live) return;
        cursor.current = response.next_before;
        setEvents((previous) => ({
          ...previous,
          items: [...previous.items, ...response.events],
          hasMore: response.has_more,
          nextBefore: response.next_before,
          loadingMore: false,
        }));
      },
      (cause: unknown) => {
        if (!live) return;
        setEvents((previous) => ({ ...previous, loadingMore: false, error: toApiError(cause) }));
      },
    );
    return () => {
      live = false;
    };
  }, [dev, eventsDev, loadMoreNonce]);

  // --- Live feed -----------------------------------------------------------
  // Native EventSource, native reconnect, native Last-Event-ID. No hand-rolled
  // retry loop: the browser already has a correct one and the service advertises
  // `retry: 3000`.
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [streamNote, setStreamNote] = useState<string | null>(null);
  const applySnapshotRef = useRef(applySnapshot);
  applySnapshotRef.current = applySnapshot;

  useEffect(() => {
    if (dev === null) {
      setStreamState('connecting');
      setStreamNote(null);
      return;
    }
    const source = new EventSource(streamUrl(dev));
    setStreamState('connecting');
    setStreamNote(null);

    source.addEventListener('open', () => {
      setStreamState('live');
      setStreamNote(null);
    });

    source.addEventListener('snapshot', (event) => {
      try {
        applySnapshotRef.current(JSON.parse((event as MessageEvent<string>).data) as CurrentResponse);
        setStreamState('live');
        setStreamNote(null);
      } catch {
        setStreamState('live');
        setStreamNote('A live update arrived that could not be read. The next update replaces it.');
      }
    });

    // `resync` means the replay buffer was exceeded, which the service always
    // follows with a full snapshot. The correct response is to do nothing.
    source.addEventListener('resync', () => {
      setStreamState('live');
      setStreamNote('Live updates were replayed from a fresh snapshot after reconnecting.');
    });

    // A named `error` frame is the service refusing the connection outright
    // (an unknown device id, say). The built-in error event is different and
    // is handled below.
    source.addEventListener('error', (event) => {
      const data = (event as MessageEvent<string>).data;
      if (typeof data !== 'string' || data === '') return;
      try {
        const parsed = JSON.parse(data) as { code: string; message: string };
        setStreamState('failed');
        setStreamNote(`${parsed.message} (${parsed.code})`);
      } catch {
        setStreamState('failed');
        setStreamNote('The service rejected the live connection.');
      }
    });

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        setStreamState('failed');
        setStreamNote('The live connection closed. Reload the page to try again.');
      } else {
        setStreamState('reconnecting');
        setStreamNote('Reconnecting to the live feed. Everything below is the last data received.');
      }
    };

    return () => source.close();
  }, [dev]);

  // --- Assembled value -----------------------------------------------------
  const state = useMemo<DashboardState>(
    () => ({
      devices,
      devicesLoading,
      devicesError,
      dev,
      devMismatch,
      snapshot: snapshotDev === dev ? snapshot : null,
      currentLoading: dev !== null && snapshotDev !== dev && currentLoading,
      currentError,
      alerts,
      ackErrors,
      pendingAcks,
      ackName,
      events: eventsDev === dev ? events : EMPTY_EVENTS,
      streamState,
      streamNote,
    }),
    [
      devices,
      devicesLoading,
      devicesError,
      dev,
      devMismatch,
      snapshot,
      snapshotDev,
      currentLoading,
      currentError,
      alerts,
      ackErrors,
      pendingAcks,
      ackName,
      events,
      eventsDev,
      streamState,
      streamNote,
    ],
  );

  const actions = useMemo<DashboardActions>(
    () => ({
      selectDevice,
      acknowledge: acknowledgeCondition,
      unacknowledge: unacknowledgeCondition,
      setAckName,
      loadMoreEvents,
      reloadEvents,
      reloadDevices,
      reloadCurrent,
    }),
    [selectDevice, acknowledgeCondition, unacknowledgeCondition, setAckName, loadMoreEvents, reloadEvents, reloadDevices, reloadCurrent],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useDashboard(): DashboardState {
  const value = useContext(StateContext);
  if (value === null) throw new Error('useDashboard must be used inside <DashboardProvider>');
  return value;
}

export function useDashboardActions(): DashboardActions {
  const value = useContext(ActionsContext);
  if (value === null) throw new Error('useDashboardActions must be used inside <DashboardProvider>');
  return value;
}
