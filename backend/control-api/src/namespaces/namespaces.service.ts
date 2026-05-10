import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { ClusterHealthService } from '../clusters/cluster-health.service';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';
import { K8sClientService } from '../clusters/k8s-client.service';
import {
  appendAudit,
  assertWritePermission,
  type PlatformRole,
} from '../common/governance';
import { PrismaService } from '../platform/database/prisma.service';

export interface NamespaceListQuery {
  clusterId?: string;
  keyword?: string;
}

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

interface Actor {
  username?: string;
  role?: PlatformRole;
}

export interface CreateNamespaceRequest {
  clusterId: string;
  namespace: string;
  labels?: Record<string, string>;
}

export interface UpdateNamespaceRequest {
  labels: Record<string, string>;
}

@Injectable()
export class NamespacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly clusterSyncService: ClusterSyncService,
    private readonly clustersService: ClustersService,
    private readonly k8sClientService: K8sClientService,
  ) {}

  async list(query: NamespaceListQuery): Promise<NamespaceListItem[]> {
    const keyword = query.keyword?.trim();
    const normalizedClusterId = query.clusterId?.trim();
    let readableClusterIds: string[] | undefined;
    if (normalizedClusterId) {
      await this.clusterHealthService.assertClusterOnlineForRead(
        normalizedClusterId,
      );
      readableClusterIds = [normalizedClusterId];
    } else {
      readableClusterIds =
        await this.clusterHealthService.listReadableClusterIdsForResourceRead();
      if (readableClusterIds.length === 0) {
        return [];
      }
    }
    const rows = await this.prisma.namespaceRecord.findMany({
      where: {
        clusterId: { in: readableClusterIds },
        state: { not: 'deleted' },
        cluster: {
          deletedAt: null,
          status: { not: 'deleted' },
        },
        ...(keyword
          ? {
              name: {
                contains: keyword,
              },
            }
          : {}),
      },
      select: {
        id: true,
        clusterId: true,
        name: true,
        state: true,
        labels: true,
        createdAt: true,
        updatedAt: true,
        cluster: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ cluster: { name: 'asc' } }, { name: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      clusterId: row.clusterId,
      clusterName: row.cluster.name,
      namespace: row.name,
      state: row.state,
      labels: this.normalizeLabels(row.labels),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async create(
    actor: Actor | undefined,
    body: CreateNamespaceRequest,
  ): Promise<NamespaceListItem> {
    assertWritePermission(actor);
    const clusterId = body.clusterId?.trim();
    const namespace = body.namespace?.trim();
    if (!clusterId || !namespace) {
      throw new BadRequestException('clusterId 与 namespace 为必填项');
    }

    const cluster = await this.prisma.clusterRegistry.findFirst({
      where: { id: clusterId, deletedAt: null, status: { not: 'deleted' } },
      select: { id: true, name: true },
    });
    if (!cluster) {
      throw new NotFoundException('目标集群不存在');
    }

    const existing = await this.prisma.namespaceRecord.findFirst({
      where: {
        clusterId,
        name: namespace,
      },
    });
    if (existing && existing.state !== 'deleted') {
      throw new BadRequestException('该名称空间已存在');
    }

    const labels = this.normalizeLabels(body.labels);
    await this.createNamespaceInCluster(clusterId, namespace, labels);
    const row = existing
      ? await this.prisma.namespaceRecord.update({
          where: { id: existing.id },
          data: { state: 'active', labels },
          select: {
            id: true,
            clusterId: true,
            name: true,
            state: true,
            labels: true,
            createdAt: true,
            updatedAt: true,
            cluster: { select: { name: true } },
          },
        })
      : await this.prisma.namespaceRecord.create({
          data: {
            clusterId,
            name: namespace,
            state: 'active',
            labels,
          },
          select: {
            id: true,
            clusterId: true,
            name: true,
            state: true,
            labels: true,
            createdAt: true,
            updatedAt: true,
            cluster: { select: { name: true } },
          },
        });

    this.audit(actor, 'create', row.id);
    this.triggerClusterSync(row.clusterId);
    return {
      id: row.id,
      clusterId: row.clusterId,
      clusterName: row.cluster.name,
      namespace: row.name,
      state: row.state,
      labels: this.normalizeLabels(row.labels),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async update(
    actor: Actor | undefined,
    id: string,
    body: UpdateNamespaceRequest,
  ): Promise<NamespaceListItem> {
    assertWritePermission(actor);
    const record = await this.prisma.namespaceRecord.findUnique({
      where: { id },
      select: {
        id: true,
        clusterId: true,
        name: true,
        state: true,
      },
    });
    if (!record || record.state === 'deleted') {
      throw new NotFoundException('名称空间不存在');
    }

    const labels = this.normalizeLabels(body.labels);
    await this.patchNamespaceLabelsInCluster(
      record.clusterId,
      record.name,
      labels,
    );
    const row = await this.prisma.namespaceRecord.update({
      where: { id },
      data: { labels },
      select: {
        id: true,
        clusterId: true,
        name: true,
        state: true,
        labels: true,
        createdAt: true,
        updatedAt: true,
        cluster: { select: { name: true } },
      },
    });

    this.audit(actor, 'update', id);
    this.triggerClusterSync(row.clusterId);
    return {
      id: row.id,
      clusterId: row.clusterId,
      clusterName: row.cluster.name,
      namespace: row.name,
      state: row.state,
      labels: this.normalizeLabels(row.labels),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async remove(actor: Actor | undefined, id: string): Promise<{ id: string }> {
    assertWritePermission(actor);
    const record = await this.prisma.namespaceRecord.findUnique({
      where: { id },
      select: { id: true, state: true },
    });
    if (!record || record.state === 'deleted') {
      throw new NotFoundException('名称空间不存在');
    }

    await this.deleteNamespaceInCluster(id);

    const namespaceRow = await this.prisma.namespaceRecord.findUnique({
      where: { id },
      select: { clusterId: true, name: true },
    });
    if (!namespaceRow) {
      throw new NotFoundException('名称空间不存在');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.namespaceRecord.update({
        where: { id },
        data: { state: 'deleted' },
      });

      await Promise.all([
        tx.workloadRecord.updateMany({
          where: {
            clusterId: namespaceRow.clusterId,
            namespace: namespaceRow.name,
            state: { not: 'deleted' },
          },
          data: { state: 'deleted' },
        }),
        tx.networkResource.updateMany({
          where: {
            clusterId: namespaceRow.clusterId,
            namespace: namespaceRow.name,
            state: { not: 'deleted' },
          },
          data: { state: 'deleted' },
        }),
        tx.configResource.updateMany({
          where: {
            clusterId: namespaceRow.clusterId,
            namespace: namespaceRow.name,
            state: { not: 'deleted' },
          },
          data: { state: 'deleted' },
        }),
        tx.storageResource.updateMany({
          where: {
            clusterId: namespaceRow.clusterId,
            namespace: namespaceRow.name,
            state: { not: 'deleted' },
          },
          data: { state: 'deleted' },
        }),
      ]);
    });
    this.audit(actor, 'delete', id);
    this.triggerClusterSync(namespaceRow.clusterId);
    return { id };
  }

  private triggerClusterSync(clusterId: string): void {
    void (async () => {
      const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
      if (!kubeconfig) {
        return;
      }
      await this.clusterSyncService.syncCluster(clusterId, kubeconfig);
    })().catch(() => {
      // 这里是异步补偿刷新，不影响主流程返回。
    });
  }

  private normalizeLabels(input: unknown): Record<string, string> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }
    const raw = input as Record<string, unknown>;
    const result: Record<string, string> = {};
    Object.entries(raw).forEach(([key, value]) => {
      const k = key.trim();
      if (!k) return;
      if (typeof value === 'string') {
        result[k] = value;
      } else if (value !== undefined && value !== null) {
        result[k] = String(value);
      }
    });
    return result;
  }

  private audit(
    actor: Actor | undefined,
    action: 'create' | 'update' | 'delete',
    resourceId: string,
  ) {
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'platform-admin',
      action,
      resourceType: 'namespaces',
      resourceId,
      result: 'success',
    });
  }

  private async getCoreApi(clusterId: string): Promise<k8s.CoreV1Api> {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new BadRequestException('目标集群未配置 kubeconfig');
    }
    return this.k8sClientService.getCoreApi(kubeconfig);
  }

  private async createNamespaceInCluster(
    clusterId: string,
    namespace: string,
    labels: Record<string, string>,
  ): Promise<void> {
    const coreApi = (await this.getCoreApi(clusterId)) as any;
    try {
      await coreApi.createNamespace({
        body: {
          metadata: {
            name: namespace,
            labels,
          },
        },
      });
      return;
    } catch (error) {
      const status = error?.statusCode ?? error?.response?.statusCode;
      if (status === 409) {
        // Namespace already exists in cluster; continue to DB upsert.
        return;
      }
      throw new BadRequestException(
        `创建名称空间失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private async patchNamespaceLabelsInCluster(
    clusterId: string,
    namespace: string,
    labels: Record<string, string>,
  ): Promise<void> {
    const coreApi = (await this.getCoreApi(clusterId)) as any;
    try {
      const current = await coreApi.readNamespace({ name: namespace });
      const nsBody = current?.body ?? current;
      const next = {
        ...nsBody,
        metadata: {
          ...(nsBody?.metadata ?? {}),
          labels,
        },
      };
      await coreApi.replaceNamespace({ name: namespace, body: next });
    } catch (error) {
      throw new BadRequestException(
        `更新名称空间标签失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private async deleteNamespaceInCluster(id: string): Promise<void> {
    const record = await this.prisma.namespaceRecord.findUnique({
      where: { id },
      select: { clusterId: true, name: true },
    });
    if (!record) return;
    const coreApi = (await this.getCoreApi(record.clusterId)) as any;
    try {
      await coreApi.deleteNamespace({ name: record.name });
    } catch (error) {
      const status = error?.statusCode ?? error?.response?.statusCode;
      if (status === 404) {
        return;
      }
      throw new BadRequestException(
        `删除名称空间失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private extractK8sErrorMessage(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return 'unknown error';
    }
    const err = error as Record<string, any>;
    const bodyMessage =
      err.response?.body?.message ??
      err.body?.message ??
      err.message ??
      'unknown error';
    return String(bodyMessage);
  }
}
