import { apiRequest } from "./client";
import type { Cluster, ClusterListResponse, GetClustersParams, QueryParams } from "./types";
import type { ClusterDetailModel } from "@/lib/contracts/domain";
import { getClusterHealthList } from "./cluster-health";

export async function getClusters(params: GetClustersParams = {}, token: string): Promise<ClusterListResponse> {
  const query: QueryParams = {
    keyword: params.keyword,
    environment: params.environment,
    status: params.status,
    state: params.state,
    selectableOnly: params.selectableOnly,
    page: params.page,
    pageSize: params.pageSize,
  };

  const result = await apiRequest<ClusterListResponse>("/api/clusters", {
    method: "GET",
    query,
    token,
  });
  const visibleItems = (result.items ?? []).filter((item) => {
    if (item.state === "deleted") return false;
    if (!item.name?.trim()) return false;
    return true;
  });
  if (!params.selectableOnly) {
    return { ...result, items: visibleItems, total: visibleItems.length };
  }
  try {
    const health = await getClusterHealthList(
      {
        lifecycleState: "active",
        runtimeStatus: "running",
        page: 1,
        pageSize: 500,
      },
      token,
      { suppressAuthExpiryBroadcast: true },
    );
    const onlineIds = new Set(health.items.map((item) => item.clusterId));
    const onlineSelectable = visibleItems.filter(
      (item) =>
        item.state === "active" &&
        item.hasKubeconfig !== false &&
        onlineIds.has(item.id),
    );
    return {
      ...result,
      items: onlineSelectable,
      total: onlineSelectable.length,
    };
  } catch {
    return {
      ...result,
      items: [],
      total: 0,
    };
  }
}

export interface ClusterPayload {
  name: string;
  environment: string;
  provider: string;
  kubernetesVersion: string;
  status: string;
  /** kubeconfig YAML 原文，用于接入真实集群。不填时集群以离线模式管理。 */
  kubeconfig?: string;
}

export interface ClusterHealthResult {
  ok: boolean;
  latencyMs: number;
  version: string | null;
  nodeCount: number | null;
  message: string;
}

export async function createCluster(body: ClusterPayload, token: string): Promise<Cluster> {
  return apiRequest<Cluster>("/api/clusters", {
    method: "POST",
    body,
    token,
  });
}

export async function updateCluster(id: string, body: ClusterPayload, token: string): Promise<Cluster> {
  return apiRequest<Cluster>(`/api/clusters/${id}`, {
    method: "PATCH",
    body,
    token,
  });
}

export async function deleteCluster(id: string, token: string): Promise<void> {
  return apiRequest<void>(`/api/clusters/${id}`, {
    method: "DELETE",
    token,
  });
}

export async function disableCluster(id: string, token: string): Promise<Cluster> {
  return apiRequest<Cluster>(`/api/clusters/${id}/disable`, {
    method: "POST",
    token,
  });
}

export async function enableCluster(id: string, token: string): Promise<Cluster> {
  return apiRequest<Cluster>(`/api/clusters/${id}/enable`, {
    method: "POST",
    token,
  });
}

export async function getClusterDetail(id: string, token?: string): Promise<ClusterDetailModel> {
  return apiRequest<ClusterDetailModel>(`/api/clusters/${id}`, {
    method: "GET",
    token,
  });
}

export interface SyncResult {
  ok: boolean;
  counts?: Record<string, number>;
  errors?: string[];
  message?: string;
}

export async function syncCluster(id: string, token: string): Promise<SyncResult> {
  return apiRequest<SyncResult>(`/api/clusters/${id}/sync`, {
    method: "POST",
    token,
  });
}

export async function getClusterHealth(id: string, token: string): Promise<ClusterHealthResult> {
  return apiRequest<ClusterHealthResult>(`/api/clusters/${id}/health`, {
    method: "GET",
    token,
  });
}
