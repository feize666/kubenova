import { apiRequest } from "./client";
import type { ApiRequestSignalOptions } from "./types";

export interface TopologyNamespaceSummaryItem {
  clusterId: string | null;
  namespace: string | null;
  resourceCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  gatewayCount: number;
  networkCount: number;
  workloadCount: number;
  podCount: number;
  abnormalCount: number;
  updatedAt: string | null;
}

export interface TopologyNamespaceSummaryResponse {
  items: TopologyNamespaceSummaryItem[];
  timestamp: string;
}

export function getTopologyNamespaceSummaries(
  params: { clusterId?: string } = {},
  token?: string,
  requestOptions: ApiRequestSignalOptions = {},
) {
  return apiRequest<TopologyNamespaceSummaryResponse>("/api/topology/summary/namespaces", {
    method: "GET",
    query: {
      clusterId: params.clusterId,
    },
    token,
    signal: requestOptions.signal,
  });
}
