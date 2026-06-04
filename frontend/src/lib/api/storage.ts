import { apiRequest } from './client';
import type { SortOrder } from '@/lib/contracts/common';
import { updateResourceYaml } from './resources';

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
  sortBy?: string;
  sortOrder?: SortOrder;
  sync?: 'false' | 'true' | 'foreground';
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

export interface StorageResourceIdentity {
  clusterId: string;
  namespace?: string;
  name: string;
}

export interface PvcResizePayload extends StorageResourceIdentity {
  namespace: string;
  capacity: string;
}

export interface PvcBindPayload extends StorageResourceIdentity {
  namespace: string;
  volumeName: string;
}

export interface PvBindPayload extends StorageResourceIdentity {
  claimNamespace: string;
  claimName: string;
}

export interface StorageClassMutableUpdatePayload extends StorageResourceIdentity {
  allowVolumeExpansion: boolean;
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function trimRequired(value: string, field: string) {
  const next = value.trim();
  if (!next) {
    throw new Error(`${field} 不能为空`);
  }
  return next;
}

export function getStorageResources(params: StorageListParams = {}, token?: string) {
  const query: Record<string, string | number> = {};
  if (params.kind) query.kind = params.kind;
  if (params.clusterId) query.clusterId = params.clusterId;
  if (params.namespace) query.namespace = params.namespace;
  if (params.keyword) query.keyword = params.keyword;
  if (params.page) query.page = params.page;
  if (params.pageSize) query.pageSize = params.pageSize;
  if (params.sortBy) query.sortBy = params.sortBy;
  if (params.sortOrder) query.sortOrder = params.sortOrder;
  if (params.sync) query.sync = params.sync;
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

export function resizePersistentVolumeClaim(payload: PvcResizePayload, token?: string) {
  const namespace = trimRequired(payload.namespace, 'namespace');
  const name = trimRequired(payload.name, 'name');
  const capacity = trimRequired(payload.capacity, 'capacity');

  return updateResourceYaml(
    {
      clusterId: payload.clusterId,
      namespace,
      kind: 'PersistentVolumeClaim',
      name,
      yaml: [
        'apiVersion: v1',
        'kind: PersistentVolumeClaim',
        'metadata:',
        `  name: ${yamlString(name)}`,
        `  namespace: ${yamlString(namespace)}`,
        'spec:',
        '  resources:',
        '    requests:',
        `      storage: ${yamlString(capacity)}`,
      ].join('\n'),
    },
    token,
  );
}

export function bindPersistentVolumeClaim(payload: PvcBindPayload, token?: string) {
  const namespace = trimRequired(payload.namespace, 'namespace');
  const name = trimRequired(payload.name, 'name');
  const volumeName = trimRequired(payload.volumeName, 'volumeName');

  return updateResourceYaml(
    {
      clusterId: payload.clusterId,
      namespace,
      kind: 'PersistentVolumeClaim',
      name,
      yaml: [
        'apiVersion: v1',
        'kind: PersistentVolumeClaim',
        'metadata:',
        `  name: ${yamlString(name)}`,
        `  namespace: ${yamlString(namespace)}`,
        'spec:',
        `  volumeName: ${yamlString(volumeName)}`,
      ].join('\n'),
    },
    token,
  );
}

export function bindPersistentVolume(payload: PvBindPayload, token?: string) {
  const name = trimRequired(payload.name, 'name');
  const claimNamespace = trimRequired(payload.claimNamespace, 'claimNamespace');
  const claimName = trimRequired(payload.claimName, 'claimName');

  return updateResourceYaml(
    {
      clusterId: payload.clusterId,
      namespace: payload.namespace ?? 'default',
      kind: 'PersistentVolume',
      name,
      yaml: [
        'apiVersion: v1',
        'kind: PersistentVolume',
        'metadata:',
        `  name: ${yamlString(name)}`,
        'spec:',
        '  claimRef:',
        '    apiVersion: v1',
        '    kind: PersistentVolumeClaim',
        `    namespace: ${yamlString(claimNamespace)}`,
        `    name: ${yamlString(claimName)}`,
      ].join('\n'),
    },
    token,
  );
}

export function updateStorageClassMutableFields(
  payload: StorageClassMutableUpdatePayload,
  token?: string,
) {
  const name = trimRequired(payload.name, 'name');

  return updateResourceYaml(
    {
      clusterId: payload.clusterId,
      namespace: payload.namespace ?? 'default',
      kind: 'StorageClass',
      name,
      yaml: [
        'apiVersion: storage.k8s.io/v1',
        'kind: StorageClass',
        'metadata:',
        `  name: ${yamlString(name)}`,
        `allowVolumeExpansion: ${payload.allowVolumeExpansion ? 'true' : 'false'}`,
      ].join('\n'),
    },
    token,
  );
}
