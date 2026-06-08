import { ApiError, CONTROL_API_BASE, apiRequest, extractApiError } from "./client";
import type { ApiRequestSignalOptions, Cluster, ClusterListResponse, GetClustersParams, QueryParams } from "./types";
import type { ClusterDetailModel, ClusterNodeListModel } from "@/lib/contracts/domain";
import { getClusterHealthList, type RuntimeStatus } from "./cluster-health";

export async function getClusters(
  params: GetClustersParams = {},
  token: string,
  requestOptions: ApiRequestSignalOptions = {},
): Promise<ClusterListResponse> {
  const query: QueryParams = {
    keyword: params.keyword,
    environment: params.environment,
    status: params.status,
    state: params.state,
    selectableOnly: params.selectableOnly,
    page: params.page,
    pageSize: params.pageSize,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };

  const result = await apiRequest<ClusterListResponse>("/api/clusters", {
    method: "GET",
    query,
    token,
    signal: requestOptions.signal,
  });
  const visibleItems = (result.items ?? []).filter((item) => {
    if (item.state === "deleted") return false;
    if (!item.name?.trim()) return false;
    return true;
  });
  if (!params.selectableOnly) {
    return { ...result, items: visibleItems, total: visibleItems.length, selectableUnavailable: false };
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
      { suppressAuthExpiryBroadcast: true, signal: requestOptions.signal },
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
      selectableUnavailable: false,
    };
  } catch {
    return {
      ...result,
      items: [],
      total: 0,
      selectableUnavailable: true,
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
  runtimeStatus: RuntimeStatus;
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

export async function getClusterNodes(id: string, token?: string): Promise<ClusterNodeListModel> {
  return apiRequest<ClusterNodeListModel>(`/api/clusters/${id}/nodes`, {
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

function buildApiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const configuredBase = CONTROL_API_BASE.trim().replace(/\/+$/, "");
  if (!configuredBase || !/^https?:\/\//i.test(configuredBase)) {
    return path;
  }

  if (typeof window !== "undefined") {
    try {
      const parsed = new URL(configuredBase);
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
        return path;
      }
    } catch {
      return path;
    }
  }

  return `${configuredBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function parseDownloadFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }

  const asciiMatch = header.match(/filename=\"?([^\";]+)\"?/i);
  return asciiMatch?.[1] || fallback;
}

async function readDownloadError(response: Response): Promise<Error> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    const errorInfo = extractApiError(payload, response.status);
    return new ApiError(errorInfo.message, response.status, errorInfo.code, errorInfo.details, errorInfo.requestId);
  }

  const text = (await response.text().catch(() => "")).trim();
  return new Error(text || `Request failed with status ${response.status}`);
}

export async function downloadClusterKubeconfig(
  id: string,
  token: string,
): Promise<{ blob: Blob; filename: string }> {
  const path = `/api/clusters/${encodeURIComponent(id)}/kubeconfig/export`;
  const response = await fetch(buildApiUrl(path), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw await readDownloadError(response);
  }

  return {
    blob: await response.blob(),
    filename: parseDownloadFilename(response.headers.get("content-disposition"), `${id}-kubeconfig.yaml`),
  };
}
