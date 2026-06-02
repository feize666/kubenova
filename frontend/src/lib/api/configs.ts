import { apiRequest } from "./client";
import { buildResourceListQuery, type ExtendedListQueryParams } from "./helpers";

export type ConfigKind = "configmaps" | "secrets";
export type ConfigState = "active" | "disabled" | "deleted";

export interface ConfigResourceItem {
  id: string;
  kind: "ConfigMap" | "Secret";
  name: string;
  namespace: string;
  clusterId: string;
  dataCount: number;
  updatedAt: string;
  state: ConfigState;
  version: number;
  currentRev?: number;
  labels?: Record<string, string>;
  revisions?: ConfigRevisionItem[];
}

export interface ConfigRevisionItem {
  id: string;
  configId: string;
  revision: number;
  data: unknown;
  changedBy: string | null;
  changeNote: string | null;
  createdAt: string;
}

export interface ConfigListResponse {
  items: ConfigResourceItem[];
  page: number;
  pageSize: number;
  total: number;
  timestamp: string;
}

export interface ConfigListParams extends ExtendedListQueryParams {
  namespace?: string;
  clusterId?: string;
}

// kind param maps to backend: "configmaps" -> "ConfigMap", "secrets" -> "Secret"
function kindToBackend(kind: ConfigKind): string {
  return kind === "configmaps" ? "ConfigMap" : "Secret";
}

export function getConfigs(kind: ConfigKind, params: ConfigListParams = {}, token: string) {
  return apiRequest<ConfigListResponse>(`/api/configs`, {
    method: "GET",
    query: { ...buildResourceListQuery(params), kind: kindToBackend(kind) },
    token,
  });
}

export interface CreateConfigPayload {
  clusterId: string;
  namespace: string;
  kind: "ConfigMap" | "Secret";
  name: string;
  dataKeys?: string[];
  data?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface ConfigMutationResponse {
  item: ConfigResourceItem;
  message: string;
  timestamp: string;
}

export function createConfig(payload: CreateConfigPayload, token: string) {
  return apiRequest<ConfigMutationResponse>(`/api/configs`, {
    method: "POST",
    body: payload,
    token,
  });
}

export interface UpdateConfigPayload {
  namespace?: string;
  dataKeys?: string[];
  data?: Record<string, string>;
  labels?: Record<string, string>;
}

export function getConfig(id: string, token: string) {
  return apiRequest<ConfigResourceItem>(`/api/configs/${id}`, {
    method: "GET",
    token,
  });
}

export function updateConfig(id: string, payload: UpdateConfigPayload, token: string) {
  return apiRequest<ConfigMutationResponse, UpdateConfigPayload>(`/api/configs/${id}`, {
    method: "PATCH",
    body: payload,
    token,
  });
}

export function deleteConfig(id: string, token: string) {
  return apiRequest<ConfigMutationResponse>(`/api/configs/${id}/actions`, {
    method: "POST",
    body: { action: "delete" },
    token,
  });
}
