"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import type { ClusterOption } from "@/components/cluster-select";
import { getClusters } from "@/lib/api/clusters";
import { rememberClusterDisplayNames } from "@/lib/cluster-display-name";
import { QUERY_CACHE_TIMINGS, queryKeys } from "@/lib/query";

export function useClusterDisplayMap(options: ClusterOption[], activeClusterId?: string) {
  const { accessToken, isAuthenticated, isInitializing } = useAuth();
  const needsLookup = Boolean(
    activeClusterId?.trim() &&
      !options.some((option) => option.value === activeClusterId),
  );
  const query = useQuery({
    queryKey: queryKeys.clusters.list({ scope: "display-map" }),
    queryFn: () => getClusters({ page: 1, pageSize: 500 }, accessToken ?? ""),
    enabled: needsLookup && !isInitializing && isAuthenticated && Boolean(accessToken),
    staleTime: QUERY_CACHE_TIMINGS.shellCapabilityStaleTimeMs,
    gcTime: QUERY_CACHE_TIMINGS.shellCapabilityGcTimeMs,
    refetchOnMount: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    const items = query.data?.items ?? [];
    rememberClusterDisplayNames(items);
    return new Map<string, string>([
      ...items.map((item) => [item.id, item.name] as const),
      ...options.map((option) => [option.value, option.label] as const),
    ]);
  }, [options, query.data?.items]);
}
