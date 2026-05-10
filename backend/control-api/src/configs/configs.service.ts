import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as k8s from '@kubernetes/client-node';
import { ClusterHealthService } from '../clusters/cluster-health.service';
import { ClusterEventSyncService } from '../clusters/cluster-event-sync.service';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';
import { K8sClientService } from '../clusters/k8s-client.service';
import { appendAudit, type PlatformRole } from '../common/governance';
import {
  ConfigsRepository,
  type ConfigCreateData,
  type ConfigListParams,
  type ConfigResourceRecord,
  type ConfigRevisionRecord,
  type ConfigUpdateData,
} from './configs.repository';

export interface ConfigListQuery {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
}

export interface ConfigListResult {
  items: ConfigResourceRecord[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

export interface ConfigMutationResponse {
  item: ConfigResourceRecord;
  message: string;
  timestamp: string;
}

export interface CreateConfigResourceRequest {
  clusterId: string;
  namespace: string;
  kind: 'ConfigMap' | 'Secret';
  name: string;
  dataKeys?: string[];
  data?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface UpdateConfigResourceRequest {
  namespace?: string;
  dataKeys?: string[];
  data?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface ConfigActionRequest {
  action: 'enable' | 'disable' | 'delete';
  reason?: string;
}

export interface RevisionDiffResult {
  from: ConfigRevisionRecord | null;
  to: ConfigRevisionRecord | null;
  diff: Record<string, { before: unknown; after: unknown }>;
}

@Injectable()
export class ConfigsService {
  private readonly logger = new Logger(ConfigsService.name);
  private readonly configsSyncAt = new Map<string, number>();

  constructor(
    private readonly configsRepository: ConfigsRepository,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly clustersService: ClustersService,
    private readonly clusterSyncService: ClusterSyncService,
    private readonly clusterEventSyncService: ClusterEventSyncService,
    private readonly k8sClientService: K8sClientService,
  ) {}

  async list(query: ConfigListQuery): Promise<ConfigListResult> {
    const normalizedClusterId = query.clusterId?.trim();
    let readableClusterIds: string[] | undefined;
    if (normalizedClusterId) {
      await this.clusterHealthService.assertClusterOnlineForRead(
        normalizedClusterId,
      );
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

    const params: ConfigListParams = {
      clusterId: normalizedClusterId,
      clusterIds: readableClusterIds,
      namespace: query.namespace,
      kind: query.kind,
      keyword: query.keyword,
      page: this.parsePositiveInt(query.page, 1),
      pageSize: this.parsePositiveInt(query.pageSize, 20),
    };
    const result = await this.configsRepository.list(params);
    void this.refreshConfigSyncState(normalizedClusterId, readableClusterIds);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  private async refreshConfigSyncState(
    normalizedClusterId: string | undefined,
    readableClusterIds: string[] | undefined,
  ): Promise<void> {
    if (normalizedClusterId) {
      void this.ensureClusterConfigsSynced(normalizedClusterId);
      return;
    }

    if (readableClusterIds?.length) {
      void Promise.allSettled(
        readableClusterIds.map((clusterId) =>
          this.ensureClusterConfigsSynced(clusterId),
        ),
      );
    }
  }

  private async ensureClusterConfigsSynced(clusterId: string): Promise<void> {
    const now = Date.now();
    const last = this.configsSyncAt.get(clusterId) ?? 0;
    const dirty = this.clusterEventSyncService.consumeClusterDirty(clusterId);
    if (!dirty && now - last < 2_000) {
      return;
    }

    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      return;
    }

    const result = await this.syncConfigsInventory(clusterId, kubeconfig);
    if (result.errors.length > 0) {
      this.logger.warn(
        `config sync failed for cluster ${clusterId}: ${result.errors.join(' | ')}`,
      );
    }
    this.configsSyncAt.set(clusterId, now);
  }

  private async syncConfigsInventory(
    clusterId: string,
    kubeconfig: string,
  ): Promise<{ errors: string[] }> {
    const syncResult = await this.clusterSyncService.syncCluster(
      clusterId,
      kubeconfig,
    );
    const configErrors = syncResult.errors.filter(
      (item) => item.includes('ConfigMaps') || item.includes('Secrets'),
    );
    return { errors: configErrors };
  }

  async getById(id: string): Promise<ConfigResourceRecord> {
    const item = await this.configsRepository.findById(id);
    if (!item) {
      throw new NotFoundException(`ConfigResource ${id} 不存在`);
    }
    return item;
  }

  async create(
    body: CreateConfigResourceRequest,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<ConfigMutationResponse> {
    const clusterId = body.clusterId?.trim();
    const namespace = body.namespace?.trim();
    const name = body.name?.trim();

    if (!clusterId || !namespace || !name) {
      throw new BadRequestException('clusterId/namespace/name 是必填字段');
    }
    if (body.kind !== 'ConfigMap' && body.kind !== 'Secret') {
      throw new BadRequestException('kind 必须为 ConfigMap 或 Secret');
    }

    // 检查是否已存在
    const existing = await this.configsRepository.findByKey(
      clusterId,
      namespace,
      body.kind,
      name,
    );
    if (existing && existing.state !== 'deleted') {
      throw new BadRequestException(`${body.kind} ${namespace}/${name} 已存在`);
    }

    const data: ConfigCreateData = {
      clusterId,
      namespace,
      kind: body.kind,
      name,
      state: 'active',
      dataKeys: body.dataKeys
        ? (body.dataKeys as Prisma.InputJsonValue)
        : undefined,
      labels: body.labels ? (body.labels as Prisma.InputJsonValue) : undefined,
    };

    const initialData = body.data
      ? (body.data as Prisma.InputJsonValue)
      : undefined;

    await this.createConfigInCluster(body);

    const item = await this.configsRepository.create(data, initialData);
    this.audit(actor, 'create', item.id, 'success');

    return {
      item,
      message: `${item.kind} ${item.name} 创建成功`,
      timestamp: new Date().toISOString(),
    };
  }

  async update(
    id: string,
    body: UpdateConfigResourceRequest,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<ConfigMutationResponse> {
    const existing = await this.configsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`ConfigResource ${id} 不存在`);
    }
    if (existing.state === 'deleted') {
      throw new BadRequestException('已删除的配置不可编辑');
    }

    const data: ConfigUpdateData = {};
    if (body.namespace !== undefined) {
      const ns = body.namespace.trim();
      if (!ns) throw new BadRequestException('namespace 不能为空');
      data.namespace = ns;
    }
    if (body.dataKeys !== undefined) {
      data.dataKeys = body.dataKeys as Prisma.InputJsonValue;
    }
    if (body.labels !== undefined) {
      data.labels = body.labels as Prisma.InputJsonValue;
    }

    await this.updateConfigInCluster(existing, body);

    const item = await this.configsRepository.update(id, data, actor?.username);
    this.audit(actor, 'update', item.id, 'success');

    return {
      item,
      message: `${item.kind} ${item.name} 更新成功`,
      timestamp: new Date().toISOString(),
    };
  }

  async applyAction(
    id: string,
    body: ConfigActionRequest,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<ConfigMutationResponse> {
    const existing = await this.configsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`ConfigResource ${id} 不存在`);
    }

    const { action, reason } = body;

    if (action === 'delete') {
      if (existing.state === 'deleted') {
        throw new BadRequestException('配置已删除');
      }
      await this.deleteConfigInCluster(existing);
      const item = await this.configsRepository.setState(id, 'deleted');
      this.audit(actor, 'delete', id, 'success', reason);
      return {
        item,
        message: `${item.kind} ${item.name} 已删除`,
        timestamp: new Date().toISOString(),
      };
    }

    if (action === 'disable') {
      if (existing.state === 'deleted') {
        throw new BadRequestException('已删除的配置不可禁用');
      }
      const item = await this.configsRepository.setState(id, 'disabled');
      this.audit(actor, 'disable', id, 'success', reason);
      return {
        item,
        message: `${item.kind} ${item.name} 已禁用`,
        timestamp: new Date().toISOString(),
      };
    }

    if (action === 'enable') {
      if (existing.state === 'deleted') {
        throw new BadRequestException('已删除的配置不可启用');
      }
      const item = await this.configsRepository.setState(id, 'active');
      this.audit(actor, 'enable', id, 'success', reason);
      return {
        item,
        message: `${item.kind} ${item.name} 已启用`,
        timestamp: new Date().toISOString(),
      };
    }

    throw new BadRequestException('action 必须为 enable/disable/delete');
  }

  private async getCoreApi(clusterId: string): Promise<k8s.CoreV1Api> {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new BadRequestException('目标集群未配置 kubeconfig');
    }
    return this.k8sClientService.getCoreApi(kubeconfig);
  }

  private async createConfigInCluster(
    body: CreateConfigResourceRequest,
  ): Promise<void> {
    const clusterId = body.clusterId.trim();
    const namespace = body.namespace.trim();
    const name = body.name.trim();
    const coreApi = (await this.getCoreApi(clusterId)) as any;

    if (body.kind === 'ConfigMap') {
      await coreApi.createNamespacedConfigMap({
        namespace,
        body: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name, namespace, labels: body.labels ?? {} },
          data: body.data ?? {},
        },
      });
      return;
    }

    await coreApi.createNamespacedSecret({
      namespace,
      body: {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name, namespace, labels: body.labels ?? {} },
        type: 'Opaque',
        data: body.data ?? {},
      },
    });
  }

  private async updateConfigInCluster(
    existing: ConfigResourceRecord,
    body: UpdateConfigResourceRequest,
  ): Promise<void> {
    if (body.namespace && body.namespace !== existing.namespace) {
      throw new BadRequestException('暂不支持跨名称空间直接修改，请新建后迁移');
    }
    const coreApi = (await this.getCoreApi(existing.clusterId)) as any;
    if (existing.kind === 'ConfigMap') {
      const current = await coreApi.readNamespacedConfigMap({
        name: existing.name,
        namespace: existing.namespace,
      });
      const obj = current?.body ?? current;
      await coreApi.replaceNamespacedConfigMap({
        name: existing.name,
        namespace: existing.namespace,
        body: {
          ...obj,
          metadata: {
            ...(obj?.metadata ?? {}),
            labels: body.labels ?? obj?.metadata?.labels ?? {},
          },
          ...(body.data ? { data: body.data } : {}),
        },
      });
      return;
    }

    const current = await coreApi.readNamespacedSecret({
      name: existing.name,
      namespace: existing.namespace,
    });
    const obj = current?.body ?? current;
    await coreApi.replaceNamespacedSecret({
      name: existing.name,
      namespace: existing.namespace,
      body: {
        ...obj,
        metadata: {
          ...(obj?.metadata ?? {}),
          labels: body.labels ?? obj?.metadata?.labels ?? {},
        },
        ...(body.data ? { data: body.data } : {}),
      },
    });
  }

  private async deleteConfigInCluster(
    existing: ConfigResourceRecord,
  ): Promise<void> {
    const coreApi = (await this.getCoreApi(existing.clusterId)) as any;
    if (existing.kind === 'ConfigMap') {
      await coreApi.deleteNamespacedConfigMap({
        name: existing.name,
        namespace: existing.namespace,
      });
      return;
    }
    await coreApi.deleteNamespacedSecret({
      name: existing.name,
      namespace: existing.namespace,
    });
  }

  async getRevisions(id: string): Promise<{
    configId: string;
    items: ConfigRevisionRecord[];
    total: number;
    timestamp: string;
  }> {
    // 验证 config 存在
    const config = await this.configsRepository.findById(id);
    if (!config) {
      throw new NotFoundException(`ConfigResource ${id} 不存在`);
    }

    const revisions = await this.configsRepository.getRevisions(id);
    return {
      configId: id,
      items: revisions,
      total: revisions.length,
      timestamp: new Date().toISOString(),
    };
  }

  async getRevisionDiff(
    id: string,
    fromRev: number,
    toRev: number,
  ): Promise<RevisionDiffResult> {
    // 验证 config 存在
    const config = await this.configsRepository.findById(id);
    if (!config) {
      throw new NotFoundException(`ConfigResource ${id} 不存在`);
    }

    const [fromRevision, toRevision] = await Promise.all([
      this.configsRepository.getRevision(id, fromRev),
      this.configsRepository.getRevision(id, toRev),
    ]);

    const diff = this.computeDiff(fromRevision?.data, toRevision?.data);

    return {
      from: fromRevision,
      to: toRevision,
      diff,
    };
  }

  async rollback(
    id: string,
    revision: number,
    changedBy?: string,
  ): Promise<ConfigMutationResponse> {
    const existing = await this.configsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`ConfigResource ${id} 不存在`);
    }
    if (existing.state === 'deleted') {
      throw new BadRequestException('已删除的配置不可回滚');
    }

    const targetRev = await this.configsRepository.getRevision(id, revision);
    if (!targetRev) {
      throw new NotFoundException(`版本 ${revision} 不存在`);
    }

    const item = await this.configsRepository.rollback(id, revision, changedBy);

    return {
      item,
      message: `${item.kind} ${item.name} 已回滚到版本 ${revision}`,
      timestamp: new Date().toISOString(),
    };
  }

  private computeDiff(
    fromData: Prisma.JsonValue | null | undefined,
    toData: Prisma.JsonValue | null | undefined,
  ): Record<string, { before: unknown; after: unknown }> {
    const from =
      fromData && typeof fromData === 'object' && !Array.isArray(fromData)
        ? (fromData as Record<string, unknown>)
        : {};
    const to =
      toData && typeof toData === 'object' && !Array.isArray(toData)
        ? (toData as Record<string, unknown>)
        : {};

    const diff: Record<string, { before: unknown; after: unknown }> = {};
    const allKeys = new Set([...Object.keys(from), ...Object.keys(to)]);

    for (const key of allKeys) {
      const before = from[key] ?? null;
      const after = to[key] ?? null;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        diff[key] = { before, after };
      }
    }

    return diff;
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
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
      resourceType: 'config-resource',
      resourceId,
      result,
      reason,
    });
  }
}
