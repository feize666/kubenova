import { apiRequest } from './client';

export interface NetworkResource {
  id: string;
  clusterId: string;
  namespace: string;
  kind: 'Service' | 'Ingress' | 'IngressRoute' | 'Endpoints' | 'EndpointSlice' | 'NetworkPolicy';
  name: string;
  state: 'active' | 'disabled' | 'deleted';
  spec?: Record<string, unknown>;
  statusJson?: Record<string, unknown>;
  labels?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkListResponse {
  items: NetworkResource[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NetworkListParams {
  kind?: string;
  clusterId?: string;
  namespace?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateNetworkResourcePayload {
  clusterId: string;
  namespace: string;
  kind: 'Service' | 'Ingress' | 'IngressRoute' | 'Endpoints' | 'EndpointSlice' | 'NetworkPolicy';
  name: string;
  spec?: Record<string, unknown>;
}

export function getNetworkResources(params: NetworkListParams = {}, token?: string) {
  const query: Record<string, string | number> = {};
  if (params.kind) query.kind = params.kind;
  if (params.clusterId) query.clusterId = params.clusterId;
  if (params.namespace) query.namespace = params.namespace;
  if (params.keyword) query.keyword = params.keyword;
  if (params.page) query.page = params.page;
  if (params.pageSize) query.pageSize = params.pageSize;
  return apiRequest<NetworkListResponse>('/api/network', { query, token });
}

export function createNetworkResource(body: CreateNetworkResourcePayload, token?: string) {
  return apiRequest<NetworkResource>('/api/network', {
    method: 'POST',
    body,
    token,
  });
}

export function deleteNetworkResource(id: string, token?: string) {
  return apiRequest<unknown>(`/api/network/${id}/actions`, {
    method: 'POST',
    body: { action: 'delete' },
    token,
  });
}

export function applyNetworkAction(id: string, action: string, payload?: unknown, token?: string) {
  return apiRequest(`/api/network/${id}/actions`, {
    method: 'POST',
    body: { action, payload },
    token,
  });
}
