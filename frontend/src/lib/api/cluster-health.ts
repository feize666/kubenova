import { apiRequest } from "./client";

export type RuntimeStatus = "running" | "offline" | "checking" | "disabled" | "offline-mode";
export type HealthProbeSource = "auto" | "manual" | "event";
export type ClusterLifecycleState = "active" | "disabled" | "deleted";

export interface ClusterHealthListItem {
  clusterId: string;
  clusterName: string;
  lifecycleState: ClusterLifecycleState;
  runtimeStatus: RuntimeStatus;
  ok: boolean | null;
  latencyMs: number | null;
  checkedAt: string | null;
  reason: string | null;
  source: HealthProbeSource | null;
  isStale: boolean;
}

export interface ClusterHealthListResponse {
  items: ClusterHealthListItem[];
  page: number;
  pageSize: number;
  total: number;
  timestamp: string;
}

export interface ClusterHealthDetailResponse {
  summary: ClusterHealthListItem;
  detail: {
    timeoutMs: number | null;
    failureCount: number | null;
    payload: Record<string, unknown> | null;
  };
}

export interface ClusterHealthSnapshotView {
  clusterId: string;
  ok: boolean;
  status: RuntimeStatus;
  latencyMs: number | null;
  checkedAt: string;
  reason: string | null;
  source: HealthProbeSource;
  timeoutMs: number;
  failureCount: number;
  detailJson: Record<string, unknown> | null;
  isStale: boolean;
}

export interface ClusterHealthListParams {
  keyword?: string;
  provider?: string;
  environment?: string;
  lifecycleState?: ClusterLifecycleState | "";
  runtimeStatus?: RuntimeStatus | "";
  page?: number;
  pageSize?: number;
}

export async function getClusterHealthList(
  params: ClusterHealthListParams = {},
  token?: string,
  options?: { suppressAuthExpiryBroadcast?: boolean },
): Promise<ClusterHealthListResponse> {
  return apiRequest<ClusterHealthListResponse>("/api/cluster-health", {
    method: "GET",
    token,
    suppressAuthExpiryBroadcast: options?.suppressAuthExpiryBroadcast,
    query: {
      keyword: params.keyword?.trim() || undefined,
      provider: params.provider?.trim() || undefined,
      environment: params.environment?.trim() || undefined,
      lifecycleState: params.lifecycleState || undefined,
      runtimeStatus: params.runtimeStatus || undefined,
      page: params.page,
      pageSize: params.pageSize,
    },
  });
}

export async function getClusterHealthDetail(
  clusterId: string,
  token?: string,
  options?: { suppressAuthExpiryBroadcast?: boolean },
): Promise<ClusterHealthDetailResponse> {
  return apiRequest<ClusterHealthDetailResponse>(`/api/cluster-health/${clusterId}`, {
    method: "GET",
    token,
    suppressAuthExpiryBroadcast: options?.suppressAuthExpiryBroadcast,
  });
}

export async function probeClusterHealth(
  clusterId: string,
  token?: string,
  options?: { suppressAuthExpiryBroadcast?: boolean },
): Promise<ClusterHealthSnapshotView> {
  return apiRequest<ClusterHealthSnapshotView>(`/api/cluster-health/${clusterId}/probe`, {
    method: "POST",
    token,
    suppressAuthExpiryBroadcast: options?.suppressAuthExpiryBroadcast,
  });
}
