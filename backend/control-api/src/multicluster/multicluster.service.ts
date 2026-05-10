import { BadRequestException, Injectable } from '@nestjs/common';
import { ClustersService } from '../clusters/clusters.service';
import { PrismaService } from '../platform/database/prisma.service';

type ResourceDomain = 'workload' | 'network' | 'storage' | 'config';

export interface MultiClusterQueryRequest {
  clusterIds?: string[];
  domain?: ResourceDomain;
  kind?: string;
  namespace?: string;
  keyword?: string;
  limitPerCluster?: number;
}

export interface MultiClusterQueryItem {
  id: string;
  clusterId: string;
  namespace?: string;
  kind: string;
  name: string;
  state: string;
  source: ResourceDomain;
  createdAt: string;
  updatedAt: string;
}

export interface MultiClusterPartialError {
  clusterId: string;
  code: string;
  message: string;
}

export interface MultiClusterQueryResponse {
  items: MultiClusterQueryItem[];
  partialErrors: MultiClusterPartialError[];
  total: number;
  timestamp: string;
}

@Injectable()
export class MultiClusterService {
  constructor(
    private readonly clustersService: ClustersService,
    private readonly prisma: PrismaService,
  ) {}

  async query(
    body: MultiClusterQueryRequest,
  ): Promise<MultiClusterQueryResponse> {
    const clusterIds = Array.isArray(body.clusterIds)
      ? Array.from(
          new Set(body.clusterIds.map((id) => id.trim()).filter(Boolean)),
        )
      : [];
    if (clusterIds.length === 0) {
      throw new BadRequestException('clusterIds 不能为空');
    }
    const domain = this.normalizeDomain(body.domain);
    const namespace = body.namespace?.trim() || undefined;
    const keyword = body.keyword?.trim() || undefined;
    const kind = body.kind?.trim() || undefined;
    const limitPerCluster = this.parsePositiveInt(body.limitPerCluster, 200);

    const items: MultiClusterQueryItem[] = [];
    const partialErrors: MultiClusterPartialError[] = [];

    for (const clusterId of clusterIds) {
      const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
      if (!kubeconfig) {
        partialErrors.push({
          clusterId,
          code: 'CLUSTER_KUBECONFIG_MISSING',
          message: '集群未配置 kubeconfig',
        });
        continue;
      }

      try {
        const query = this.buildWhere(clusterId, namespace, keyword, kind);
        const collected = await this.fetchByDomain(
          domain,
          query,
          limitPerCluster,
        );
        items.push(...collected);
      } catch (error) {
        partialErrors.push({
          clusterId,
          code: 'MULTICLUSTER_QUERY_FAILED',
          message: error instanceof Error ? error.message : '未知错误',
        });
      }
    }

    return {
      items,
      partialErrors,
      total: items.length,
      timestamp: new Date().toISOString(),
    };
  }

  private normalizeDomain(value: string | undefined): ResourceDomain {
    if (!value || value === 'workload') return 'workload';
    if (value === 'network' || value === 'storage' || value === 'config') {
      return value;
    }
    throw new BadRequestException(
      'domain 仅支持 workload/network/storage/config',
    );
  }

  private parsePositiveInt(
    value: number | undefined,
    fallback: number,
  ): number {
    if (!Number.isFinite(value) || !value || value <= 0) {
      return fallback;
    }
    return Math.floor(value);
  }

  private buildWhere(
    clusterId: string,
    namespace?: string,
    keyword?: string,
    kind?: string,
  ) {
    const where: Record<string, unknown> = {
      clusterId,
      state: { not: 'deleted' },
    };
    if (namespace) {
      where.namespace = namespace;
    }
    if (kind) {
      where.kind = kind;
    }
    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { kind: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private async fetchByDomain(
    domain: ResourceDomain,
    where: Record<string, unknown>,
    limit: number,
  ): Promise<MultiClusterQueryItem[]> {
    if (domain === 'workload') {
      const rows = await this.prisma.workloadRecord.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit,
      });
      return rows.map((row) => this.toItem('workload', row));
    }
    if (domain === 'network') {
      const rows = await this.prisma.networkResource.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit,
      });
      return rows.map((row) => this.toItem('network', row));
    }
    if (domain === 'storage') {
      const rows = await this.prisma.storageResource.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit,
      });
      return rows.map((row) => this.toItem('storage', row));
    }
    const rows = await this.prisma.configResource.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((row) => this.toItem('config', row));
  }

  private toItem(
    source: ResourceDomain,
    row: {
      id: string;
      clusterId: string;
      namespace: string | null;
      kind: string;
      name: string;
      state: string;
      createdAt: Date;
      updatedAt: Date;
    },
  ): MultiClusterQueryItem {
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace ?? undefined,
      kind: row.kind,
      name: row.name,
      state: row.state,
      source,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
