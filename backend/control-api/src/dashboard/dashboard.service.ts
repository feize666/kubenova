import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { ClustersService } from '../clusters/clusters.service';
import {
  LiveMetricsService,
  type ClusterLiveUsageSnapshot,
} from '../metrics/live-metrics.service';
import { listAudits } from '../common/governance';

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
  serviceImpact: {
    nodes: Array<{
      id: string;
      label: string;
      kind: 'internet' | 'ingress' | 'service' | 'workload' | 'database';
      status: 'healthy' | 'warning' | 'critical' | 'unknown';
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      status: 'healthy' | 'warning' | 'critical' | 'unknown';
    }>;
    impactedServices: Array<{
      name: string;
      namespace?: string;
      clusterId?: string;
      severity: 'critical' | 'warning' | 'info' | 'healthy';
      impactScore: number;
      alertCount: number;
      workloadCount: number;
    }>;
    generatedAt: string;
    degraded: boolean;
    note?: string;
  };
  recentOperations: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    actor: string;
    result: 'success' | 'failure';
    timestamp: string;
    reason?: string;
  }>;
  scope?: {
    mode: 'all' | 'cluster';
    clusterId?: string;
    clusterName?: string;
    generatedAt: string;
    degraded?: boolean;
    degradedReason?: string;
  };
}

export interface DashboardStatsOptions {
  clusterId?: string;
}

@Injectable()
export class DashboardService {
  private readonly statsCacheTtlMs = 5_000;
  private readonly liveMetricsCacheTtlMs = 15_000;
  private readonly maxLiveSnapshotCacheEntries = 200;
  private readonly liveMetricsFanoutLimit = 4;
  private readonly liveMetricsTimeoutMs = 3_000;
  private readonly statsCache = new Map<
    string,
    { expiresAt: number; value: DashboardStats }
  >();
  private readonly statsInFlight = new Map<string, Promise<DashboardStats>>();
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

  async getStats(options: DashboardStatsOptions = {}): Promise<DashboardStats> {
    const now = Date.now();
    const clusterId = this.normalizeClusterId(options.clusterId);
    const cacheKey = this.getStatsCacheKey(clusterId);
    const cached = this.statsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return this.cloneDashboardStats(cached.value);
    }
    const inFlight = this.statsInFlight.get(cacheKey);
    if (inFlight) {
      return this.cloneDashboardStats(await inFlight);
    }

    const next = this.buildStats({ clusterId });
    this.statsInFlight.set(cacheKey, next);
    try {
      const stats = await next;
      this.statsCache.set(cacheKey, {
        expiresAt: Date.now() + this.statsCacheTtlMs,
        value: stats,
      });
      return this.cloneDashboardStats(stats);
    } finally {
      this.statsInFlight.delete(cacheKey);
    }
  }

  private async buildStats(options: {
    clusterId?: string;
  }): Promise<DashboardStats> {
    const clusterId = options.clusterId;
    const clusterScope = Boolean(clusterId);
    const activeClusterWhere = {
      deletedAt: null,
      status: { not: 'deleted' },
      ...(clusterId ? { id: clusterId } : {}),
    };
    const activeClusterRelationWhere = {
      deletedAt: null,
      status: { not: 'deleted' },
      ...(clusterId ? { id: clusterId } : {}),
    };
    const activeWorkloadWhere = {
      state: 'active',
      ...(clusterId ? { clusterId } : {}),
      cluster: activeClusterRelationWhere,
    };
    const activeNamespaceWhere = {
      state: 'active',
      ...(clusterId ? { clusterId } : {}),
      cluster: activeClusterRelationWhere,
    };
    const activeNetworkWhere = {
      state: 'active',
      ...(clusterId ? { clusterId } : {}),
      cluster: activeClusterRelationWhere,
    };

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
      serviceImpact,
      recentOperations,
    ] = await Promise.all([
      this.prisma.clusterRegistry.count({
        where: activeClusterWhere,
      }),
      this.prisma.clusterRegistry.count({
        where: {
          deletedAt: null,
          status: { in: ['healthy', '正常'] },
          ...(clusterId ? { id: clusterId } : {}),
        },
      }),
      this.prisma.workloadRecord.count({
        where: activeWorkloadWhere,
      }),
      this.prisma.workloadRecord.count({
        where: {
          ...activeWorkloadWhere,
          readyReplicas: { gt: 0 },
        },
      }),
      this.prisma.monitoringAlert.count({
        where: this.activeAlertWhere({
          ...(clusterId ? { clusterId } : {}),
          severity: 'critical',
          status: 'firing',
        }),
      }),
      this.prisma.monitoringAlert.count({
        where: this.activeAlertWhere({
          ...(clusterId ? { clusterId } : {}),
          severity: 'warning',
          status: 'firing',
        }),
      }),
      this.prisma.namespaceRecord.count({
        where: activeNamespaceWhere,
      }),
      this.prisma.networkResource.count({
        where: {
          ...activeNetworkWhere,
          kind: 'Service',
        },
      }),
      this.prisma.networkResource.count({
        where: {
          ...activeNetworkWhere,
          kind: 'Ingress',
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          ...activeWorkloadWhere,
          kind: 'Deployment',
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          ...activeWorkloadWhere,
          kind: 'StatefulSet',
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          ...activeWorkloadWhere,
          kind: 'DaemonSet',
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          ...activeWorkloadWhere,
          kind: 'Pod',
        },
      }),
      this.prisma.monitoringAlert.findMany({
        where: this.activeAlertWhere({
          ...(clusterId ? { clusterId } : {}),
          status: 'firing',
        }),
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
        where: activeClusterWhere,
        select: { id: true, name: true, metadata: true },
      }),
      this.buildServiceImpact({ clusterId, activeClusterRelationWhere }),
      this.buildRecentOperations({ clusterId }),
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

    const scopeDegraded = clusterScope && activeClusters.length === 0;
    const scopeDegradedReason = scopeDegraded
      ? '当前选择的集群不存在或已删除。'
      : undefined;

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
      serviceImpact,
      recentOperations,
      scope: {
        mode: clusterScope ? 'cluster' : 'all',
        ...(clusterId ? { clusterId } : {}),
        ...(activeClusters[0]?.name
          ? { clusterName: activeClusters[0].name }
          : {}),
        generatedAt: new Date().toISOString(),
        ...(scopeDegraded ? { degraded: true } : {}),
        ...(scopeDegradedReason ? { degradedReason: scopeDegradedReason } : {}),
      },
    };
  }

  private async buildServiceImpact(options: {
    clusterId?: string;
    activeClusterRelationWhere: Record<string, unknown>;
  }): Promise<DashboardStats['serviceImpact']> {
    const activeNetworkWhere = {
      state: 'active',
      ...(options.clusterId ? { clusterId: options.clusterId } : {}),
      cluster: options.activeClusterRelationWhere,
    };
    const activeWorkloadWhere = {
      state: 'active',
      ...(options.clusterId ? { clusterId: options.clusterId } : {}),
      cluster: options.activeClusterRelationWhere,
    };
    const [services, ingresses, workloads, alerts] = await Promise.all([
      this.prisma.networkResource.findMany({
        where: { ...activeNetworkWhere, kind: 'Service' },
        orderBy: { updatedAt: 'desc' },
        take: 12,
        select: {
          id: true,
          clusterId: true,
          namespace: true,
          name: true,
          labels: true,
        },
      }),
      this.prisma.networkResource.findMany({
        where: { ...activeNetworkWhere, kind: 'Ingress' },
        orderBy: { updatedAt: 'desc' },
        take: 4,
        select: {
          id: true,
          clusterId: true,
          namespace: true,
          name: true,
        },
      }),
      this.prisma.workloadRecord.findMany({
        where: activeWorkloadWhere,
        orderBy: { updatedAt: 'desc' },
        take: 80,
        select: {
          id: true,
          clusterId: true,
          namespace: true,
          kind: true,
          name: true,
          readyReplicas: true,
          replicas: true,
          labels: true,
        },
      }),
      this.prisma.monitoringAlert.findMany({
        where: this.activeAlertWhere({
          ...(options.clusterId ? { clusterId: options.clusterId } : {}),
          status: 'firing',
        }),
        orderBy: { firedAt: 'desc' },
        take: 80,
        select: {
          id: true,
          clusterId: true,
          namespace: true,
          severity: true,
          resourceType: true,
          resourceName: true,
        },
      }),
    ]);

    const serviceCandidates =
      services.length > 0
        ? services
        : workloads.slice(0, 6).map((item) => ({
            id: item.id,
            clusterId: item.clusterId,
            namespace: item.namespace,
            name: item.name,
            labels: item.labels,
          }));

    const impactedServices = serviceCandidates
      .map((service) => {
        const namespaceAlerts = alerts.filter(
          (alert) =>
            (!service.clusterId ||
              !alert.clusterId ||
              alert.clusterId === service.clusterId) &&
            (!alert.namespace || alert.namespace === service.namespace),
        );
        const directAlerts = namespaceAlerts.filter((alert) => {
          const resourceName = alert.resourceName?.trim();
          if (!resourceName) return false;
          return (
            resourceName === service.name ||
            resourceName.includes(service.name) ||
            service.name.includes(resourceName)
          );
        });
        const matchedAlerts =
          directAlerts.length > 0 ? directAlerts : namespaceAlerts;
        const critical = matchedAlerts.filter(
          (alert) => alert.severity === 'critical',
        ).length;
        const warning = matchedAlerts.filter(
          (alert) => alert.severity === 'warning',
        ).length;
        const namespaceWorkloads = workloads.filter(
          (workload) =>
            workload.clusterId === service.clusterId &&
            workload.namespace === service.namespace,
        );
        const unhealthyWorkloads = namespaceWorkloads.filter((workload) => {
          const ready = workload.readyReplicas ?? 0;
          const desired = workload.replicas ?? 0;
          return desired > 0 ? ready < desired : ready === 0;
        }).length;
        const impactScore = Math.min(
          100,
          critical * 32 + warning * 16 + unhealthyWorkloads * 7,
        );
        const severity =
          critical > 0
            ? ('critical' as const)
            : warning > 0 || unhealthyWorkloads > 0
              ? ('warning' as const)
              : impactScore > 0
                ? ('info' as const)
                : ('healthy' as const);
        return {
          name: service.name,
          namespace: service.namespace,
          clusterId: service.clusterId,
          severity,
          impactScore,
          alertCount: matchedAlerts.length,
          workloadCount: namespaceWorkloads.length,
        };
      })
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, 5);

    const primaryIngress = ingresses[0];
    const visibleServices = impactedServices.slice(0, 3);
    const nodes: DashboardStats['serviceImpact']['nodes'] = [
      {
        id: 'internet',
        label: 'Internet',
        kind: 'internet',
        status: 'healthy',
      },
      {
        id: 'ingress',
        label: primaryIngress?.name ?? 'Ingress',
        kind: 'ingress',
        status: primaryIngress ? 'healthy' : 'unknown',
      },
      ...visibleServices.map((service, index) => ({
        id: `service-${index}`,
        label: service.name,
        kind: 'service' as const,
        status: this.mapImpactSeverityToStatus(service.severity),
      })),
      {
        id: 'backend',
        label: alerts.some(
          (alert) => alert.resourceType === 'PersistentVolumeClaim',
        )
          ? 'storage'
          : 'backend',
        kind: 'database',
        status: alerts.some((alert) => alert.severity === 'critical')
          ? 'critical'
          : alerts.some((alert) => alert.severity === 'warning')
            ? 'warning'
            : 'unknown',
      },
    ];

    const edges: DashboardStats['serviceImpact']['edges'] = [
      {
        id: 'internet-ingress',
        source: 'internet',
        target: 'ingress',
        status: 'healthy',
      },
      ...visibleServices.map((service, index) => ({
        id: `ingress-service-${index}`,
        source: 'ingress',
        target: `service-${index}`,
        status: this.mapImpactSeverityToStatus(service.severity),
      })),
      {
        id: 'service-backend',
        source: visibleServices.length > 0 ? 'service-0' : 'ingress',
        target: 'backend',
        status: nodes[nodes.length - 1]?.status ?? 'unknown',
      },
    ];

    return {
      nodes,
      edges,
      impactedServices,
      generatedAt: new Date().toISOString(),
      degraded: serviceCandidates.length === 0,
      note:
        serviceCandidates.length === 0
          ? '未发现可用于服务影响分析的 Service 或 Workload。'
          : undefined,
    };
  }

  private async buildRecentOperations(options: {
    clusterId?: string;
  }): Promise<DashboardStats['recentOperations']> {
    const [auditLogs, volatileAudits] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          ...(options.clusterId ? { clusterId: options.clusterId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          message: true,
          clusterId: true,
          createdAt: true,
          actorUser: { select: { email: true, name: true } },
        },
      }),
      Promise.resolve(
        listAudits({
          page: 1,
          pageSize: 8,
        }).items,
      ),
    ]);

    const durable = auditLogs.map((item) => ({
      id: item.id,
      action: item.action,
      resourceType: item.resourceType,
      resourceId: item.resourceId ?? undefined,
      actor: item.actorUser?.name ?? item.actorUser?.email ?? 'system',
      result: 'success' as const,
      timestamp: item.createdAt.toISOString(),
      reason: item.message ?? undefined,
    }));
    const volatile = volatileAudits
      .filter(
        (item) =>
          !options.clusterId || item.resourceId.includes(options.clusterId),
      )
      .map((item) => ({
        id: item.id,
        action: item.action,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        actor: item.actor,
        result: item.result,
        timestamp: item.timestamp,
        reason: item.reason,
      }));

    const seen = new Set<string>();
    return [...durable, ...volatile]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 6);
  }

  private mapImpactSeverityToStatus(
    severity: 'critical' | 'warning' | 'info' | 'healthy',
  ): 'healthy' | 'warning' | 'critical' | 'unknown' {
    if (severity === 'critical') return 'critical';
    if (severity === 'warning') return 'warning';
    if (severity === 'healthy') return 'healthy';
    return 'unknown';
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
      serviceImpact: {
        nodes: stats.serviceImpact.nodes.map((node) => ({ ...node })),
        edges: stats.serviceImpact.edges.map((edge) => ({ ...edge })),
        impactedServices: stats.serviceImpact.impactedServices.map((item) => ({
          ...item,
        })),
        generatedAt: stats.serviceImpact.generatedAt,
        degraded: stats.serviceImpact.degraded,
        note: stats.serviceImpact.note,
      },
      recentOperations: stats.recentOperations.map((item) => ({ ...item })),
      scope: stats.scope ? { ...stats.scope } : undefined,
    };
  }

  private normalizeClusterId(
    clusterId: string | undefined,
  ): string | undefined {
    const normalized = clusterId?.trim();
    return normalized ? normalized : undefined;
  }

  private getStatsCacheKey(clusterId: string | undefined): string {
    return clusterId ? `cluster:${clusterId}` : 'all';
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
