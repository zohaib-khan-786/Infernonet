/**
 * Thresholds and audit trail (guide §30, §31).
 *
 * §30 is an administrator page over one real thing: the eight limits the device
 * applies. That form already exists â€” `ThresholdsPanel`, built when there was one
 * page and used on the dashboard's rail â€” and it is reused here rather than
 * copied, because a second copy of a form that rewrites food-safety limits is the
 * worst kind of duplication: they would drift, and the drift would be invisible.
 *
 * §31 is the audit trail, and it is a second component rather than the panel's
 * own compact revision list because the panel's list is an index of revisions
 * while §31 is a record of what changed. The panel says "rev 7, by Sam, 3 Oct";
 * the trail says "Temperature maximum: 5 Â°C â†’ 6 Â°C, reason: matching the new
 * regulatory guidance, by Sam". One is a changelog, the other is an audit, and
 * §31's rule â€” never silently overwrite configuration history â€” is a rule about
 * the second.
 *
 * The two therefore do overlap on purpose and it is worth naming the cost: both
 * fetch the history, which the API client dedupes and caches for five seconds so
 * the second fetch is free, and both show a revision count. Removing the panel's
 * own list would need a prop on `ThresholdsPanel`, which is not in this pass's
 * file ownership; it is a one-line change when that component is next touched.
 */
import { useCallback, useEffect, useState } from 'react';
import { getThresholdHistory } from '../../api/endpoints';
import { toApiError } from '../../lib/useResource';
import type { ApiError } from '../../api/client';
import type { ThresholdHistoryResponse, ThresholdScope } from '../../api/types';
import { DeviceGate, PageHeader } from '../PageFrame';
import { ThresholdsPanel } from '../../components/ThresholdsPanel';
import { AuditTrail } from '../../components/AuditTrail';
import { ErrorNotice, LoadingLine } from '../../components/Notices';

export default function ThresholdsPage() {
  const [scope, setScope] = useState<ThresholdScope>('zone');
  const [history, setHistory] = useState<ThresholdHistoryResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(
    (dev: string) => {
      setError(null);
      getThresholdHistory(dev, { scope, limit: 50 }).then(setHistory, (cause: unknown) => {
        setHistory(null);
        setError(toApiError(cause));
      });
    },
    [scope],
  );

  useEffect(() => {
    if (scope !== 'zone') setHistory(null);
  }, [scope]);

  return (
    <DeviceGate>
      {({ dev }) => (
        <>
          <PageHeader
            title="Thresholds & audit"
            lede={
              <>
                The limits {dev} applies, and the complete record of every change ever made to them. The device decides
                freshness; this page sets the numbers it decides with and records who changed them.
              </>
            }
          />

          <div className="columns">
            <div className="column">
              <ThresholdsPanel dev={dev} />
            </div>

            <div className="column">
              <section className="panel" aria-labelledby="audit-scope-title">
                <div className="panel__head">
                  <h2 className="panel__title" id="audit-scope-title">
                    Audit scope
                  </h2>
                  <p className="panel__sub">
                    {scope === 'zone' ? 'Shared zone limits' : 'Per-item limits'} · {dev}
                  </p>
                </div>
                <div className="panel__body">
                  <div className="chip-group" role="group" aria-label="Scope">
                    {(['zone', 'item'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="chip chip--plain"
                        aria-pressed={scope === option}
                        onClick={() => {
                          setScope(option);
                          if (option === 'zone') setNonce((value) => value + 1);
                        }}
                      >
                        {option === 'zone' ? 'Shared zone' : 'Per item'}
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    The two scopes are independent records. A zone limit applies to the cabinet and to every item in it;
                    an item limit applies to one tag. Switching scope changes which history is read, and the service keeps
                    them apart.
                  </p>
                </div>
              </section>

              {/*
                The history is loaded here rather than passed down, because
                `ThresholdsPanel` does not expose the response it already
                fetched. Two callers asking for the same URL in the same tick
                share one request, so this costs nothing at mount and one
                cached read per scope change after that.
              */}
              <HistoryLoader dev={dev} scope={scope} nonce={nonce} load={load} history={history} error={error} />
            </div>
          </div>
        </>
      )}
    </DeviceGate>
  );
}

function HistoryLoader({
  dev,
  scope,
  nonce,
  load,
  history,
  error,
}: {
  readonly dev: string;
  readonly scope: ThresholdScope;
  readonly nonce: number;
  readonly load: (dev: string) => void;
  readonly history: ThresholdHistoryResponse | null;
  readonly error: ApiError | null;
}) {
  useEffect(() => {
    if (scope !== 'zone') return;
    load(dev);
  }, [dev, scope, nonce, load]);

  if (scope !== 'zone') {
    return (
      <section className="panel" aria-labelledby="item-audit-title">
        <div className="panel__head">
          <h2 className="panel__title" id="item-audit-title">
            Audit trail â€” per item
          </h2>
          <p className="panel__sub">Not shown</p>
        </div>
        <div className="panel__body">
          <p className="note">
            The per-item scope has its own history and the service will return it, but this build does not display it: the
            item limit a per-item configuration would set is not a field the device payload carries, so a trail of changes
            to limits nothing reports would be a record of edits to numbers with no effect. That is worth saying rather
            than than leaving an empty panel, and it becomes real as soon as the firmware reports an item-level limit.
          </p>
        </div>
      </section>
    );
  }

  if (error !== null) {
    return (
      <div className="panel__body">
        <ErrorNotice
          what={`Loading the ${scope} change history for ${dev}`}
          error={error}
          onRetry={() => load(dev)}
        />
      </div>
    );
  }

  if (history === null) return <LoadingLine>Loading the change historyâ€¦</LoadingLine>;

  return <AuditTrail dev={dev} scope={scope} changes={history.changes} />;
}
