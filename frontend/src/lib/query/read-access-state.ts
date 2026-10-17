import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isResourceAccessDenied } from "./visible-resource-data";

const deniedQueries = new WeakMap<object, boolean>();

export interface ReadAccessState {
  scope: string;
  denied: boolean;
}

export interface ReadAccessSignal {
  error: unknown;
  succeeded: boolean;
}

export function readAccessState(
  previous: ReadAccessState,
  scope: string,
  signal: ReadAccessSignal,
): ReadAccessState {
  const denied = isResourceAccessDenied(signal.error) ||
    (previous.scope === scope && previous.denied && !signal.succeeded);
  return previous.scope === scope && previous.denied === denied
    ? previous
    : { scope, denied };
}

export function useReadAccess(scope: string, query: { error: unknown; isSuccess: boolean; isPlaceholderData?: boolean }): boolean {
  const cachedQuery = useQueryClient().getQueryCache().get(scope);
  const [state, setState] = useState<ReadAccessState>({ scope, denied: false });
  const previous = {
    scope,
    denied: (state.scope === scope && state.denied) || !!cachedQuery && deniedQueries.get(cachedQuery) === true,
  };
  const next = readAccessState(previous, scope, {
    error: query.error,
    succeeded: query.isSuccess && !query.isPlaceholderData,
  });
  useEffect(() => {
    if (cachedQuery) deniedQueries.set(cachedQuery, next.denied);
  }, [cachedQuery, next.denied]);
  // Adjust during render so neither denial nor recovery paints stale state.
  if (next.scope !== state.scope || next.denied !== state.denied) setState(next);
  return next.denied;
}
