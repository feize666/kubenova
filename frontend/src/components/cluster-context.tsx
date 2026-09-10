"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "@/components/auth-context";
import { getClusterDetail } from "@/lib/api/clusters";
import type { ClusterDetailModel } from "@/lib/contracts/domain";
import { QUERY_CACHE_TIMINGS, queryKeys } from "@/lib/query";

type ClusterContextValue = {
  clusterId: string;
  cluster: ClusterDetailModel | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
};

const ClusterContext = createContext<ClusterContextValue | null>(null);

function normalizeRouteClusterId(clusterId: string) {
  const normalized = clusterId.trim();
  if (!normalized) {
    throw new Error("集群地址无效");
  }
  return normalized;
}

export function ClusterContextProvider({
  clusterId,
  children,
}: {
  clusterId: string;
  children: ReactNode;
}) {
  const { accessToken } = useAuth();
  const normalizedClusterId = normalizeRouteClusterId(clusterId);
  const query = useQuery({
    queryKey: [...queryKeys.clusters.detail(normalizedClusterId), accessToken],
    queryFn: () => getClusterDetail(normalizedClusterId, accessToken || undefined),
    enabled: Boolean(accessToken),
    staleTime: QUERY_CACHE_TIMINGS.listStaleTimeMs,
    gcTime: QUERY_CACHE_TIMINGS.listGcTimeMs,
    retry: 1,
  });

  const value = useMemo<ClusterContextValue>(() => ({
    clusterId: normalizedClusterId,
    cluster: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error : query.error ? new Error("集群信息加载失败") : null,
    refresh: query.refetch,
  }), [normalizedClusterId, query.data, query.error, query.isFetching, query.isLoading, query.refetch]);

  return <ClusterContext.Provider value={value}>{children}</ClusterContext.Provider>;
}

export function useClusterContext() {
  const value = useContext(ClusterContext);
  if (!value) {
    throw new Error("useClusterContext 必须在 ClusterContextProvider 内使用");
  }
  return value;
}
