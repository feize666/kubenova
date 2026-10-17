import type { QueryClientConfig, Query } from "@tanstack/react-query";

export const QUERY_CACHE_TIMINGS = {
  defaultStaleTimeMs: 2 * 60 * 1000,
  defaultGcTimeMs: 4 * 60 * 1000,
  shellCapabilityStaleTimeMs: 10 * 60 * 1000,
  shellCapabilityGcTimeMs: 30 * 60 * 1000,
  listStaleTimeMs: 45 * 1000,
  listGcTimeMs: 3 * 60 * 1000,
  focusRefreshAfterMs: 90 * 1000,
} as const;

function shouldRefreshOnWindowFocus(query: Query) {
  return Date.now() - query.state.dataUpdatedAt > QUERY_CACHE_TIMINGS.focusRefreshAfterMs;
}

export const defaultQueryOptions = {
  queries: {
    staleTime: QUERY_CACHE_TIMINGS.defaultStaleTimeMs,
    gcTime: QUERY_CACHE_TIMINGS.defaultGcTimeMs,
    refetchOnMount: false,
    refetchOnWindowFocus: shouldRefreshOnWindowFocus,
    refetchOnReconnect: true,
    retry: 1,
  },
} satisfies NonNullable<QueryClientConfig["defaultOptions"]>;

export const listQueryOptions = {
  staleTime: QUERY_CACHE_TIMINGS.listStaleTimeMs,
  gcTime: QUERY_CACHE_TIMINGS.listGcTimeMs,
  // Placeholder data must be scoped by each resource query. A global
  // keepPreviousData policy can briefly render another account/cluster's rows
  // when a list key changes.
  refetchOnMount: false,
  refetchOnWindowFocus: shouldRefreshOnWindowFocus,
  refetchOnReconnect: true,
  retry: 1,
} satisfies NonNullable<QueryClientConfig["defaultOptions"]>["queries"];
