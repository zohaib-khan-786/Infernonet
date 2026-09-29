/**
 * A one-promise resource hook.
 *
 * Deliberately not SWR and not a query cache: this app already has a cache in
 * `api/client.ts` that deduplicates in-flight GETs and holds resolved values
 * briefly. What is missing here, and all this hook adds, is the React-side
 * bookkeeping for "loading / error / settled, and never show the previous
 * resource's data under a new key".
 *
 * The key is the loader's own identity. Call sites memoise their loader with
 * `useCallback`, so the identity changes exactly when the resource it names
 * changes, and there is no dependency array to get wrong.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';

export interface Resource<T> {
  readonly data: T | null;
  readonly error: ApiError | null;
  /** True from the moment a new load starts until it settles. */
  readonly loading: boolean;
  readonly reload: () => void;
}

/** Anything thrown by a loader becomes an ApiError, so no screen shows a raw Error. */
export function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  return new ApiError({
    status: 0,
    code: 'unexpected',
    message: cause instanceof Error && cause.message ? cause.message : 'an unexpected error occurred',
  });
}

interface Settled<T> {
  readonly loader: unknown;
  readonly data: T | null;
  readonly error: ApiError | null;
}

export function useResource<T>(loader: (() => Promise<T>) | null): Resource<T> {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    if (loader === null) {
      setSettled(null);
      return;
    }
    let live = true;
    // Clearing immediately is what stops the old value being shown under the
    // new key while the request is in flight.
    setSettled({ loader, data: null, error: null });
    loader().then(
      (data) => {
        if (live) setSettled({ loader, data, error: null });
      },
      (cause: unknown) => {
        if (live) setSettled({ loader, data: null, error: toApiError(cause) });
      },
    );
    return () => {
      live = false;
    };
  }, [loader, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const current = settled !== null && settled.loader === loader ? settled : null;

  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: loader !== null && (current === null || (current.data === null && current.error === null)),
    reload,
  };
}
