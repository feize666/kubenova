import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClusterHealthService } from '../clusters/cluster-health.service';
import { PrismaService } from '../platform/database/prisma.service';

type SummaryNamespace = string | null;

type SummaryResourceGroup = 'gateway' | 'network' | 'workload' | 'pod';

interface SummaryBucket {
  clusterId: string | null;
  namespace: SummaryNamespace;
  resourceCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  gatewayCount: number;
  networkCount: number;
  workloadCount: number;
  podCount: number;
  abnormalCount: number;
  updatedAt: Date | null;
}

interface SummaryResourceInput {
  clusterId: string;
  namespace: SummaryNamespace;
  kind: string;
  state: string | null;
  statusJson?: Prisma.JsonValue | null;
  replicas?: number | null;
  readyReplicas?: number | null;
  updatedAt: Date;
}

export interface TopologyNamespaceSummaryItem {
  clusterId: string | null;
  namespace: SummaryNamespace;
  resourceCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  gatewayCount: number;
  networkCount: number;
  workloadCount: number;
  podCount: number;
  abnormalCount: number;
  updatedAt: string | null;
}

export interface TopologyNamespaceSummaryResponse {
  items: TopologyNamespaceSummaryItem[];
  timestamp: string;
}

export interface TopologyNamespaceSummaryQuery {
  clusterId?: string;
}

const HEALTHY_STATUSES = new Set([
  'accepted',
  'active',
  'available',
  'bound',
  'ready',
  'running',
  'succeeded',
]);

const UNHEALTHY_STATUSES = new Set([
  'disabled',
  'error',
  'failed',
  'failure',
  'notready',
  'pending',
  'terminating',
  'unknown',
]);

@Injectable()
export class TopologySummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clusterHealthService: ClusterHealthService,
  ) {}

  async listNamespaceSummaries(
    query: TopologyNamespaceSummaryQuery = {},
  ): Promise<TopologyNamespaceSummaryResponse> {
    const clusterIds = await this.resolveReadableClusterIds(query.clusterId);
    if (clusterIds.length === 0) {
      return { items: [], timestamp: new Date().toISOString() };
    }

    const [namespaces, workloads, networkResources, storageResources, configs] =
      await Promise.all([
        this.prisma.namespaceRecord.findMany({
          where: this.clusterScopedWhere(clusterIds),
          select: {
            clusterId: true,
            name: true,
            state: true,
            updatedAt: true,
          },
        }),
        this.prisma.workloadRecord.findMany({
          where: this.resourceWhere(clusterIds),
          select: {
            clusterId: true,
            namespace: true,
            kind: true,
            state: true,
            statusJson: true,
            replicas: true,
            readyReplicas: true,
            updatedAt: true,
          },
        }),
        this.prisma.networkResource.findMany({
          where: this.resourceWhere(clusterIds),
          select: {
            clusterId: true,
            namespace: true,
            kind: true,
            state: true,
            statusJson: true,
            updatedAt: true,
          },
        }),
        this.prisma.storageResource.findMany({
          where: this.resourceWhere(clusterIds),
          select: {
            clusterId: true,
            namespace: true,
            kind: true,
            state: true,
            statusJson: true,
            updatedAt: true,
          },
        }),
        this.prisma.configResource.findMany({
          where: this.resourceWhere(clusterIds),
          select: {
            clusterId: true,
            namespace: true,
            kind: true,
            state: true,
            updatedAt: true,
          },
        }),
      ]);

    const buckets = new Map<string, SummaryBucket>();
    const includeClusterId = clusterIds.length !== 1;

    for (const namespace of namespaces) {
      const bucket = this.getBucket(
        buckets,
        namespace.clusterId,
        namespace.name,
        includeClusterId,
      );
      this.bumpStatus(bucket, namespace.state);
      this.bumpUpdatedAt(bucket, namespace.updatedAt);
    }

    for (const row of workloads) {
      this.addResource(buckets, row, includeClusterId);
    }
    for (const row of networkResources) {
      this.addResource(buckets, row, includeClusterId);
    }
    for (const row of storageResources) {
      this.addResource(buckets, row, includeClusterId);
    }
    for (const row of configs) {
      this.addResource(buckets, row, includeClusterId);
    }

    return {
      items: Array.from(buckets.values())
        .map((bucket) => this.toItem(bucket))
        .sort((left, right) =>
          `${left.clusterId ?? ''}/${left.namespace ?? ''}`.localeCompare(
            `${right.clusterId ?? ''}/${right.namespace ?? ''}`,
          ),
        ),
      timestamp: new Date().toISOString(),
    };
  }

  private async resolveReadableClusterIds(
    clusterId?: string,
  ): Promise<string[]> {
    const normalizedClusterId = clusterId?.trim();
    if (normalizedClusterId) {
      await this.clusterHealthService.assertClusterOnlineForRead(
        normalizedClusterId,
      );
      return [normalizedClusterId];
    }

    return this.clusterHealthService.listReadableClusterIdsForResourceRead();
  }

  private clusterScopedWhere(clusterIds: string[]) {
    return {
      clusterId: { in: clusterIds },
      state: { not: 'deleted' },
      cluster: { deletedAt: null, status: { not: 'deleted' } },
    };
  }

  private resourceWhere(clusterIds: string[]) {
    if (!Array.isArray(clusterIds)) {
      throw new BadRequestException('clusterIds 必须为数组');
    }
    return this.clusterScopedWhere(clusterIds);
  }

  private addResource(
    buckets: Map<string, SummaryBucket>,
    resource: SummaryResourceInput,
    includeClusterId: boolean,
  ): void {
    const bucket = this.getBucket(
      buckets,
      resource.clusterId,
      resource.namespace,
      includeClusterId,
    );
    bucket.resourceCounts[resource.kind] =
      (bucket.resourceCounts[resource.kind] ?? 0) + 1;
    this.bumpStatus(bucket, this.resolveStatus(resource));
    this.bumpGroup(bucket, resource.kind);
    if (this.isAbnormal(resource)) {
      bucket.abnormalCount += 1;
    }
    this.bumpUpdatedAt(bucket, resource.updatedAt);
  }

  private getBucket(
    buckets: Map<string, SummaryBucket>,
    clusterId: string,
    namespace: SummaryNamespace,
    includeClusterId: boolean,
  ): SummaryBucket {
    const bucketClusterId = includeClusterId ? clusterId : null;
    const key = `${bucketClusterId ?? '*'}::${namespace ?? 'cluster'}`;
    const existing = buckets.get(key);
    if (existing) {
      return existing;
    }
    const bucket: SummaryBucket = {
      clusterId: bucketClusterId,
      namespace,
      resourceCounts: {},
      statusCounts: {},
      gatewayCount: 0,
      networkCount: 0,
      workloadCount: 0,
      podCount: 0,
      abnormalCount: 0,
      updatedAt: null,
    };
    buckets.set(key, bucket);
    return bucket;
  }

  private bumpGroup(bucket: SummaryBucket, kind: string): void {
    const group = this.resolveGroup(kind);
    if (group === 'gateway') {
      bucket.gatewayCount += 1;
      return;
    }
    if (group === 'network') {
      bucket.networkCount += 1;
      return;
    }
    if (group === 'workload') {
      bucket.workloadCount += 1;
      return;
    }
    if (group === 'pod') {
      bucket.podCount += 1;
    }
  }

  private resolveGroup(kind: string): SummaryResourceGroup | null {
    if (kind === 'Gateway' || kind === 'GatewayClass') {
      return 'gateway';
    }
    if (
      kind === 'Service' ||
      kind === 'Ingress' ||
      kind === 'EndpointSlice' ||
      kind === 'NetworkPolicy'
    ) {
      return 'network';
    }
    if (kind === 'Pod') {
      return 'pod';
    }
    if (
      kind === 'Deployment' ||
      kind === 'StatefulSet' ||
      kind === 'DaemonSet' ||
      kind === 'ReplicaSet' ||
      kind === 'Job' ||
      kind === 'CronJob'
    ) {
      return 'workload';
    }
    return null;
  }

  private resolveStatus(resource: SummaryResourceInput): string {
    const status = this.asRecord(resource.statusJson);
    const phase =
      this.asString(status?.phase) ??
      this.asString(status?.state) ??
      this.asString(resource.state) ??
      'unknown';
    return phase;
  }

  private isAbnormal(resource: SummaryResourceInput): boolean {
    const status = this.resolveStatus(resource).toLowerCase();
    if (UNHEALTHY_STATUSES.has(status)) {
      return true;
    }
    if (HEALTHY_STATUSES.has(status)) {
      return this.hasUnreadyReplicas(resource);
    }
    return status !== 'active' || this.hasUnreadyReplicas(resource);
  }

  private hasUnreadyReplicas(resource: SummaryResourceInput): boolean {
    if (resource.replicas === null || resource.replicas === undefined) {
      return false;
    }
    const desired = Math.max(resource.replicas, 0);
    const ready = Math.max(resource.readyReplicas ?? 0, 0);
    return desired > ready;
  }

  private bumpStatus(bucket: SummaryBucket, rawStatus: string | null): void {
    const status = rawStatus?.trim() || 'unknown';
    bucket.statusCounts[status] = (bucket.statusCounts[status] ?? 0) + 1;
  }

  private bumpUpdatedAt(bucket: SummaryBucket, updatedAt: Date): void {
    if (!bucket.updatedAt || updatedAt > bucket.updatedAt) {
      bucket.updatedAt = updatedAt;
    }
  }

  private toItem(bucket: SummaryBucket): TopologyNamespaceSummaryItem {
    return {
      clusterId: bucket.clusterId,
      namespace: bucket.namespace,
      resourceCounts: bucket.resourceCounts,
      statusCounts: bucket.statusCounts,
      gatewayCount: bucket.gatewayCount,
      networkCount: bucket.networkCount,
      workloadCount: bucket.workloadCount,
      podCount: bucket.podCount,
      abnormalCount: bucket.abnormalCount,
      updatedAt: bucket.updatedAt?.toISOString() ?? null,
    };
  }

  private asRecord(value: Prisma.JsonValue | undefined | null) {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return null;
    }
    return value as Record<string, Prisma.JsonValue>;
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
