import { apiRequest } from "./client";
import { buildResourceListQuery, type ExtendedListQueryParams } from "./helpers";

export type ConfigKind = "configmaps" | "secrets";
export type ConfigState = "active" | "disabled" | "deleted";

export interface ConfigResourceItem {
  id: string;
  kind: ConfigKind;
  name: string;
  namespace: string;
  clusterId: string;
  dataCount: number;
  updatedAt: string;
  state: ConfigState;
  version: number;
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

export function deleteConfig(id: string, token: string) {
  return apiRequest<ConfigMutationResponse>(`/api/configs/${id}/actions`, {
    method: "POST",
    body: { action: "delete" },
    token,
  });
}
