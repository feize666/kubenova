import { apiRequest } from "./client";

export interface NamespaceListItem {
  id: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  state: string;
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface NamespaceListResponse {
  items: NamespaceListItem[];
  total: number;
  page?: number;
  pageSize?: number;
  timestamp: string;
}

export interface NamespaceQueryParams {
  clusterId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface CreateNamespacePayload {
  clusterId: string;
  namespace: string;
  labels?: Record<string, string>;
}

export interface UpdateNamespacePayload {
  labels: Record<string, string>;
}

export function getNamespaces(params: NamespaceQueryParams = {}, token?: string) {
  const query: Record<string, string> = {};
  if (params.clusterId) {
    query.clusterId = params.clusterId;
  }
  if (params.keyword) {
    query.keyword = params.keyword;
  }
  if (typeof params.page === "number") {
    query.page = String(params.page);
  }
  if (typeof params.pageSize === "number") {
    query.pageSize = String(params.pageSize);
  }
  if (params.sortBy) {
    query.sortBy = params.sortBy;
  }
  if (params.sortOrder) {
    query.sortOrder = params.sortOrder;
  }
  return apiRequest<NamespaceListResponse>("/api/namespaces", { query, token });
}

export function createNamespace(payload: CreateNamespacePayload, token?: string) {
  return apiRequest<NamespaceListItem, CreateNamespacePayload>("/api/namespaces", {
    method: "POST",
    body: payload,
    token,
  });
}

export function updateNamespace(id: string, payload: UpdateNamespacePayload, token?: string) {
  return apiRequest<NamespaceListItem, UpdateNamespacePayload>(`/api/namespaces/${id}`, {
    method: "PATCH",
    body: payload,
    token,
  });
}

export function deleteNamespace(id: string, token?: string) {
  return apiRequest<{ id: string }>(`/api/namespaces/${id}`, {
    method: "DELETE",
    token,
  });
}
