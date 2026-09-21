import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ClustersService } from '../clusters/clusters.service';
import { PrismaService } from '../platform/database/prisma.service';
import { ClusterAccessService, type ClusterAccessSubject } from '../common/cluster-access.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';

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
    private readonly clusterAccess: ClusterAccessService,
    private readonly authorization: AuthorizationService,
    private readonly namespaceIdentity: NamespaceIdentityService,
  ) {}

  async query(
    body: MultiClusterQueryRequest,
    actor: ClusterAccessSubject,
  ): Promise<MultiClusterQueryResponse> {
    if (!actor?.id?.trim() || !this.clusterAccess.isKnownPlatformRole(actor)) {
      throw new ForbiddenException();
    }
    if (!body || !Array.isArray(body.clusterIds) ||
      body.clusterIds.some(id => typeof id !== 'string') ||
      [body.domain, body.namespace, body.keyword, body.kind].some(value => value !== undefined && typeof value !== 'string')) {
      throw new BadRequestException('查询参数格式不正确');
    }
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
    const scopes = await this.resolveScopes(actor, clusterIds, domain, namespace, kind);

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
        if (scopes) query.AND = [{ OR: scopes.get(clusterId)! }];
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

  private async resolveScopes(
    actor: ClusterAccessSubject,
    clusterIds: string[],
    domain: ResourceDomain,
    namespace?: string,
    kind?: string,
  ): Promise<Map<string, Array<{ namespace?: string; kind?: string }>> | undefined> {
    if (this.clusterAccess.isPlatformAdmin(actor)) return undefined;
    const full = new Set(await this.clusterAccess.listAccessibleClusterIds(actor));
    const grants = await this.authorization.listEffectiveGrants(actor.id!);
    const result = new Map<string, Array<{ namespace?: string; kind?: string }>>();
    for (const clusterId of clusterIds) {
      const scopes: Array<{ namespace?: string; kind?: string }> = [];
      if (full.has(clusterId)) scopes.push(domain === 'config' ? { kind: 'ConfigMap' } : {});
      const checked = new Map<string, string | null>();
      for (const grant of grants) {
        if (grant.clusterId !== clusterId) continue;
        for (const scope of grant.namespaces) {
          if (!scope.namespaceName || (namespace && scope.namespaceName !== namespace)) continue;
          if (!checked.has(scope.namespaceName)) {
            try {
              checked.set(scope.namespaceName, await this.namespaceIdentity.resolve(clusterId, scope.namespaceName));
            } catch {
              checked.set(scope.namespaceName, null);
            }
          }
          if (checked.get(scope.namespaceName) !== scope.namespaceUid) continue;
          scopes.push({ namespace: scope.namespaceName, ...(domain === 'config' ? { kind: 'ConfigMap' } : domain === 'storage' ? { kind: 'PVC' } : {}) });
          if (domain === 'config' && grant.capabilities.some(item => item.capability === 'secrets')) {
            scopes.push({ namespace: scope.namespaceName, kind: 'Secret' });
          }
        }
      }
      const allowed = scopes.filter(scope => (!namespace || !scope.namespace || namespace === scope.namespace) && (!kind || !scope.kind || kind === scope.kind));
      if (!allowed.length) throw new ForbiddenException('资源不在授权范围内');
      result.set(clusterId, allowed);
    }
    return result;
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
