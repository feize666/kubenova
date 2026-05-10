import { apiRequest } from "./client";

export type MultiClusterDomain = "workload" | "network" | "storage" | "config";

export interface MultiClusterQueryRequest {
  clusterIds: string[];
  domain?: MultiClusterDomain;
  kind?: string;
  namespace?: string;
  keyword?: string;
  limitPerCluster?: number;
}

export interface MultiClusterQueryItem {
  id: string;
  clusterId: string;
  namespace?: string;
  kind: string;
  name: string;
  state: string;
  source: MultiClusterDomain;
  createdAt: string;
  updatedAt: string;
}

export interface MultiClusterPartialError {
  clusterId: string;
  code: string;
  message: string;
}

export interface MultiClusterQueryResponse {
  items: MultiClusterQueryItem[];
  partialErrors: MultiClusterPartialError[];
  total: number;
  timestamp: string;
}

export async function queryMultiCluster(
  payload: MultiClusterQueryRequest,
  token?: string,
): Promise<MultiClusterQueryResponse> {
  return apiRequest<MultiClusterQueryResponse, MultiClusterQueryRequest>(
    "/api/multicluster/query",
    {
      method: "POST",
      body: payload,
      token,
    },
  );
}
