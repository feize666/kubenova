import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { ClustersService } from '../clusters/clusters.service';
import {
  LiveMetricsService,
  type ClusterLiveUsageSnapshot,
} from '../metrics/live-metrics.service';

export interface DashboardStats {
  clusters: {
    total: number;
    healthy: number;
    warning: number;
  };
  workloads: {
    total: number;
    healthy: number;
    unhealthy: number;
  };
  alerts: {
    critical: number;
    warning: number;
    total: number;
  };
  namespaces: number;
  healthScore: number;
  resourceUsage: {
    cpuUsagePercent: number;
    memoryUsagePercent: number;
    dataSource: 'metrics-server' | 'k8s-metadata' | 'none';
    degraded: boolean;
    note?: string;
    liveSnapshot?: ClusterLiveUsageSnapshot;
  };
  topology: {
    services: number;
    ingresses: number;
    deployments: number;
    statefulsets: number;
    daemonsets: number;
    pods: number;
    edges: number;
  };
  recentEvents: Array<{
    id: string;
    level: 'critical' | 'warning' | 'info';
    event: string;
    source: string;
    timestamp: string;
  }>;
}

@Injectable()
export class DashboardService {
  private readonly statsCacheTtlMs = 5_000;
  private readonly liveMetricsCacheTtlMs = 15_000;
  private readonly maxLiveSnapshotCacheEntries = 200;
  private readonly liveMetricsFanoutLimit = 4;
  private readonly liveMetricsTimeoutMs = 3_000;
  private statsCache: { expiresAt: number; value: DashboardStats } | undefined;
  private statsInFlight: Promise<DashboardStats> | undefined;
  private readonly liveSnapshotCache = new Map<
    string,
    { expiresAt: number; value: ClusterLiveUsageSnapshot | null }
  >();
  private readonly liveSnapshotInFlight = new Map<
    string,
    Promise<ClusterLiveUsageSnapshot | null>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clustersService: ClustersService,
    private readonly liveMetricsService: LiveMetricsService,
  ) {}

  private activeAlertWhere(base: Record<string, unknown> = {}) {
    return {
      ...base,
      OR: [
        { clusterId: null },
        { cluster: { is: { deletedAt: null, status: { not: 'deleted' } } } },
      ],
    };
  }

  async getStats(): Promise<DashboardStats> {
    const now = Date.now();
    if (this.statsCache && this.statsCache.expiresAt > now) {
      return this.cloneDashboardStats(this.statsCache.value);
    }
    if (this.statsInFlight) {
      return this.cloneDashboardStats(await this.statsInFlight);
    }

    this.statsInFlight = this.buildStats();
    try {
      const stats = await this.statsInFlight;
      this.statsCache = {
        expiresAt: Date.now() + this.statsCacheTtlMs,
        value: stats,
      };
      return this.cloneDashboardStats(stats);
    } finally {
      this.statsInFlight = undefined;
    }
  }

  private async buildStats(): Promise<DashboardStats> {
    const [
      clusterTotal,
      clusterHealthy,
      workloadTotal,
      workloadHealthy,
      alertCritical,
      alertWarning,
      namespaceCount,
      topologyServices,
      topologyIngresses,
      topologyDeployments,
      topologyStatefulsets,
      topologyDaemonsets,
      topologyPods,
      recentAlertRows,
      activeClusters,
    ] = await Promise.all([
      this.prisma.clusterRegistry.count({
        where: { deletedAt: null, status: { not: 'deleted' } },
      }),
      this.prisma.clusterRegistry.count({
        where: { deletedAt: null, status: { in: ['healthy', '正常'] } },
      }),
      this.prisma.workloadRecord.count({
        where: {
          state: 'active',
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          state: 'active',
          cluster: { deletedAt: null, status: { not: 'deleted' } },
          readyReplicas: { gt: 0 },
        },
      }),
      this.prisma.monitoringAlert.count({
        where: this.activeAlertWhere({
          severity: 'critical',
          status: 'firing',
        }),
      }),
      this.prisma.monitoringAlert.count({
        where: this.activeAlertWhere({ severity: 'warning', status: 'firing' }),
      }),
      this.prisma.namespaceRecord.count({
        where: {
          state: 'active',
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.networkResource.count({
        where: {
          state: 'active',
          kind: 'Service',
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.networkResource.count({
        where: {
          state: 'active',
          kind: 'Ingress',
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          state: 'active',
          kind: 'Deployment',
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          state: 'active',
          kind: 'StatefulSet',
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          state: 'active',
          kind: 'DaemonSet',
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          state: 'active',
          kind: 'Pod',
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.monitoringAlert.findMany({
        where: this.activeAlertWhere({ status: 'firing' }),
        orderBy: { firedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          severity: true,
          title: true,
          source: true,
          firedAt: true,
        },
      }),
      this.prisma.clusterRegistry.findMany({
        where: { deletedAt: null, status: { not: 'deleted' } },
        select: { id: true, name: true, metadata: true },
      }),
    ]);

    const clusterWarning = clusterTotal - clusterHealthy;
    const workloadUnhealthy = workloadTotal - workloadHealthy;
    const alertTotal = alertCritical + alertWarning;
    const healthyRatio = clusterTotal > 0 ? clusterHealthy / clusterTotal : 1;
    const criticalRatio = Math.min(alertCritical / 10, 1);
    const healthScore = Math.min(
      100,
      Math.max(0, Math.round(healthyRatio * 70 + (1 - criticalRatio) * 30)),
    );

    let usageCount = 0;
    let cpuTotal = 0;
    let memoryTotal = 0;
    for (const row of activeClusters) {
      const meta =
        row.metadata &&
        typeof row.metadata === 'object' &&
        !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const usageMetrics =
        meta.usageMetrics &&
        typeof meta.usageMetrics === 'object' &&
        !Array.isArray(meta.usageMetrics)
          ? (meta.usageMetrics as Record<string, unknown>)
          : undefined;
      const cpu =
        usageMetrics &&
        typeof usageMetrics.cpu === 'object' &&
        usageMetrics.cpu !== null &&
        !Array.isArray(usageMetrics.cpu) &&
        typeof (usageMetrics.cpu as Record<string, unknown>).usagePercent ===
          'number'
          ? ((usageMetrics.cpu as Record<string, unknown>)
              .usagePercent as number)
          : typeof meta.cpuUsage === 'number'
            ? meta.cpuUsage
            : null;
      const memory =
        usageMetrics &&
        typeof usageMetrics.memory === 'object' &&
        usageMetrics.memory !== null &&
        !Array.isArray(usageMetrics.memory) &&
        typeof (usageMetrics.memory as Record<string, unknown>).usagePercent ===
          'number'
          ? ((usageMetrics.memory as Record<string, unknown>)
              .usagePercent as number)
          : typeof meta.memoryUsage === 'number'
            ? meta.memoryUsage
            : null;

      if (typeof cpu === 'number' && typeof memory === 'number') {
        usageCount += 1;
        cpuTotal += cpu;
        memoryTotal += memory;
      }
    }
    const hasUsage = usageCount > 0;
    const cpuUsagePercent = hasUsage ? Math.round(cpuTotal / usageCount) : 0;
    const memoryUsagePercent = hasUsage
      ? Math.round(memoryTotal / usageCount)
      : 0;
    const liveSnapshots = await this.runBounded(
      activeClusters,
      this.liveMetricsFanoutLimit,
      (row) => this.getCachedLiveSnapshot(row.id),
    );
    const availableSnapshots = liveSnapshots.filter(
      (snapshot): snapshot is ClusterLiveUsageSnapshot =>
        Boolean(snapshot?.available),
    );

    const recentEvents =
      recentAlertRows.length > 0
        ? recentAlertRows.map((row) => ({
            id: row.id,
            level:
              row.severity === 'critical'
                ? ('critical' as const)
                : row.severity === 'warning'
                  ? ('warning' as const)
                  : ('info' as const),
            event: row.title,
            source: row.source ?? 'monitoring-alert',
            timestamp: row.firedAt.toISOString(),
          }))
        : [];

    const topologyEdges =
      topologyIngresses +
      topologyServices +
      topologyDeployments +
      topologyStatefulsets +
      topologyDaemonsets;

    return {
      clusters: {
        total: clusterTotal,
        healthy: clusterHealthy,
        warning: clusterWarning,
      },
      workloads: {
        total: workloadTotal,
        healthy: workloadHealthy,
        unhealthy: workloadUnhealthy,
      },
      alerts: {
        critical: alertCritical,
        warning: alertWarning,
        total: alertTotal,
      },
      namespaces: namespaceCount,
      healthScore,
      resourceUsage: {
        cpuUsagePercent,
        memoryUsagePercent,
        dataSource:
          availableSnapshots.length > 0
            ? 'metrics-server'
            : hasUsage
              ? 'k8s-metadata'
              : 'none',
        degraded: !hasUsage && availableSnapshots.length === 0,
        note:
          availableSnapshots.length > 0
            ? undefined
            : hasUsage
              ? undefined
              : '未检测到可用的 live metrics 数据，请先确认 metrics-server 与集群连通性。',
        liveSnapshot: availableSnapshots[0] ?? undefined,
      },
      topology: {
        services: topologyServices,
        ingresses: topologyIngresses,
        deployments: topologyDeployments,
        statefulsets: topologyStatefulsets,
        daemonsets: topologyDaemonsets,
        pods: topologyPods,
        edges: topologyEdges,
      },
      recentEvents,
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async runBounded<TInput, TOutput>(
    items: TInput[],
    limit: number,
    worker: (item: TInput) => Promise<TOutput>,
  ): Promise<TOutput[]> {
    const results: TOutput[] = [];
    for (let index = 0; index < items.length; index += limit) {
      const batch = items.slice(index, index + limit);
      results.push(...(await Promise.all(batch.map((item) => worker(item)))));
    }
    return results;
  }

  private async getCachedLiveSnapshot(
    clusterId: string,
  ): Promise<ClusterLiveUsageSnapshot | null> {
    const now = Date.now();
    this.pruneLiveSnapshotCache(now);
    const cached = this.liveSnapshotCache.get(clusterId);
    if (cached && cached.expiresAt > now) {
      return this.cloneLiveSnapshot(cached.value);
    }

    const inFlight = this.liveSnapshotInFlight.get(clusterId);
    if (inFlight) {
      return this.cloneLiveSnapshot(await inFlight);
    }

    const next = this.fetchLiveSnapshot(clusterId);
    this.liveSnapshotInFlight.set(clusterId, next);
    try {
      const snapshot = await next;
      this.liveSnapshotCache.set(clusterId, {
        expiresAt: Date.now() + this.liveMetricsCacheTtlMs,
        value: this.cloneLiveSnapshot(snapshot),
      });
      this.pruneLiveSnapshotCache();
      return this.cloneLiveSnapshot(snapshot);
    } finally {
      this.liveSnapshotInFlight.delete(clusterId);
    }
  }

  private async fetchLiveSnapshot(
    clusterId: string,
  ): Promise<ClusterLiveUsageSnapshot | null> {
    try {
      const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
      if (!kubeconfig) {
        return null;
      }
      return await this.withTimeout(
        this.liveMetricsService.getClusterSnapshot(clusterId, kubeconfig),
        this.liveMetricsTimeoutMs,
      );
    } catch {
      return null;
    }
  }

  private pruneLiveSnapshotCache(now = Date.now()): void {
    for (const [key, cached] of this.liveSnapshotCache) {
      if (cached.expiresAt <= now) {
        this.liveSnapshotCache.delete(key);
      }
    }

    while (this.liveSnapshotCache.size > this.maxLiveSnapshotCacheEntries) {
      const oldestKey = this.liveSnapshotCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) {
        break;
      }
      this.liveSnapshotCache.delete(oldestKey);
    }
  }

  private cloneDashboardStats(stats: DashboardStats): DashboardStats {
    return {
      clusters: { ...stats.clusters },
      workloads: { ...stats.workloads },
      alerts: { ...stats.alerts },
      namespaces: stats.namespaces,
      healthScore: stats.healthScore,
      resourceUsage: {
        ...stats.resourceUsage,
        liveSnapshot: this.cloneLiveSnapshot(stats.resourceUsage.liveSnapshot),
      },
      topology: { ...stats.topology },
      recentEvents: stats.recentEvents.map((event) => ({ ...event })),
    };
  }

  private cloneLiveSnapshot<
    T extends ClusterLiveUsageSnapshot | null | undefined,
  >(snapshot: T): T {
    if (!snapshot) {
      return snapshot;
    }
    return {
      ...snapshot,
      pods: snapshot.pods.map((pod) => ({
        ...pod,
        history: pod.history.map((point) => ({ ...point })),
      })),
      history: snapshot.history.map((point) => ({ ...point })),
    } as T;
  }
}
