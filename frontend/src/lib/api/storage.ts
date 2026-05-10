import { apiRequest } from './client';

export interface StorageResource {
  id: string;
  clusterId: string;
  namespace?: string;
  kind: 'PV' | 'PVC' | 'SC';
  name: string;
  state: 'active' | 'disabled' | 'deleted';
  capacity?: string;
  accessModes?: string[];
  storageClass?: string;
  bindingMode?: string;
  spec?: Record<string, unknown>;
  statusJson?: Record<string, unknown>;
  labels?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface StorageListResponse {
  items: StorageResource[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StorageListParams {
  kind?: string;
  clusterId?: string;
  namespace?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateStorageResourcePayload {
  clusterId: string;
  namespace?: string;
  kind: 'PV' | 'PVC' | 'SC';
  name: string;
  capacity?: string;
  storageClass?: string;
  accessModes?: string[];
  bindingMode?: string;
  spec?: Record<string, unknown>;
}

export function getStorageResources(params: StorageListParams = {}, token?: string) {
  const query: Record<string, string | number> = {};
  if (params.kind) query.kind = params.kind;
  if (params.clusterId) query.clusterId = params.clusterId;
  if (params.namespace) query.namespace = params.namespace;
  if (params.keyword) query.keyword = params.keyword;
  if (params.page) query.page = params.page;
  if (params.pageSize) query.pageSize = params.pageSize;
  return apiRequest<StorageListResponse>('/api/storage', { query, token });
}

export function createStorageResource(body: CreateStorageResourcePayload, token?: string) {
  return apiRequest<StorageResource>('/api/storage', {
    method: 'POST',
    body,
    token,
  });
}

export function deleteStorageResource(id: string, token?: string) {
  return apiRequest<unknown>(`/api/storage/${id}/actions`, {
    method: 'POST',
    body: { action: 'delete' },
    token,
  });
}

export function applyStorageAction(id: string, action: string, payload?: unknown, token?: string) {
  return apiRequest(`/api/storage/${id}/actions`, {
    method: 'POST',
    body: { action, payload },
    token,
  });
}
