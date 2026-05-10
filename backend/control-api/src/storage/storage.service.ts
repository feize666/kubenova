import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClusterHealthService } from '../clusters/cluster-health.service';
import { ClusterEventSyncService } from '../clusters/cluster-event-sync.service';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';
import { K8sClientService } from '../clusters/k8s-client.service';
import { appendAudit, type PlatformRole } from '../common/governance';
import {
  StorageRepository,
  type StorageCreateData,
  type StorageListParams,
  type StorageResourceRecord,
  type StorageUpdateData,
} from './storage.repository';

export interface StorageListQuery {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
  sync?: string;
}

export interface StorageListResult {
  items: StorageResourceRecord[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

export interface StorageMutationResponse {
  item: StorageResourceRecord;
  message: string;
  timestamp: string;
}

export interface CreateStorageResourceRequest {
  clusterId: string;
  namespace?: string;
  kind: 'PV' | 'PVC' | 'SC';
  name: string;
  capacity?: string;
  accessModes?: string[];
  storageClass?: string;
  bindingMode?: string;
  spec?: Record<string, unknown>;
}

export interface UpdateStorageResourceRequest {
  namespace?: string;
  capacity?: string;
  accessModes?: string[];
  storageClass?: string;
  bindingMode?: string;
  spec?: Record<string, unknown>;
  statusJson?: Record<string, unknown>;
}

export interface StorageActionRequest {
  action: 'enable' | 'disable' | 'delete';
  reason?: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageSyncAt = new Map<string, number>();

  constructor(
    private readonly storageRepository: StorageRepository,
    private readonly clustersService: ClustersService,
    private readonly k8sClientService: K8sClientService,
    private readonly clusterSyncService: ClusterSyncService,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly clusterEventSyncService: ClusterEventSyncService,
  ) {}

  async list(query: StorageListQuery): Promise<StorageListResult> {
    const clusterId = query.clusterId?.trim();
    let readableClusterIds: string[] | undefined;
    if (clusterId) {
      await this.clusterHealthService.assertClusterOnlineForRead(clusterId);
    } else {
      readableClusterIds =
        await this.clusterHealthService.listReadableClusterIdsForResourceRead();
      if (readableClusterIds.length === 0) {
        return {
          items: [],
          total: 0,
          page: this.parsePositiveInt(query.page, 1),
          pageSize: this.parsePositiveInt(query.pageSize, 20),
          timestamp: new Date().toISOString(),
        };
      }
    }
    const shouldSync =
      query.sync?.toLowerCase() !== 'false' && Boolean(clusterId);

    const params: StorageListParams = {
      clusterId,
      clusterIds: readableClusterIds,
      namespace: query.namespace,
      kind: query.kind,
      keyword: query.keyword,
      page: this.parsePositiveInt(query.page, 1),
      pageSize: this.parsePositiveInt(query.pageSize, 20),
    };
    const result = await this.storageRepository.list(params);
    void this.refreshStorageSyncState(
      shouldSync,
      clusterId,
      readableClusterIds,
    );
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  private async refreshStorageSyncState(
    shouldSync: boolean,
    clusterId: string | undefined,
    readableClusterIds: string[] | undefined,
  ): Promise<void> {
    if (!shouldSync) {
      return;
    }

    if (clusterId) {
      void this.ensureClusterStorageSynced(clusterId);
      return;
    }

    if (readableClusterIds?.length) {
      void Promise.allSettled(
        readableClusterIds.map((item) => this.ensureClusterStorageSynced(item)),
      );
    }
  }

  private async ensureClusterStorageSynced(clusterId: string): Promise<void> {
    const now = Date.now();
    const last = this.storageSyncAt.get(clusterId) ?? 0;
    // 避免同一集群高频重复同步，10 秒内复用最新结果。
    const dirty = this.clusterEventSyncService.consumeClusterDirty(clusterId);
    if (!dirty && now - last < 2_000) {
      return;
    }

    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new BadRequestException(
        '集群未配置 kubeconfig，无法读取真实存储数据',
      );
    }

    const result = await this.clusterSyncService.syncCluster(
      clusterId,
      kubeconfig,
    );
    const storageErrors = result.errors.filter(
      (item) =>
        item.includes('PersistentVolumes') ||
        item.includes('PersistentVolumeClaims') ||
        item.includes('StorageClasses'),
    );

    if (storageErrors.length > 0) {
      this.logger.warn(
        `storage sync failed for cluster ${clusterId}: ${storageErrors.join(' | ')}`,
      );
      throw new ServiceUnavailableException({
        code: 'STORAGE_SYNC_FAILED',
        message: '从集群同步存储数据失败，请稍后重试',
        details: { clusterId, errors: storageErrors },
      });
    }

    this.storageSyncAt.set(clusterId, now);
  }

  async getById(id: string): Promise<StorageResourceRecord> {
    const item = await this.storageRepository.findById(id);
    if (!item) {
      throw new NotFoundException(`StorageResource ${id} 不存在`);
    }
    return item;
  }

  async create(
    body: CreateStorageResourceRequest,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<StorageMutationResponse> {
    const clusterId = body.clusterId?.trim();
    const name = body.name?.trim();

    if (!clusterId || !name) {
      throw new BadRequestException('clusterId/name 是必填字段');
    }
    if (body.kind !== 'PV' && body.kind !== 'PVC' && body.kind !== 'SC') {
      throw new BadRequestException('kind 必须为 PV、PVC 或 SC');
    }
    if (body.kind === 'PVC' && !body.namespace?.trim()) {
      throw new BadRequestException('PVC 资源必须指定 namespace');
    }

    const data: StorageCreateData = {
      clusterId,
      namespace: body.namespace?.trim() ?? null,
      kind: body.kind,
      name,
      state: 'active',
      capacity: body.capacity,
      accessModes: body.accessModes as string[],
      storageClass: body.storageClass,
      bindingMode: body.bindingMode,
      spec: body.spec as Prisma.InputJsonValue,
    };

    await this.createStorageResourceInCluster(body);

    const item = await this.storageRepository.create(data);
    this.audit(actor, 'create', item.id, 'success');

    return {
      item,
      message: `${item.kind} ${item.name} 创建成功`,
      timestamp: new Date().toISOString(),
    };
  }

  async update(
    id: string,
    body: UpdateStorageResourceRequest,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<StorageMutationResponse> {
    const existing = await this.storageRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`StorageResource ${id} 不存在`);
    }
    if (existing.state === 'deleted') {
      throw new BadRequestException('已删除的资源不可编辑');
    }

    const data: StorageUpdateData = {};
    if ('namespace' in body) {
      data.namespace = body.namespace?.trim() ?? null;
    }
    if (body.capacity !== undefined) {
      const capacity = body.capacity.trim();
      if (!capacity) throw new BadRequestException('capacity 不能为空');
      data.capacity = capacity;
    }
    if (body.accessModes !== undefined) {
      data.accessModes = body.accessModes;
    }
    if (body.storageClass !== undefined) {
      data.storageClass = body.storageClass;
    }
    if (body.bindingMode !== undefined) {
      data.bindingMode = body.bindingMode;
    }
    if (body.spec !== undefined) {
      data.spec = body.spec as Prisma.InputJsonValue;
    }
    if (body.statusJson !== undefined) {
      data.statusJson = body.statusJson as Prisma.InputJsonValue;
    }

    const item = await this.storageRepository.update(id, data);
    this.audit(actor, 'update', item.id, 'success');

    return {
      item,
      message: `${item.kind} ${item.name} 更新成功`,
      timestamp: new Date().toISOString(),
    };
  }

  async applyAction(
    id: string,
    body: StorageActionRequest,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<StorageMutationResponse> {
    const existing = await this.storageRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`StorageResource ${id} 不存在`);
    }

    const { action, reason } = body;

    if (action === 'delete') {
      if (existing.state === 'deleted') {
        throw new BadRequestException('资源已删除');
      }
      await this.deleteStorageResourceInCluster(existing);
      const item = await this.storageRepository.setState(id, 'deleted');
      this.audit(actor, 'delete', id, 'success', reason);
      return {
        item,
        message: `${item.kind} ${item.name} 已删除`,
        timestamp: new Date().toISOString(),
      };
    }

    if (action === 'disable') {
      if (existing.state === 'deleted') {
        throw new BadRequestException('已删除的资源不可禁用');
      }
      const item = await this.storageRepository.setState(id, 'disabled');
      this.audit(actor, 'disable', id, 'success', reason);
      return {
        item,
        message: `${item.kind} ${item.name} 已禁用`,
        timestamp: new Date().toISOString(),
      };
    }

    if (action === 'enable') {
      if (existing.state === 'deleted') {
        throw new BadRequestException('已删除的资源不可启用');
      }
      const item = await this.storageRepository.setState(id, 'active');
      this.audit(actor, 'enable', id, 'success', reason);
      return {
        item,
        message: `${item.kind} ${item.name} 已启用`,
        timestamp: new Date().toISOString(),
      };
    }

    throw new BadRequestException('action 必须为 enable/disable/delete');
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
  }

  private async getApis(clusterId: string): Promise<{
    coreApi: any;
    storageApi: any;
  }> {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new BadRequestException('目标集群未配置 kubeconfig');
    }
    return {
      coreApi: this.k8sClientService.getCoreApi(kubeconfig) as any,
      storageApi: this.k8sClientService.getStorageApi(kubeconfig) as any,
    };
  }

  private async createStorageResourceInCluster(
    body: CreateStorageResourceRequest,
  ): Promise<void> {
    const { coreApi, storageApi } = await this.getApis(body.clusterId);
    const specInput = body.spec ?? {};
    if (body.kind === 'SC') {
      await storageApi.createStorageClass({
        body: {
          apiVersion: 'storage.k8s.io/v1',
          kind: 'StorageClass',
          metadata: { name: body.name },
          provisioner:
            (specInput.provisioner as string | undefined) ??
            'kubernetes.io/no-provisioner',
          volumeBindingMode:
            body.bindingMode ??
            (specInput.volumeBindingMode as string | undefined) ??
            'Immediate',
          reclaimPolicy: 'Delete',
        },
      });
      return;
    }

    if (body.kind === 'PV') {
      await coreApi.createPersistentVolume({
        body: {
          apiVersion: 'v1',
          kind: 'PersistentVolume',
          metadata: { name: body.name },
          spec: {
            capacity: { storage: body.capacity ?? '1Gi' },
            accessModes: body.accessModes ?? ['ReadWriteOnce'],
            persistentVolumeReclaimPolicy: 'Delete',
            storageClassName: body.storageClass ?? '',
            hostPath: { path: `/tmp/${body.name}` },
          },
        },
      });
      return;
    }

    await coreApi.createNamespacedPersistentVolumeClaim({
      namespace: body.namespace,
      body: {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: body.name, namespace: body.namespace },
        spec: {
          accessModes: body.accessModes ?? ['ReadWriteOnce'],
          resources: {
            requests: {
              storage: body.capacity ?? '1Gi',
            },
          },
          ...(body.storageClass ? { storageClassName: body.storageClass } : {}),
        },
      },
    });
  }

  private async deleteStorageResourceInCluster(
    existing: StorageResourceRecord,
  ): Promise<void> {
    const { coreApi, storageApi } = await this.getApis(existing.clusterId);
    if (existing.kind === 'SC') {
      await storageApi.deleteStorageClass({ name: existing.name });
      return;
    }
    if (existing.kind === 'PV') {
      await coreApi.deletePersistentVolume({ name: existing.name });
      return;
    }
    await coreApi.deleteNamespacedPersistentVolumeClaim({
      name: existing.name,
      namespace: existing.namespace ?? 'default',
    });
  }

  private audit(
    actor: { username?: string; role?: PlatformRole } | undefined,
    action: 'create' | 'update' | 'delete' | 'disable' | 'enable',
    resourceId: string,
    result: 'success' | 'failure',
    reason?: string,
  ): void {
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action,
      resourceType: 'storage-resource',
      resourceId,
      result,
      reason,
    });
  }
}
