import { keepPreviousData } from "@tanstack/react-query";
import type { QueryClientConfig, Query } from "@tanstack/react-query";

export const QUERY_CACHE_TIMINGS = {
  defaultStaleTimeMs: 2 * 60 * 1000,
  defaultGcTimeMs: 10 * 60 * 1000,
  shellCapabilityStaleTimeMs: 10 * 60 * 1000,
  shellCapabilityGcTimeMs: 30 * 60 * 1000,
  listStaleTimeMs: 45 * 1000,
  listGcTimeMs: 10 * 60 * 1000,
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
  placeholderData: keepPreviousData,
  refetchOnMount: false,
  refetchOnWindowFocus: shouldRefreshOnWindowFocus,
  refetchOnReconnect: true,
  retry: 1,
} satisfies NonNullable<QueryClientConfig["defaultOptions"]>["queries"];
