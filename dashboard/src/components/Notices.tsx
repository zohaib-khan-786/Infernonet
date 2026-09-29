/**
 * Error, empty and loading states.
 *
 * No failure in this app is allowed to be a blank region. Every failed request
 * resolves to a sentence saying what failed, what the service said, and what a
 * person can do next — and the backend's own `code` and `request_id` are shown,
 * because when someone reports "the dashboard is broken" those two lines are
 * the whole diagnosis.
 *
 * WHY A SERVICE FAILURE HAS NO TONE AND NO GLYPH
 * -----------------------------------------------------------------------------
 * A failed request used to be handed a severity tone and a shape, and both were
 * verdict shapes. `crit` + a filled square against a real HTTP 500 rendered
 * `5px solid rgb(132,28,19)` on `rgb(245,217,211)` with a red title — that is
 * the check_food annunciator, byte for byte, on a page whose only red means
 * "throw this food out". Three of the four `warn` branches were identical to a
 * use_soon verdict the same way.
 *
 * That is not a styling problem, it is a false statement. Nothing about an
 * HTTP 500, a rate-limit, a rejected range or an unknown device is a judgement
 * about the food, and the two were wearing the same paint. A volunteer who has
 * spent a week learning "red square = the food" would have been taught the
 * opposite lesson by a request that timed out.
 *
 * So the severity and the shape are gone from this component, and the notice
 * takes one treatment: `data-kind="service"`, which in components.css is the
 * instrument-caution family — a 6px DOUBLE rule, the administrative blue-slate,
 * and a plain diamond, the glyph no verdict uses. The urgency is not thrown
 * away with the paint; it is in the title, in what the service said, and in the
 * code, HTTP status and request id underneath. Those are words, and words are
 * what a volunteer can act on.
 */
import type { ReactNode } from 'react';
import { API_BASE } from '../api/client';
import { healthUrl } from '../api/endpoints';
import type { ApiError } from '../api/client';
import { Mark } from './Mark';

interface Guidance {
  readonly title: string;
  readonly body: ReactNode;
}

/** What to say for a given failure, in the interface's voice. */
function guidanceFor(error: ApiError): Guidance {
  if (error.isNetwork) {
    return {
      title: 'Cannot reach the FreshGuard service',
      body: (
        <>
          <p>
            The dashboard could not open a connection to <code className="num">{API_BASE}</code>. Nothing below this
            message is live.
          </p>
          <p>Check, in this order:</p>
          <ul>
            <li>The backend is running. From the <code className="num">backend/</code> folder, <code className="num">npm start</code>.</li>
            <li>
              It answers at <a href={healthUrl()}>{API_BASE}/healthz</a>. If that does not load, the service is not up.
            </li>
            <li>
              The dashboard is allowed to talk to it: the API base URL is <code className="num">VITE_API_BASE_URL</code>,
              and the service must list this page&apos;s origin in <code className="num">FG_CORS_ORIGINS</code>.
            </li>
          </ul>
        </>
      ),
    };
  }

  if (error.isRateLimited) {
    return {
      title: 'The service is rate limiting this dashboard',
      body: (
        <p>
          The service is answering, but it is refusing to answer this quickly. There is nothing to fix; the dashboard
          will try again. Closing other copies of this page on other devices will speed it up.
        </p>
      ),
    };
  }

  switch (error.code) {
    case 'unknown_device':
      return {
        title: 'No snapshot has been received for this device yet',
        body: (
          <p>
            The service knows no device called <code className="num">{error.message.match(/'([^']*)'/)?.[1] ?? '—'}</code>.
            A device appears as soon as it posts its first snapshot, so this means the device has never reached the
            service — check that it is powered on, on the same network, and that the ingest key configured here is the
            one on the device.
          </p>
        ),
      };
    case 'range_too_wide':
      return {
        title: 'That time range is too wide to plot',
        body: (
          <p>
            {error.message} Readings are kept for a limited window, so pick a shorter range above the chart.
          </p>
        ),
      };
    case 'bad_request':
    case 'not_found':
      return {
        title: 'The service did not understand this request',
        body: (
          <p>
            The service said: <q>{error.message}</q> That usually means the dashboard and the service are on different
            versions. Check that the backend is the version this dashboard was written against.
          </p>
        ),
      };
    default:
      return {
        title: 'The service reported a problem',
        body: <p>The service said: {error.message}</p>,
      };
  }
}

export interface ErrorNoticeProps {
  /** What the dashboard was trying to do, e.g. "Loading the event log". */
  readonly what: string;
  readonly error: ApiError;
  readonly onRetry?: () => void;
  readonly children?: ReactNode;
}

export function ErrorNotice({ what, error, onRetry, children }: ErrorNoticeProps) {
  const guidance = guidanceFor(error);
  return (
    <div className="notice" data-kind="service" role="group" aria-label={`${what} failed`}>
      {/* A plain diamond. No verdict uses it, and every shape that a verdict
          does use — circle, triangle, square — is reserved. */}
      <Mark shape="diamond" className="mark--lg" />
      <div>
        <p className="notice__kind">
          Service error. The service did not answer this request, and nothing here is a verdict about the food.
        </p>
        <p className="notice__title">{guidance.title}</p>
        <div className="notice__body">
          <p>{what} did not complete.</p>
          {guidance.body}
          {children}
          {error.requestId !== null ? (
            <span className="notice__meta">
              service code {error.code}
              {error.status > 0 ? ` · HTTP ${error.status}` : ''} · request {error.requestId}
            </span>
          ) : (
            <span className="notice__meta">service code {error.code}</span>
          )}
        </div>
        {onRetry === undefined ? null : (
          <div className="notice__actions">
            <button type="button" className="btn" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}

/** An empty screen is an invitation to act, not an apology. */
export function EmptyState({ title, children, actions }: EmptyStateProps) {
  return (
    <div className="notice" data-tone="neutral">
      <Mark shape="circle" className="mark--lg" />
      <div>
        <p className="notice__title">{title}</p>
        <div className="notice__body">{children}</div>
        {actions === undefined ? null : <div className="notice__actions">{actions}</div>}
      </div>
    </div>
  );
}

export function LoadingLine({ children }: { readonly children: ReactNode }) {
  return (
    <p className="loading-line" aria-live="polite">
      <span className="loading-line__bar" aria-hidden="true" />
      {children}
    </p>
  );
}
