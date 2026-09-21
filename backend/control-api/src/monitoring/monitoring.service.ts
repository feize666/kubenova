import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import {
  appendAudit,
  assertWritePermission,
  type PlatformRole,
} from '../common/governance';
import { ClustersService } from '../clusters/clusters.service';
import {
  LiveMetricsService,
  type ClusterLiveUsageSnapshot,
} from '../metrics/live-metrics.service';
import { PrismaService } from '../platform/database/prisma.service';
import { ClusterAccessService } from '../common/cluster-access.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';
import { ObservabilityService, type GrafanaPanelConfiguration } from './observability.service';

export type MonitoringRange = '15m' | '1h' | '6h' | '24h' | '7d';
type ResourceState = 'active' | 'disabled';

interface Actor {
  id?: string;
  username?: string;
  role?: PlatformRole;
}

type MonitoringScope = {
  resources: Array<{ clusterId: string; namespace?: string }>;
  secrets: Array<{ clusterId: string; namespace: string }>;
};

export interface MonitoringOverviewResponse {
  range: MonitoringRange;
  timestamp: string;
  healthScore: number | null;
  clusterTotal: number;
  clusterHealthy: number | null;
  warningCount: number;
  criticalCount: number;
  cpuUsagePercent: number | null;
  memoryUsagePercent: number | null;
  usageDataSource: 'metrics-server' | 'k8s-metadata' | 'none';
  dataSource: 'monitoring-alert' | 'workload-derived' | 'mixed';
  degraded: boolean;
  note?: string;
  liveSnapshot?: ClusterLiveUsageSnapshot;
}

export interface MonitoringEventItem {
  id: string;
  level: 'INFO' | 'WARN' | 'CRITICAL';
  source: string;
  message: string;
  timestamp: string;
}

export interface MonitoringEventsResponse {
  range: MonitoringRange;
  timestamp: string;
  total: number;
  items: MonitoringEventItem[];
  dataSource: 'monitoring-alert' | 'workload-derived';
  degraded: boolean;
  note?: string;
}

export interface AlertRuleItem {
  id: string;
  name: string;
  severity: 'critical' | 'warning' | 'info';
  condition: string;
  target: string;
  state: ResourceState;
  version: number;
  updatedAt: string;
}

export interface MonitoringAlertRulesResponse {
  items: AlertRuleItem[];
  total: number;
  timestamp: string;
}

export interface AlertItem {
  id: string;
  clusterId: string | null;
  namespace: string | null;
  severity: string;
  title: string;
  message: string;
  source: string | null;
  resourceType: string | null;
  resourceName: string | null;
  status: string;
  firedAt: string;
  resolvedAt: string | null;
}

export interface AlertsQuery {
  clusterId?: string;
  severity?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  range?: MonitoringRange;
  from?: Date;
  to?: Date;
}

export interface AlertsResponse {
  items: AlertItem[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
  dataSource: 'monitoring-alert' | 'workload-derived';
  degraded: boolean;
  note?: string;
}

export interface InspectionIssue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category:
    | 'cluster'
    | 'namespace'
    | 'workload'
    | 'network'
    | 'storage'
    | 'config'
    | 'security'
    | 'alert';
  title: string;
  resourceRef: string;
  resourceKind?: string | null;
  clusterId?: string | null;
  namespace?: string | null;
  suggestion: string;
  evidence?: string;
  actions: InspectionIssueAction[];
}

export type InspectionActionType = 'generate-yaml' | 'create-hpa-draft';

export interface InspectionIssueAction {
  type: InspectionActionType;
  label: string;
  description: string;
}

export interface InspectionActionResponse {
  issueId: string;
  action: InspectionActionType;
  success: boolean;
  message: string;
  generatedYaml?: string;
  target?: {
    kind: string;
    namespace?: string;
    name?: string;
    clusterId?: string;
  };
}

export interface ClusterInspectionReport {
  timestamp: string;
  clusterId?: string;
  namespace?: string;
  summary: {
    score: number;
    totalResources: number;
    issueTotal: number;
    critical: number;
    warning: number;
    pass: number;
  };
  items: InspectionIssue[];
}

export interface ExecuteInspectionActionRequest {
  clusterId?: string;
  namespace?: string;
}

export interface InspectionTimeFilter {
  clusterId?: string;
  range?: MonitoringRange;
  from?: Date;
  to?: Date;
}

export type InspectionExportFormat = 'json' | 'csv' | 'xlsx';

export interface InspectionReportExportResult {
  filename: string;
  contentType: string;
  data: string | Buffer;
}

export interface AlertsExportResult {
  filename: string;
  contentType: string;
  data: string | Buffer;
}

export type ObservabilityEntityScope =
  | 'cluster'
  | 'namespace'
  | 'workload'
  | 'service'
  | 'pod'
  | 'node'
  | 'network';

export interface ObservabilitySourceStatus {
  key: 'metrics' | 'logs' | 'traces' | 'events' | 'alerts' | 'slo';
  label: string;
  available: boolean;
  degraded: boolean;
  note: string;
  deepLink?: string;
}

export interface ObservabilityEntityHealth {
  scope: ObservabilityEntityScope;
  label: string;
  status: 'healthy' | 'warning' | 'critical' | 'unavailable';
  total: number;
  warning: number;
  critical: number;
  note?: string;
  detailPath?: string;
  signals: Record<
    'metrics' | 'logs' | 'traces' | 'events' | 'alerts',
    'available' | 'degraded' | 'unavailable'
  >;
  slo: {
    targetPercent: number;
    burnRate: number;
    errorBudgetRemainingPercent: number;
    status: 'healthy' | 'at-risk' | 'exhausted' | 'unavailable';
  };
  alertOwner: string;
  runbookUrl: string | null;
  notificationStatus: 'not-configured' | 'ready' | 'degraded';
  deepLinks: Array<{
    key: string;
    label: string;
    url: string | null;
    available: boolean;
  }>;
}

export interface ObservabilitySignalPanel {
  key: 'metrics' | 'logs' | 'traces' | 'events' | 'alerts' | 'slo';
  title: string;
  status: 'available' | 'degraded' | 'unavailable';
  summary: string;
  updatedAt: string;
  detailPath?: string;
}

export interface ObservabilitySummaryResponse {
  range: MonitoringRange;
  timestamp: string;
  timeRange: {
    from: string;
    to: string;
  };
  healthScore: number | null;
  activeAlerts: {
    critical: number;
    warning: number;
    total: number;
    source: AlertsResponse['dataSource'];
    degraded: boolean;
  };
  sourceStatus: ObservabilitySourceStatus[];
  entities: ObservabilityEntityHealth[];
  signalPanels: ObservabilitySignalPanel[];
  recentEvents: MonitoringEventItem[];
  externalLinks: Array<{
    key: string;
    label: string;
    url: string | null;
    available: boolean;
  }>;
  degraded: boolean;
  note?: string;
}

export interface CreateAlertRuleRequest {
  name: string;
  severity: 'critical' | 'warning' | 'info';
  condition: string;
  target: string;
}

export interface UpdateAlertRuleRequest {
  name?: string;
  severity?: 'critical' | 'warning' | 'info';
  condition?: string;
  target?: string;
}

@Injectable()
export class MonitoringService {
  private readonly observabilitySummaryCacheTtlMs = 5_000;
  private readonly maxObservabilitySummaryCacheEntries = 50;
  private readonly liveMetricsFanoutLimit = 4;
  private readonly liveMetricsTimeoutMs = 2500;
  private readonly observabilitySummaryCache = new Map<
    string,
    { expiresAt: number; value: ObservabilitySummaryResponse }
  >();
  private readonly observabilitySummaryInFlight = new Map<
    string,
    Promise<ObservabilitySummaryResponse>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clustersService: ClustersService,
    private readonly liveMetricsService: LiveMetricsService,
    @Optional() private readonly observabilityService?: ObservabilityService,
    private readonly clusterAccessService: ClusterAccessService = new ClusterAccessService(prisma),
    @Optional() private readonly authorization?: AuthorizationService,
    @Optional() private readonly namespaceIdentity?: NamespaceIdentityService,
  ) {}

  private async resolveScope(actor?: Actor, clusterId?: string, namespace?: string, mutation = false): Promise<MonitoringScope | undefined> {
    // Only trusted internal callers omit actor. HTTP always supplies an object.
    if (actor === undefined) return undefined;
    if (!actor.id?.trim() || !this.clusterAccessService.isKnownPlatformRole(actor)) throw new ForbiddenException();
    if (mutation) assertWritePermission(actor);
    if (this.clusterAccessService.isPlatformAdmin(actor)) return undefined;
    if (!this.authorization || !this.namespaceIdentity) throw new ForbiddenException();
    const scope: MonitoringScope = { resources: [], secrets: [] };
    for (const id of await this.clusterAccessService.listAccessibleClusterIds(actor) ?? []) {
      if (clusterId && clusterId !== id) continue;
      if (mutation) {
        try { await this.clusterAccessService.assertCanMutate(actor, id); }
        catch (error) {
          if (error instanceof ForbiddenException || error instanceof NotFoundException) continue;
          throw error;
        }
      }
      scope.resources.push({ clusterId: id });
    }
    const identities = new Map<string, string | null>();
    for (const grant of await this.authorization.listEffectiveGrants(actor.id, new Date(), clusterId)) {
      if (mutation && grant.role === 'viewer') continue;
      for (const ns of grant.namespaces) {
        if (!ns.namespaceName || !ns.namespaceUid || (namespace && namespace !== ns.namespaceName)) continue;
        const key = `${grant.clusterId}/${ns.namespaceName}`;
        if (!identities.has(key)) {
          try { identities.set(key, await this.namespaceIdentity.resolve(grant.clusterId, ns.namespaceName)); }
          catch { identities.set(key, null); }
        }
        if (identities.get(key) !== ns.namespaceUid) continue;
        const pair = { clusterId: grant.clusterId, namespace: ns.namespaceName };
        scope.resources.push(pair);
        if (grant.capabilities.some(item => item.capability === 'secrets')) scope.secrets.push(pair);
      }
    }
    if ((clusterId || namespace) && !scope.resources.some(pair => (!clusterId || pair.clusterId === clusterId) && (!namespace || !pair.namespace || pair.namespace === namespace))) throw new ForbiddenException();
    return scope;
  }

  private resourceScopeWhere(scope?: MonitoringScope, namespaceField = 'namespace') {
    return scope ? { OR: scope.resources.map(pair => ({ clusterId: pair.clusterId, ...(pair.namespace ? { [namespaceField]: pair.namespace } : {}) })) } : {};
  }

  private secretScopeWhere(scope: MonitoringScope | undefined, kindField = 'kind') {
    return scope ? { OR: [
      ...(kindField === 'resourceType' ? [{ resourceType: null }] : []),
      { NOT: { [kindField]: { in: ['secret', 'secrets'], mode: 'insensitive' as const } } },
      ...scope.secrets,
    ] } : {};
  }

  private clusterScopeWhere(scope?: MonitoringScope, fullOnly = false) {
    return scope ? { id: { in: [...new Set(scope.resources.filter(pair => !fullOnly || !pair.namespace).map(pair => pair.clusterId))] } } : {};
  }

  private hasNamespaceOnlyScope(scope?: MonitoringScope): boolean {
    return Boolean(scope && (!scope.resources.length || scope.resources.some(pair => pair.namespace && !scope.resources.some(full => full.clusterId === pair.clusterId && !full.namespace))));
  }

  async getGrafanaPanelConfiguration(
    clusterId: string,
    range?: string,
    actor?: Actor,
  ): Promise<GrafanaPanelConfiguration> {
    const scope = await this.resolveScope(actor, clusterId);
    if (scope && !scope.resources.some(pair => pair.clusterId === clusterId && !pair.namespace)) throw new ForbiddenException('Cluster-wide monitoring access required');
    // Keep this facade on the monitoring service so monitoring routes retain
    // their existing ownership while the config service owns validation.
    const service = this.observabilityService ?? new ObservabilityService(this.prisma);
    return service.getGrafanaPanelConfiguration(clusterId, range);
  }

  private activeClusterAlertWhere(
    base: Prisma.MonitoringAlertWhereInput = {},
    clusterId?: string,
  ): Prisma.MonitoringAlertWhereInput {
    if (clusterId) {
      return {
        ...base,
        clusterId,
        cluster: { is: { deletedAt: null, status: { not: 'deleted' } } },
      };
    }
    return {
      ...base,
      OR: [
        { clusterId: null },
        { cluster: { is: { deletedAt: null, status: { not: 'deleted' } } } },
      ],
    };
  }

  private resolveTimeWindow(
    filter?: InspectionTimeFilter,
    fallbackRange: MonitoringRange = '24h',
  ): { range: MonitoringRange; from?: Date; to?: Date } {
    const range = filter?.range ?? fallbackRange;
    const windows: Record<MonitoringRange, number> = {
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };

    const derivedFrom = new Date(Date.now() - windows[range]);
    const from = filter?.from ?? derivedFrom;
    const to = filter?.to;
    return { range, from, to };
  }

  private buildDateRangeWhere(
    from?: Date,
    to?: Date,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) {
      return undefined;
    }
    return {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  private readonly alertRules: AlertRuleItem[] = [
    {
      id: 'rule-001',
      name: '支付服务重启过高',
      severity: 'critical',
      condition: 'restartCount > 5 in 10m',
      target: 'prod/payment-service',
      state: 'active',
      version: 1,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'rule-002',
      name: '网关 CPU 偏高',
      severity: 'warning',
      condition: 'cpuUsage > 80% for 3m',
      target: 'prod/nginx-gateway',
      state: 'active',
      version: 1,
      updatedAt: new Date().toISOString(),
    },
  ];

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutValue: T,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
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

  private buildUnavailableLiveSnapshot(
    clusterId: string,
    note: string,
  ): ClusterLiveUsageSnapshot {
    return {
      capturedAt: new Date().toISOString(),
      source: 'none',
      available: false,
      freshnessWindowMs: 60_000,
      cpuUsage: null,
      memoryUsage: null,
      pods: [],
      history: [],
      note: `cluster ${clusterId}: ${note}`,
    };
  }

  async getOverview(
    timeFilter: InspectionTimeFilter,
    actor?: Actor,
  ): Promise<MonitoringOverviewResponse> {
    const { range, from, to } = this.resolveTimeWindow(timeFilter, '24h');
    const clusterId = timeFilter.clusterId?.trim() || undefined;
    const scope = await this.resolveScope(actor, clusterId);
    const namespaceOnly = this.hasNamespaceOnlyScope(scope);
    const alertScope = [this.resourceScopeWhere(scope), this.secretScopeWhere(scope, 'resourceType')];
    const firedAt = this.buildDateRangeWhere(from, to);
    const activeClusterWhere: Prisma.ClusterRegistryWhereInput = {
      deletedAt: null,
      status: { not: 'deleted' },
      ...(clusterId ? { id: clusterId } : {}),
      AND: this.clusterScopeWhere(scope),
    };
    const [clusterTotal, clusterHealthy, warningCountRaw, criticalCountRaw] =
      await Promise.all([
        this.prisma.clusterRegistry.count({
          where: activeClusterWhere,
        }),
        this.prisma.clusterRegistry.count({
          where: {
            deletedAt: null,
            status: { in: ['healthy', '正常'] },
            ...(clusterId ? { id: clusterId } : {}),
            AND: this.clusterScopeWhere(scope, true),
          },
        }),
        this.prisma.monitoringAlert.count({
          where: this.activeClusterAlertWhere(
            {
              severity: 'warning',
              AND: alertScope,
              status: 'firing',
              ...(firedAt ? { firedAt } : {}),
            },
            clusterId,
          ),
        }),
        this.prisma.monitoringAlert.count({
          where: this.activeClusterAlertWhere(
            {
              severity: 'critical',
              AND: alertScope,
              status: 'firing',
              ...(firedAt ? { firedAt } : {}),
            },
            clusterId,
          ),
        }),
      ]);

    const firingTotal = warningCountRaw + criticalCountRaw;
    let warningCount = warningCountRaw;
    let criticalCount = criticalCountRaw;
    let dataSource: MonitoringOverviewResponse['dataSource'] =
      'monitoring-alert';
    let degraded = false;
    let note: string | undefined;

    if (firingTotal === 0) {
      const derived = await this.buildDerivedAlerts(400, clusterId, scope);
      warningCount = derived.filter(
        (item) => item.severity === 'warning',
      ).length;
      criticalCount = derived.filter(
        (item) => item.severity === 'critical',
      ).length;
      dataSource = 'workload-derived';
      degraded = true;
      note = '未检测到监控告警源数据，当前告警概览基于已同步工作负载状态推导。';
    }

    const healthyRatio = clusterTotal > 0 ? clusterHealthy / clusterTotal : 1;
    const criticalRatio = Math.min(criticalCount / 10, 1);
    const healthScore = Math.min(
      100,
      Math.max(0, Math.round(healthyRatio * 70 + (1 - criticalRatio) * 30)),
    );

    const activeClusters = await this.prisma.clusterRegistry.findMany({
      where: { ...activeClusterWhere, AND: namespaceOnly ? { id: { in: [] } } : this.clusterScopeWhere(scope, true) },
      select: { id: true },
    });
    const liveSnapshots = await this.runBounded(
      activeClusters,
      this.liveMetricsFanoutLimit,
      async (row) => {
        const kubeconfig = await this.clustersService.getKubeconfig(row.id);
        if (!kubeconfig) {
          return null;
        }
        return this.withTimeout(
          this.liveMetricsService.getClusterSnapshot(row.id, kubeconfig),
          this.liveMetricsTimeoutMs,
          this.buildUnavailableLiveSnapshot(row.id, 'live metrics timeout'),
        );
      },
    );
    const availableSnapshots = liveSnapshots.filter((snapshot) =>
      Boolean(snapshot?.available),
    );
    let cpuTotal = 0;
    let cpuCount = 0;
    let memoryTotal = 0;
    let memoryCount = 0;
    for (const snapshot of availableSnapshots) {
      for (const pod of snapshot?.pods ?? []) {
        if (typeof pod.cpuUsage === 'number') {
          cpuTotal += pod.cpuUsage;
          cpuCount += 1;
        }
        if (typeof pod.memoryUsage === 'number') {
          memoryTotal += pod.memoryUsage;
          memoryCount += 1;
        }
      }
    }
    const cpuUsagePercent =
      cpuCount > 0 ? Math.round((cpuTotal / cpuCount) * 100) : 0;
    const memoryUsagePercent =
      memoryCount > 0
        ? Math.round((memoryTotal / memoryCount / (1024 * 1024 * 1024)) * 100)
        : 0;

    const usageDataSource: MonitoringOverviewResponse['usageDataSource'] =
      availableSnapshots.length > 0 ? 'metrics-server' : 'none';
    if (!availableSnapshots.length) {
      degraded = true;
      note = note
        ? `${note} 未检测到 live metrics 数据。`
        : '未检测到 live metrics 数据，请先确认 metrics-server 与集群连通性。';
    }

    return {
      range,
      timestamp: new Date().toISOString(),
      healthScore: namespaceOnly ? null : healthScore,
      clusterTotal,
      clusterHealthy: namespaceOnly ? null : clusterHealthy,
      warningCount,
      criticalCount,
      cpuUsagePercent: namespaceOnly ? null : cpuUsagePercent,
      memoryUsagePercent: namespaceOnly ? null : memoryUsagePercent,
      usageDataSource,
      dataSource,
      degraded,
      note: namespaceOnly ? '当前授权仅包含命名空间，集群级健康评分和实时指标不可用。' : note,
      liveSnapshot: availableSnapshots[0] ?? undefined,
    };
  }

  async getObservabilitySummary(
    timeFilter: InspectionTimeFilter,
    actor?: Actor,
  ): Promise<ObservabilitySummaryResponse> {
    const window = {
      ...this.resolveTimeWindow(timeFilter, '24h'),
      clusterId: timeFilter.clusterId?.trim() || undefined,
    };
    // Authorization and namespace UIDs are re-evaluated on every HTTP request.
    if (actor !== undefined) return this.buildObservabilitySummary(window, actor);
    const key = this.observabilitySummaryCacheKey(window);
    const now = Date.now();
    this.pruneObservabilitySummaryCache(now);

    const cached = this.observabilitySummaryCache.get(key);
    if (cached && cached.expiresAt > now) {
      return this.cloneObservabilitySummary(cached.value);
    }

    const inFlight = this.observabilitySummaryInFlight.get(key);
    if (inFlight) {
      return this.cloneObservabilitySummary(await inFlight);
    }

    const next = this.buildObservabilitySummary(window);
    this.observabilitySummaryInFlight.set(key, next);
    try {
      const summary = await next;
      this.observabilitySummaryCache.set(key, {
        expiresAt: Date.now() + this.observabilitySummaryCacheTtlMs,
        value: this.cloneObservabilitySummary(summary),
      });
      this.pruneObservabilitySummaryCache();
      return this.cloneObservabilitySummary(summary);
    } finally {
      this.observabilitySummaryInFlight.delete(key);
    }
  }

  private async buildObservabilitySummary(window: {
    clusterId?: string;
    range: MonitoringRange;
    from?: Date;
    to?: Date;
  }, actor?: Actor): Promise<ObservabilitySummaryResponse> {
    const scope = await this.resolveScope(actor, window.clusterId);
    const namespaceOnly = this.hasNamespaceOnlyScope(scope);
    const [overview, alerts, events, inspection] = await Promise.all([
      this.getOverview(window, actor),
      this.getAlerts({
        clusterId: window.clusterId,
        page: 1,
        pageSize: 8,
        status: 'firing',
        range: window.range,
        from: window.from,
        to: window.to,
      }, actor),
      this.getEvents(window, actor),
      this.getClusterInspection(window.clusterId, undefined, window, actor),
    ]);
    const [
      namespaceTotal,
      workloadTotal,
      serviceTotal,
      podTotal,
      networkTotal,
    ] = await Promise.all([
      this.prisma.namespaceRecord.count({
        where: {
          AND: this.resourceScopeWhere(scope, 'name'),
          state: { not: 'deleted' },
          ...(window.clusterId ? { clusterId: window.clusterId } : {}),
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          AND: this.resourceScopeWhere(scope),
          state: { not: 'deleted' },
          ...(window.clusterId ? { clusterId: window.clusterId } : {}),
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.networkResource.count({
        where: {
          AND: this.resourceScopeWhere(scope),
          state: { not: 'deleted' },
          kind: 'Service',
          ...(window.clusterId ? { clusterId: window.clusterId } : {}),
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.workloadRecord.count({
        where: {
          AND: this.resourceScopeWhere(scope),
          state: { not: 'deleted' },
          kind: 'Pod',
          ...(window.clusterId ? { clusterId: window.clusterId } : {}),
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
      this.prisma.networkResource.count({
        where: {
          AND: this.resourceScopeWhere(scope),
          state: { not: 'deleted' },
          ...(window.clusterId ? { clusterId: window.clusterId } : {}),
          cluster: { deletedAt: null, status: { not: 'deleted' } },
        },
      }),
    ]);
    const criticalAlerts = alerts.items.filter(
      (item) => item.severity === 'critical',
    ).length;
    const warningAlerts = alerts.items.filter(
      (item) => item.severity === 'warning',
    ).length;
    const inspectionByCategory = new Map<
      InspectionIssue['category'],
      { warning: number; critical: number }
    >();
    for (const item of inspection.items) {
      const current = inspectionByCategory.get(item.category) ?? {
        warning: 0,
        critical: 0,
      };
      if (item.severity === 'critical') {
        current.critical += 1;
      } else if (item.severity === 'warning') {
        current.warning += 1;
      }
      inspectionByCategory.set(item.category, current);
    }

    const hasMetrics = overview.usageDataSource === 'metrics-server';
    const hasAlertSource = alerts.dataSource === 'monitoring-alert';
    const externalLinkByKey = actor !== undefined && !this.clusterAccessService.isPlatformAdmin(actor) ? {
      metrics: undefined, logs: undefined, traces: undefined, alerts: undefined, slo: undefined, runbook: undefined,
    } : {
      metrics: process.env.OBSERVABILITY_GRAFANA_URL,
      logs: process.env.OBSERVABILITY_LOGS_URL,
      traces: process.env.OBSERVABILITY_TRACES_URL,
      alerts: process.env.OBSERVABILITY_ALERTS_URL,
      slo: process.env.OBSERVABILITY_SLO_URL,
      runbook: process.env.OBSERVABILITY_RUNBOOK_URL,
    };
    const buildSignals = (): ObservabilityEntityHealth['signals'] => ({
      metrics: hasMetrics ? 'available' : 'degraded',
      logs: scope ? 'unavailable' : 'available',
      traces: externalLinkByKey.traces ? 'available' : 'unavailable',
      events: events.degraded ? 'degraded' : 'available',
      alerts: alerts.degraded ? 'degraded' : 'available',
    });
    const buildSlo = (
      entityCritical: number,
      entityWarning: number,
    ): ObservabilityEntityHealth['slo'] => {
      const burnRate = Math.min(10, entityCritical * 2 + entityWarning * 0.5);
      const remaining = Math.max(0, Math.round(100 - burnRate * 10));
      return {
        targetPercent: 99.9,
        burnRate,
        errorBudgetRemainingPercent: remaining,
        status: externalLinkByKey.slo
          ? remaining <= 0
            ? 'exhausted'
            : remaining < 30
              ? 'at-risk'
              : 'healthy'
          : 'unavailable',
      };
    };
    const buildEntityDeepLinks = (scope: ObservabilityEntityScope) => [
      {
        key: 'metrics',
        label: 'Grafana',
        url: externalLinkByKey.metrics
          ? `${externalLinkByKey.metrics}?var-scope=${scope}&from=${
              window.from?.toISOString() ?? ''
            }&to=${window.to?.toISOString() ?? ''}`
          : null,
        available: Boolean(externalLinkByKey.metrics),
      },
      {
        key: 'logs',
        label: 'Logs',
        url: externalLinkByKey.logs ?? null,
        available: Boolean(externalLinkByKey.logs),
      },
      {
        key: 'traces',
        label: 'Traces',
        url: externalLinkByKey.traces ?? null,
        available: Boolean(externalLinkByKey.traces),
      },
      {
        key: 'alerts',
        label: 'Alertmanager',
        url: externalLinkByKey.alerts ?? null,
        available: Boolean(externalLinkByKey.alerts),
      },
      {
        key: 'runbook',
        label: 'Runbook',
        url: externalLinkByKey.runbook ?? null,
        available: Boolean(externalLinkByKey.runbook),
      },
    ];

    const buildEntity = (
      scope: ObservabilityEntityScope,
      label: string,
      total: number,
      category?: InspectionIssue['category'],
      detailPath?: string,
    ): ObservabilityEntityHealth => {
      const categoryStats = category
        ? inspectionByCategory.get(category)
        : undefined;
      const warning = categoryStats?.warning ?? 0;
      const critical = categoryStats?.critical ?? 0;
      return {
        scope,
        label,
        total,
        warning,
        critical,
        status:
          total === 0
            ? 'unavailable'
            : critical > 0
              ? 'critical'
              : warning > 0
                ? 'warning'
                : 'healthy',
        detailPath,
        signals: buildSignals(),
        slo: buildSlo(critical, warning),
        alertOwner: process.env.OBSERVABILITY_ALERT_OWNER ?? 'platform-sre',
        runbookUrl: externalLinkByKey.runbook ?? null,
        notificationStatus: externalLinkByKey.alerts
          ? 'ready'
          : 'not-configured',
        deepLinks: buildEntityDeepLinks(scope),
      };
    };

    const sourceStatus: ObservabilitySourceStatus[] = [
      {
        key: 'metrics',
        label: 'Metrics',
        available: hasMetrics,
        degraded: !hasMetrics,
        note: hasMetrics
          ? 'metrics-server 数据可用'
          : '未检测到 metrics-server live metrics，指标面板降级。',
        deepLink: externalLinkByKey.metrics,
      },
      {
        key: 'logs',
        label: 'Logs',
        available: !scope,
        degraded: Boolean(scope),
        note: scope ? '日志访问需在目标 Pod 或日志中心独立校验授权。' : 'Kubernetes Pod 日志查询入口可用。',
        deepLink: externalLinkByKey.logs,
      },
      {
        key: 'traces',
        label: 'Traces',
        available: Boolean(externalLinkByKey.traces),
        degraded: !externalLinkByKey.traces,
        note: externalLinkByKey.traces
          ? 'Trace 后端深链已配置。'
          : '未配置 Trace 后端深链，链路面板显示不可用。',
        deepLink: externalLinkByKey.traces,
      },
      {
        key: 'events',
        label: 'Events',
        available: events.total > 0,
        degraded: events.degraded,
        note: events.note ?? '监控事件源可用。',
      },
      {
        key: 'alerts',
        label: 'Alerts',
        available: hasAlertSource,
        degraded: alerts.degraded,
        note: alerts.note ?? '告警源可用。',
        deepLink: externalLinkByKey.alerts,
      },
      {
        key: 'slo',
        label: 'SLO',
        available: Boolean(externalLinkByKey.slo),
        degraded: !externalLinkByKey.slo,
        note: externalLinkByKey.slo
          ? 'SLO 后端深链已配置。'
          : '未配置 SLO 后端，SLO 面板显示不可用。',
        deepLink: externalLinkByKey.slo,
      },
    ];

    const clusterCategory = inspectionByCategory.get('cluster');
    const clusterIssues =
      (clusterCategory?.warning ?? 0) + (clusterCategory?.critical ?? 0);
    const workspacePath = (path: string, globalPath: string) =>
      window.clusterId
        ? `/clusters/${encodeURIComponent(window.clusterId)}/${path}`
        : globalPath;
    const entities: ObservabilityEntityHealth[] = [
      buildEntity(
        'cluster',
        'Cluster',
        overview.clusterTotal,
        'cluster',
        workspacePath('overview', '/observability/cluster-health'),
      ),
      buildEntity(
        'namespace',
        'Namespace',
        namespaceTotal,
        'namespace',
        workspacePath('namespaces', '/namespaces'),
      ),
      buildEntity(
        'workload',
        'Workload',
        workloadTotal,
        'workload',
        workspacePath('workloads/pods', '/workloads/pods'),
      ),
      buildEntity(
        'service',
        'Service',
        serviceTotal,
        'network',
        workspacePath('network/services', '/network/services'),
      ),
      buildEntity(
        'pod',
        'Pod',
        podTotal,
        'workload',
        workspacePath('workloads/pods', '/workloads/pods'),
      ),
      buildEntity(
        'node',
        'Node',
        0,
        'cluster',
        workspacePath('nodes', '/clusters/nodes'),
      ),
      buildEntity(
        'network',
        'Network',
        networkTotal,
        'network',
        workspacePath('network/services', '/network/services'),
      ),
    ].map((entity) =>
      entity.scope === 'cluster'
        ? {
            ...entity,
            warning: namespaceOnly ? 0 : overview.clusterTotal - (overview.clusterHealthy ?? 0) + clusterIssues,
            status: namespaceOnly ? 'unavailable' as const : entity.status,
          }
        : entity,
    );

    const signalPanels: ObservabilitySignalPanel[] = [
      {
        key: 'metrics',
        title: '指标',
        status: hasMetrics ? 'available' : 'degraded',
        summary: hasMetrics
          ? `CPU ${overview.cpuUsagePercent}% / 内存 ${overview.memoryUsagePercent}%`
          : '指标源不可用，资源页保留静态状态。',
        updatedAt: overview.timestamp,
      },
      {
        key: 'logs',
        title: '日志',
        status: scope ? 'unavailable' : 'available',
        summary: scope ? '日志访问需在目标 Pod 或日志中心独立校验授权。' : 'Pod 日志查询与日志流入口可用。',
        updatedAt: overview.timestamp,
        detailPath: '/logs',
      },
      {
        key: 'traces',
        title: '链路',
        status: externalLinkByKey.traces ? 'available' : 'unavailable',
        summary: externalLinkByKey.traces
          ? 'Trace 后端深链已配置。'
          : '未配置 Trace 后端。',
        updatedAt: overview.timestamp,
      },
      {
        key: 'events',
        title: '事件',
        status: events.degraded ? 'degraded' : 'available',
        summary: `${events.total} 条事件，来源 ${events.dataSource}`,
        updatedAt: events.timestamp,
      },
      {
        key: 'alerts',
        title: '告警',
        status: alerts.degraded ? 'degraded' : 'available',
        summary: `${alerts.total} 条活跃告警，critical ${criticalAlerts} / warning ${warningAlerts}`,
        updatedAt: alerts.timestamp,
      },
      {
        key: 'slo',
        title: 'SLO',
        status: externalLinkByKey.slo ? 'available' : 'unavailable',
        summary: externalLinkByKey.slo
          ? 'SLO 后端深链已配置。'
          : '未配置 SLO 后端。',
        updatedAt: overview.timestamp,
      },
    ];

    const degraded =
      overview.degraded ||
      alerts.degraded ||
      events.degraded ||
      sourceStatus.some((item) => item.degraded);

    return {
      range: window.range,
      timestamp: new Date().toISOString(),
      timeRange: {
        from: (window.from ?? new Date()).toISOString(),
        to: (window.to ?? new Date()).toISOString(),
      },
      healthScore: overview.healthScore,
      activeAlerts: {
        critical: criticalAlerts,
        warning: warningAlerts,
        total: alerts.total,
        source: alerts.dataSource,
        degraded: alerts.degraded,
      },
      sourceStatus,
      entities,
      signalPanels,
      recentEvents: events.items.slice(0, 8),
      externalLinks: sourceStatus.map((item) => ({
        key: item.key,
        label: item.label,
        url: item.deepLink ?? null,
        available: Boolean(item.deepLink),
      })),
      degraded,
      note: [
        overview.note,
        alerts.note,
        events.note,
        degraded
          ? '部分数据源不可用；页面按数据源隔离降级，其他面板继续可用。'
          : undefined,
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  private observabilitySummaryCacheKey(window: {
    clusterId?: string;
    range: MonitoringRange;
    from?: Date;
    to?: Date;
  }): string {
    return [
      window.clusterId ?? '',
      window.range,
      window.from?.toISOString() ?? '',
      window.to?.toISOString() ?? '',
      process.env.OBSERVABILITY_GRAFANA_URL ?? '',
      process.env.OBSERVABILITY_LOGS_URL ?? '',
      process.env.OBSERVABILITY_TRACES_URL ?? '',
      process.env.OBSERVABILITY_ALERTS_URL ?? '',
      process.env.OBSERVABILITY_SLO_URL ?? '',
      process.env.OBSERVABILITY_RUNBOOK_URL ?? '',
      process.env.OBSERVABILITY_ALERT_OWNER ?? '',
    ].join('|');
  }

  private pruneObservabilitySummaryCache(now = Date.now()): void {
    for (const [key, cached] of this.observabilitySummaryCache) {
      if (cached.expiresAt <= now) {
        this.observabilitySummaryCache.delete(key);
      }
    }

    while (
      this.observabilitySummaryCache.size >
      this.maxObservabilitySummaryCacheEntries
    ) {
      const oldestKey = this.observabilitySummaryCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) {
        break;
      }
      this.observabilitySummaryCache.delete(oldestKey);
    }
  }

  private cloneObservabilitySummary(
    summary: ObservabilitySummaryResponse,
  ): ObservabilitySummaryResponse {
    return {
      ...summary,
      timeRange: { ...summary.timeRange },
      activeAlerts: { ...summary.activeAlerts },
      sourceStatus: summary.sourceStatus.map((item) => ({ ...item })),
      entities: summary.entities.map((entity) => ({
        ...entity,
        signals: { ...entity.signals },
        slo: { ...entity.slo },
        deepLinks: entity.deepLinks.map((link) => ({ ...link })),
      })),
      signalPanels: summary.signalPanels.map((panel) => ({ ...panel })),
      recentEvents: summary.recentEvents.map((event) => ({ ...event })),
      externalLinks: summary.externalLinks.map((link) => ({ ...link })),
    };
  }

  async getEvents(
    timeFilter: InspectionTimeFilter,
    actor?: Actor,
  ): Promise<MonitoringEventsResponse> {
    const { range, from, to } = this.resolveTimeWindow(timeFilter, '1h');
    const clusterId = timeFilter.clusterId?.trim() || undefined;
    const scope = await this.resolveScope(actor, clusterId);
    const firedAt = this.buildDateRangeWhere(from, to);
    const rows = await this.prisma.monitoringAlert.findMany({
      where: this.activeClusterAlertWhere(
        {
          ...(firedAt ? { firedAt } : {}),
          AND: [this.resourceScopeWhere(scope), this.secretScopeWhere(scope, 'resourceType')],
        },
        clusterId,
      ),
      orderBy: { firedAt: 'desc' },
      take: 200,
    });

    const itemsFromAlerts: MonitoringEventItem[] = rows.map((row) => ({
      id: row.id,
      level:
        row.severity === 'critical'
          ? 'CRITICAL'
          : row.severity === 'warning'
            ? 'WARN'
            : 'INFO',
      source:
        row.source ??
        [
          row.clusterId ?? '-',
          row.namespace ?? '-',
          row.resourceName ?? '-',
        ].join('/'),
      message: row.message,
      timestamp: row.firedAt.toISOString(),
    }));

    if (itemsFromAlerts.length > 0) {
      return {
        range,
        timestamp: new Date().toISOString(),
        total: itemsFromAlerts.length,
        items: itemsFromAlerts,
        dataSource: 'monitoring-alert',
        degraded: false,
      };
    }

    const derived = await this.buildDerivedAlerts(200, clusterId, scope);
    const items: MonitoringEventItem[] = derived.map((item) => ({
      id: item.id,
      level: item.severity === 'critical' ? 'CRITICAL' : 'WARN',
      source:
        item.source ??
        [
          item.clusterId ?? '-',
          item.namespace ?? '-',
          item.resourceName ?? '-',
        ].join('/'),
      message: item.message,
      timestamp: item.firedAt,
    }));

    return {
      range,
      timestamp: new Date().toISOString(),
      total: items.length,
      items,
      dataSource: 'workload-derived',
      degraded: true,
      note: '未检测到监控事件源数据，当前事件列表由已同步工作负载状态推导。',
    };
  }

  async resolveAlert(id: string, actor: Actor | undefined): Promise<AlertItem> {
    assertWritePermission(actor);
    if (!actor?.id?.trim() || !this.clusterAccessService.isKnownPlatformRole(actor)) throw new ForbiddenException();
    const record = await this.prisma.monitoringAlert.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('告警不存在');
    }

    if (record.clusterId) {
      const scope = await this.resolveScope(actor ?? {}, record.clusterId, record.namespace ?? undefined, true);
      const secret = ['secret', 'secrets'].includes(record.resourceType?.toLowerCase() ?? '');
      const pairs = secret ? scope?.secrets : scope?.resources;
      if (pairs && !pairs.some(pair => pair.clusterId === record.clusterId && (!pair.namespace || pair.namespace === record.namespace))) throw new ForbiddenException();
    } else {
      this.clusterAccessService.assertPlatformAdmin(actor);
    }

    const updated = await this.prisma.monitoringAlert.update({
      where: { id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
      },
    });

    return {
      id: updated.id,
      clusterId: updated.clusterId,
      namespace: updated.namespace,
      severity: updated.severity,
      title: updated.title,
      message: updated.message,
      source: updated.source,
      resourceType: updated.resourceType,
      resourceName: updated.resourceName,
      status: updated.status,
      firedAt: updated.firedAt.toISOString(),
      resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
    };
  }

  async getAlerts(query: AlertsQuery, actor?: Actor): Promise<AlertsResponse> {
    const scope = await this.resolveScope(actor, query.clusterId?.trim() || undefined);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;
    const { from, to } = this.resolveTimeWindow(
      {
        range: query.range,
        from: query.from,
        to: query.to,
      },
      '24h',
    );
    const firedAt = this.buildDateRangeWhere(from, to);

    const where: Prisma.MonitoringAlertWhereInput = {
      AND: [this.resourceScopeWhere(scope), this.secretScopeWhere(scope, 'resourceType')],
    };
    if (query.severity) {
      where['severity'] = query.severity;
    }
    if (query.status) {
      where['status'] = query.status;
    }
    if (firedAt) {
      where['firedAt'] = firedAt;
    }

    const clusterId = query.clusterId?.trim() || undefined;
    const normalizedWhere = this.activeClusterAlertWhere(where, clusterId);

    const [total, records] = await Promise.all([
      this.prisma.monitoringAlert.count({ where: normalizedWhere }),
      this.prisma.monitoringAlert.findMany({
        where: normalizedWhere,
        orderBy: { firedAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    // Fallback to derived real-time alerts from synced workload data
    if (total === 0) {
      const derivedItems = (await this.buildDerivedAlerts(300, clusterId, scope))
        .filter((item) =>
          query.severity ? item.severity === query.severity : true,
        )
        .filter((item) => (query.status ? item.status === query.status : true));

      const derivedTotal = derivedItems.length;
      const pageItems = derivedItems.slice(skip, skip + pageSize);
      return {
        items: pageItems,
        total: derivedTotal,
        page,
        pageSize,
        timestamp: new Date().toISOString(),
        dataSource: 'workload-derived',
        degraded: true,
        note: '未检测到监控告警源数据，当前列表基于已同步工作负载状态推导。',
      };
    }

    const items: AlertItem[] = records.map((r) => ({
      id: r.id,
      clusterId: r.clusterId,
      namespace: r.namespace,
      severity: r.severity,
      title: r.title,
      message: r.message,
      source: r.source,
      resourceType: r.resourceType,
      resourceName: r.resourceName,
      status: r.status,
      firedAt: r.firedAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    }));

    return {
      items,
      total,
      page,
      pageSize,
      timestamp: new Date().toISOString(),
      dataSource: 'monitoring-alert',
      degraded: false,
    };
  }

  async getClusterInspection(
    clusterId?: string,
    namespace?: string,
    timeFilter?: InspectionTimeFilter,
    actor?: Actor,
  ): Promise<ClusterInspectionReport> {
    const { from, to } = this.resolveTimeWindow(timeFilter, '24h');
    const updatedAt = this.buildDateRangeWhere(from, to);
    const firedAt = this.buildDateRangeWhere(from, to);
    const namespaceFilter = namespace?.trim();
    const scope = await this.resolveScope(actor, clusterId, namespaceFilter);
    const clusters = await this.prisma.clusterRegistry.findMany({
      where: {
        deletedAt: null,
        status: { not: 'deleted' },
        ...(clusterId ? { id: clusterId } : {}),
        AND: this.clusterScopeWhere(scope),
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    const clusterIds = clusters.map((c) => c.id);
    const [namespaces, workloads, networks, storages, configs, firingAlerts] =
      await Promise.all([
        this.prisma.namespaceRecord.findMany({
          where: {
            AND: this.resourceScopeWhere(scope, 'name'),
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
            ...(namespaceFilter ? { name: namespaceFilter } : {}),
            ...(updatedAt ? { updatedAt } : {}),
          },
          select: { clusterId: true, name: true, state: true, labels: true },
        }),
        this.prisma.workloadRecord.findMany({
          where: {
            AND: this.resourceScopeWhere(scope),
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
            ...(namespaceFilter ? { namespace: namespaceFilter } : {}),
            ...(updatedAt ? { updatedAt } : {}),
          },
          select: {
            id: true,
            clusterId: true,
            namespace: true,
            kind: true,
            name: true,
            state: true,
            replicas: true,
            readyReplicas: true,
            labels: true,
            annotations: true,
            spec: true,
          },
        }),
        this.prisma.networkResource.findMany({
          where: {
            AND: this.resourceScopeWhere(scope),
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
            ...(namespaceFilter ? { namespace: namespaceFilter } : {}),
            ...(updatedAt ? { updatedAt } : {}),
          },
          select: {
            id: true,
            clusterId: true,
            namespace: true,
            kind: true,
            name: true,
            state: true,
            spec: true,
          },
        }),
        this.prisma.storageResource.findMany({
          where: {
            AND: this.resourceScopeWhere(scope),
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
            ...(namespaceFilter ? { namespace: namespaceFilter } : {}),
            ...(updatedAt ? { updatedAt } : {}),
          },
          select: {
            id: true,
            clusterId: true,
            namespace: true,
            kind: true,
            name: true,
            state: true,
            bindingMode: true,
          },
        }),
        this.prisma.configResource.findMany({
          where: {
            AND: [this.resourceScopeWhere(scope), this.secretScopeWhere(scope)],
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
            ...(namespaceFilter ? { namespace: namespaceFilter } : {}),
            ...(updatedAt ? { updatedAt } : {}),
          },
          select: {
            id: true,
            clusterId: true,
            namespace: true,
            kind: true,
            name: true,
            state: true,
            dataKeys: true,
          },
        }),
        this.prisma.monitoringAlert.findMany({
          where: this.activeClusterAlertWhere({
            AND: [this.resourceScopeWhere(scope), this.secretScopeWhere(scope, 'resourceType')],
            status: 'firing',
            clusterId: { in: clusterIds },
            ...(namespaceFilter ? { namespace: namespaceFilter } : {}),
            ...(firedAt ? { firedAt } : {}),
          }),
          orderBy: { firedAt: 'desc' },
          take: 300,
        }),
      ]);

    const items: InspectionIssue[] = [];
    const pushIssue = (issue: Omit<InspectionIssue, 'id'>) => {
      const rawId = [
        issue.category,
        issue.severity,
        issue.clusterId ?? '',
        issue.namespace ?? '',
        issue.resourceRef,
        issue.title,
      ].join('|');
      items.push({
        id: this.buildInspectionIssueId(rawId),
        ...issue,
      });
    };

    const fullClusters = scope ? clusters.filter(cluster => scope.resources.some(pair => pair.clusterId === cluster.id && !pair.namespace)) : clusters;
    fullClusters.forEach((cluster) => {
      const status = (cluster.status ?? '').toLowerCase();
      if (status && !['healthy', '正常', 'ready'].includes(status)) {
        pushIssue({
          severity: 'critical',
          category: 'cluster',
          title: '集群健康状态异常',
          resourceRef: `Cluster/${cluster.name}`,
          resourceKind: 'Cluster',
          clusterId: cluster.id,
          suggestion: '检查 apiserver、节点和网络连通性，恢复到 Healthy 状态。',
          evidence: `当前状态：${cluster.status}`,
          actions: this.defaultIssueActions('cluster'),
        });
      }
    });

    namespaces.forEach((ns) => {
      if (ns.state !== 'active') {
        pushIssue({
          severity: 'warning',
          category: 'namespace',
          title: '名称空间状态非 active',
          resourceRef: `Namespace/${ns.name}`,
          resourceKind: 'Namespace',
          clusterId: ns.clusterId,
          namespace: ns.name,
          suggestion:
            '确认名称空间生命周期策略，避免业务误用异常状态名称空间。',
          evidence: `state=${ns.state}`,
          actions: this.defaultIssueActions('namespace'),
        });
      }

      const labels = this.toStringMap(ns.labels);
      const hasAdmissionPolicy =
        Boolean(labels['pod-security.kubernetes.io/enforce']) ||
        Boolean(labels['admission.policy/enforced']) ||
        Boolean(labels['policy.kubenova.io/enabled']);
      if (!hasAdmissionPolicy && ns.name !== 'kube-system') {
        pushIssue({
          severity: 'warning',
          category: 'security',
          title: '名称空间缺少准入策略标识',
          resourceRef: `Namespace/${ns.name}`,
          resourceKind: 'Namespace',
          clusterId: ns.clusterId,
          namespace: ns.name,
          suggestion: '为业务名称空间启用 PSA/准入策略并标识策略版本。',
          evidence: '未检测到 pod-security.kubernetes.io/enforce / policy 标识',
          actions: this.defaultIssueActions('security'),
        });
      }
    });

    workloads.forEach((workload) => {
      const ref = `${workload.kind}/${workload.namespace}/${workload.name}`;
      if (workload.state !== 'active') {
        pushIssue({
          severity: 'warning',
          category: 'workload',
          title: '工作负载状态非 active',
          resourceRef: ref,
          resourceKind: workload.kind,
          clusterId: workload.clusterId,
          namespace: workload.namespace,
          suggestion:
            '确认该资源是否应继续提供服务，必要时恢复为 active 或清理。',
          evidence: `state=${workload.state}`,
          actions: this.defaultIssueActions('workload'),
        });
      }

      const replicas = workload.replicas ?? 0;
      const readyReplicas = workload.readyReplicas ?? 0;
      if (replicas > 0 && readyReplicas < replicas) {
        pushIssue({
          severity: readyReplicas === 0 ? 'critical' : 'warning',
          category: 'workload',
          title: '副本未完全就绪',
          resourceRef: ref,
          resourceKind: workload.kind,
          clusterId: workload.clusterId,
          namespace: workload.namespace,
          suggestion: '排查镜像、探针、资源配额和事件，恢复到期望就绪副本数。',
          evidence: `ready=${readyReplicas}/${replicas}`,
          actions: this.defaultIssueActions('workload'),
        });
      }

      if (
        ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(workload.kind) &&
        replicas >= 2 &&
        !this.hasAutoscaleHint(
          workload.spec,
          workload.labels,
          workload.annotations,
        )
      ) {
        pushIssue({
          severity: 'warning',
          category: 'workload',
          title: '缺少弹性伸缩策略（HPA/VPA）',
          resourceRef: ref,
          resourceKind: workload.kind,
          clusterId: workload.clusterId,
          namespace: workload.namespace,
          suggestion: '建议为关键工作负载配置 HPA（可选 VPA）并设置合理阈值。',
          evidence: `replicas=${replicas}, 未检测到 autoscaling/hpa/vpa 标识`,
          actions: [
            {
              type: 'create-hpa-draft',
              label: '创建 HPA 草案',
              description: '基于当前工作负载快速生成 autoscaling/v2 HPA 草案。',
            },
            {
              type: 'generate-yaml',
              label: '生成修复 YAML',
              description: '生成可评审的修复 YAML 片段，支持手动调整后应用。',
            },
          ],
        });
      }
    });

    networks.forEach((resource) => {
      const ref = `${resource.kind}/${resource.namespace}/${resource.name}`;
      if (resource.state !== 'active') {
        pushIssue({
          severity: 'warning',
          category: 'network',
          title: '网络资源状态非 active',
          resourceRef: ref,
          resourceKind: resource.kind,
          clusterId: resource.clusterId,
          namespace: resource.namespace,
          suggestion: '确认网络资源是否仍在使用，避免产生无效路由和流量黑洞。',
          evidence: `state=${resource.state}`,
          actions: this.defaultIssueActions('network'),
        });
      }

      if (resource.kind === 'Service') {
        const spec = this.toRecord(resource.spec);
        const ports = Array.isArray(spec.ports) ? spec.ports : [];
        if (ports.length === 0) {
          pushIssue({
            severity: 'warning',
            category: 'network',
            title: 'Service 未配置端口',
            resourceRef: ref,
          resourceKind: resource.kind,
            clusterId: resource.clusterId,
            namespace: resource.namespace,
            suggestion: '补充 Service 端口定义并核对 selector 与后端工作负载。',
            actions: this.defaultIssueActions('network'),
          });
        }
      }
      if (resource.kind === 'Ingress') {
        const spec = this.toRecord(resource.spec);
        const rules = Array.isArray(spec.rules) ? spec.rules : [];
        if (rules.length === 0) {
          pushIssue({
            severity: 'critical',
            category: 'network',
            title: 'Ingress 未配置规则',
            resourceRef: ref,
          resourceKind: resource.kind,
            clusterId: resource.clusterId,
            namespace: resource.namespace,
            suggestion: '补充 host/path 路由规则并校验后端 Service 可达性。',
            actions: this.defaultIssueActions('network'),
          });
        }
      }
    });

    storages.forEach((resource) => {
      const ref = `${resource.kind}/${resource.namespace ?? '-'}/${resource.name}`;
      if (resource.state !== 'active') {
        pushIssue({
          severity: 'warning',
          category: 'storage',
          title: '存储资源状态非 active',
          resourceRef: ref,
          resourceKind: resource.kind,
          clusterId: resource.clusterId,
          namespace: resource.namespace,
          suggestion: '排查存储后端和绑定关系，避免存储资源长期不可用。',
          evidence: `state=${resource.state}`,
          actions: this.defaultIssueActions('storage'),
        });
      }
      if (resource.kind === 'PVC' && resource.bindingMode === 'Pending') {
        pushIssue({
          severity: 'warning',
          category: 'storage',
          title: 'PVC 长时间 Pending',
          resourceRef: ref,
          resourceKind: resource.kind,
          clusterId: resource.clusterId,
          namespace: resource.namespace,
          suggestion: '检查 StorageClass、容量与节点可用区，尽快完成绑定。',
          evidence: 'bindingMode=Pending',
          actions: this.defaultIssueActions('storage'),
        });
      }
    });

    configs.forEach((resource) => {
      const ref = `${resource.kind}/${resource.namespace}/${resource.name}`;
      const keyCount = Array.isArray(resource.dataKeys)
        ? resource.dataKeys.length
        : 0;
      if (resource.state !== 'active') {
        pushIssue({
          severity: 'warning',
          category: 'config',
          title: '配置资源状态非 active',
          resourceRef: ref,
          resourceKind: resource.kind,
          clusterId: resource.clusterId,
          namespace: resource.namespace,
          suggestion: '确认配置资源是否仍被业务依赖，避免灰色配置残留。',
          evidence: `state=${resource.state}`,
          actions: this.defaultIssueActions('config'),
        });
      }
      if (keyCount === 0) {
        pushIssue({
          severity: 'warning',
          category: 'config',
          title: `${resource.kind} 未包含有效键值`,
          resourceRef: ref,
          resourceKind: resource.kind,
          clusterId: resource.clusterId,
          namespace: resource.namespace,
          suggestion: '检查配置内容是否正确同步，避免空配置导致应用启动失败。',
          actions: this.defaultIssueActions('config'),
        });
      }
    });

    firingAlerts.forEach((alert) => {
      pushIssue({
        severity: alert.severity === 'critical' ? 'critical' : 'warning',
        category: 'alert',
        resourceKind: alert.resourceType,
        title: `活跃告警：${alert.title}`,
        resourceRef: `${alert.resourceType ?? 'Resource'}/${alert.namespace ?? '-'}/${alert.resourceName ?? '-'}`,
        clusterId: alert.clusterId,
        namespace: alert.namespace,
        suggestion: '优先处理活跃告警并确认恢复后自动关闭。',
        evidence: alert.message,
        actions: this.defaultIssueActions('alert'),
      });
    });

    const totalResources =
      fullClusters.length +
      namespaces.length +
      workloads.length +
      networks.length +
      storages.length +
      configs.length;
    const critical = items.filter(
      (item) => item.severity === 'critical',
    ).length;
    const warning = items.filter((item) => item.severity === 'warning').length;
    const issueTotal = items.length;
    const pass = Math.max(0, totalResources - issueTotal);
    const score = Math.max(
      0,
      Math.min(100, Math.round(100 - (critical * 3.5 + warning * 1.2))),
    );

    return {
      timestamp: new Date().toISOString(),
      clusterId,
      namespace: namespaceFilter,
      summary: {
        score,
        totalResources,
        issueTotal,
        critical,
        warning,
        pass,
      },
      items,
    };
  }

  async rerunClusterInspection(
    clusterId?: string,
    namespace?: string,
    timeFilter?: InspectionTimeFilter,
    actor?: Actor,
  ): Promise<ClusterInspectionReport> {
    return this.getClusterInspection(clusterId, namespace, timeFilter, actor);
  }

  async exportAlerts(
    query: AlertsQuery,
    format: InspectionExportFormat,
    actor?: Actor,
  ): Promise<AlertsExportResult> {
    const alerts = await this.getAlerts({
      ...query,
      page: 1,
      pageSize: 5000,
    }, actor);
    const timestampSegment = new Date()
      .toISOString()
      .replace(/[:]/g, '-')
      .replace(/\..+$/, '')
      .replace('T', '_');
    const baseName = `alerts-${timestampSegment}`;

    if (format === 'json') {
      return {
        filename: `${baseName}.json`,
        contentType: 'application/json; charset=utf-8',
        data: JSON.stringify(alerts, null, 2),
      };
    }

    if (format === 'csv') {
      return {
        filename: `${baseName}.csv`,
        contentType: 'text/csv; charset=utf-8',
        data: `\uFEFF${this.buildAlertsCsv(alerts)}`,
      };
    }

    return {
      filename: `${baseName}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: this.buildAlertsWorkbook(alerts),
    };
  }

  async exportClusterInspectionReport(
    clusterId: string | undefined,
    namespace: string | undefined,
    format: InspectionExportFormat,
    timeFilter?: InspectionTimeFilter,
    actor?: Actor,
  ): Promise<InspectionReportExportResult> {
    const report = await this.getClusterInspection(
      clusterId,
      namespace,
      timeFilter,
      actor,
    );
    const clusterSegment = clusterId?.trim()
      ? clusterId.trim()
      : 'all-clusters';
    const namespaceSegment = namespace?.trim() ? `-${namespace.trim()}` : '';
    const timestampSegment = report.timestamp
      .replace(/[:]/g, '-')
      .replace(/\..+$/, '')
      .replace('T', '_');
    const baseName = `inspection-report-${clusterSegment}${namespaceSegment}-${timestampSegment}`;

    if (format === 'json') {
      return {
        filename: `${baseName}.json`,
        contentType: 'application/json; charset=utf-8',
        data: JSON.stringify(report, null, 2),
      };
    }

    if (format === 'csv') {
      const csv = this.buildInspectionReportCsv(report);
      return {
        filename: `${baseName}.csv`,
        contentType: 'text/csv; charset=utf-8',
        data: `\uFEFF${csv}`,
      };
    }

    return {
      filename: `${baseName}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: this.buildInspectionReportWorkbook(report),
    };
  }

  async executeInspectionAction(
    issueId: string,
    action: InspectionActionType,
    request: ExecuteInspectionActionRequest,
    actor?: Actor,
  ): Promise<InspectionActionResponse> {
    const report = await this.getClusterInspection(
      request.clusterId?.trim() || undefined,
      request.namespace?.trim() || undefined,
      undefined,
      actor,
    );
    const issue = report.items.find((item) => item.id === issueId);
    if (!issue) {
      throw new NotFoundException('巡检问题项不存在或已过期，请重新巡检。');
    }
    if (actor !== undefined) {
      const scope = await this.resolveScope(actor, issue.clusterId ?? undefined, issue.namespace ?? undefined, true);
      const secret = ['secret', 'secrets'].includes(issue.resourceKind?.toLowerCase() ?? '');
      const clusterResource = ['Cluster', 'Namespace', 'Node', 'PV', 'PersistentVolume', 'StorageClass', 'SC'].includes(issue.resourceKind ?? '');
      const pairs = secret ? scope?.secrets : scope?.resources;
      if (pairs && !pairs.some(pair => pair.clusterId === issue.clusterId && (!pair.namespace || (!clusterResource && pair.namespace === issue.namespace)))) throw new ForbiddenException();
    }

    const supportedAction = issue.actions.find((item) => item.type === action);
    if (!supportedAction) {
      throw new BadRequestException('该问题项不支持此修复动作。');
    }

    if (action === 'create-hpa-draft') {
      const hpaYaml = this.buildHpaDraftYaml(issue);
      return {
        issueId,
        action,
        success: true,
        message: 'HPA 草案已生成，可复制到集群中评审后应用。',
        generatedYaml: hpaYaml,
        target: this.parseResourceRef(
          issue.resourceRef,
          issue.clusterId ?? undefined,
        ),
      };
    }

    return {
      issueId,
      action,
      success: true,
      message: '修复 YAML 已生成，请在应用前完成评审。',
      generatedYaml: this.buildGenericFixYaml(issue),
      target: this.parseResourceRef(
        issue.resourceRef,
        issue.clusterId ?? undefined,
      ),
    };
  }

  private async buildDerivedAlerts(
    limit: number,
    clusterId?: string,
    scope?: MonitoringScope,
  ): Promise<AlertItem[]> {
    const derived = await this.prisma.workloadRecord.findMany({
      where: {
        AND: this.resourceScopeWhere(scope),
        state: { not: 'deleted' },
        ...(clusterId ? { clusterId } : {}),
        cluster: { deletedAt: null },
        OR: [
          {
            kind: 'Pod',
            OR: [
              { statusJson: { path: ['phase'], equals: 'Failed' } },
              { statusJson: { path: ['phase'], equals: 'Pending' } },
            ],
          },
          {
            NOT: { kind: 'Pod' },
            replicas: { not: null },
            readyReplicas: { not: null },
          },
        ],
      },
      select: {
        id: true,
        clusterId: true,
        namespace: true,
        kind: true,
        name: true,
        replicas: true,
        readyReplicas: true,
        statusJson: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    return derived
      .map((row): AlertItem | null => {
        if (row.kind === 'Pod') {
          const status =
            row.statusJson &&
            typeof row.statusJson === 'object' &&
            !Array.isArray(row.statusJson)
              ? (row.statusJson as Record<string, unknown>)
              : {};
          const phase =
            typeof status.phase === 'string' ? status.phase : 'Unknown';
          if (phase !== 'Failed' && phase !== 'Pending') {
            return null;
          }
          return {
            id: `derived-${row.id}`,
            clusterId: row.clusterId,
            namespace: row.namespace,
            severity: phase === 'Failed' ? 'critical' : 'warning',
            title: `Pod 状态异常：${row.name}`,
            message: `Pod ${row.namespace}/${row.name} 当前阶段：${phase}`,
            source: 'k8s-sync-derived',
            resourceType: 'Pod',
            resourceName: row.name,
            status: 'firing',
            firedAt: row.updatedAt.toISOString(),
            resolvedAt: null,
          };
        }

        const replicas = row.replicas ?? 0;
        const ready = row.readyReplicas ?? 0;
        if (replicas <= 0 || ready >= replicas) {
          return null;
        }
        return {
          id: `derived-${row.id}`,
          clusterId: row.clusterId,
          namespace: row.namespace,
          severity: ready === 0 ? 'critical' : 'warning',
          title: `${row.kind} 副本未就绪：${row.name}`,
          message: `${row.kind} ${row.namespace}/${row.name} 就绪 ${ready}/${replicas}`,
          source: 'k8s-sync-derived',
          resourceType: row.kind,
          resourceName: row.name,
          status: 'firing',
          firedAt: row.updatedAt.toISOString(),
          resolvedAt: null,
        };
      })
      .filter((item): item is AlertItem => Boolean(item));
  }

  listAlertRules(actor?: Actor): MonitoringAlertRulesResponse {
    if (actor !== undefined) this.assertRuleAdministration(actor);
    return {
      items: this.alertRules,
      total: this.alertRules.length,
      timestamp: new Date().toISOString(),
    };
  }

  createAlertRule(
    actor: Actor | undefined,
    body: CreateAlertRuleRequest,
  ): AlertRuleItem {
    assertWritePermission(actor);
    this.assertRuleAdministration(actor);
    const name = body?.name?.trim();
    const condition = body?.condition?.trim();
    const target = body?.target?.trim();

    if (!name || !condition || !target) {
      throw new BadRequestException('name/condition/target 为必填字段');
    }
    if (!this.isSeverity(body.severity)) {
      throw new BadRequestException('severity 仅支持 critical/warning/info');
    }

    const created: AlertRuleItem = {
      id: `rule-${Date.now()}`,
      name,
      severity: body.severity,
      condition,
      target,
      state: 'active',
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    this.alertRules.unshift(created);
    this.audit(actor, 'create', created.id);
    return created;
  }

  updateAlertRule(
    actor: Actor | undefined,
    id: string,
    body: UpdateAlertRuleRequest,
  ): AlertRuleItem {
    assertWritePermission(actor);
    this.assertRuleAdministration(actor);
    const item = this.findRule(id);

    if (body.name !== undefined) {
      const nextName = body.name.trim();
      if (!nextName) {
        throw new BadRequestException('name 不能为空');
      }
      item.name = nextName;
    }

    if (body.condition !== undefined) {
      const nextCondition = body.condition.trim();
      if (!nextCondition) {
        throw new BadRequestException('condition 不能为空');
      }
      item.condition = nextCondition;
    }

    if (body.target !== undefined) {
      const nextTarget = body.target.trim();
      if (!nextTarget) {
        throw new BadRequestException('target 不能为空');
      }
      item.target = nextTarget;
    }

    if (body.severity !== undefined) {
      if (!this.isSeverity(body.severity)) {
        throw new BadRequestException('severity 仅支持 critical/warning/info');
      }
      item.severity = body.severity;
    }

    item.version += 1;
    item.updatedAt = new Date().toISOString();
    this.audit(actor, 'update', item.id);
    return item;
  }

  deleteAlertRule(
    actor: Actor | undefined,
    id: string,
  ): { id: string; deleted: true; state: 'deleted'; version: number } {
    assertWritePermission(actor);
    this.assertRuleAdministration(actor);
    const index = this.findRuleIndex(id);
    const removed = this.alertRules[index];
    this.alertRules.splice(index, 1);
    this.audit(actor, 'delete', removed.id);

    return {
      id: removed.id,
      deleted: true,
      state: 'deleted',
      version: removed.version + 1,
    };
  }

  setAlertRuleState(
    actor: Actor | undefined,
    id: string,
    state: ResourceState,
  ): AlertRuleItem {
    assertWritePermission(actor);
    this.assertRuleAdministration(actor);
    const item = this.findRule(id);
    item.state = state;
    item.version += 1;
    item.updatedAt = new Date().toISOString();
    this.audit(actor, state === 'active' ? 'enable' : 'disable', item.id);
    return item;
  }

  private assertRuleAdministration(actor?: Actor): void {
    if (!actor?.id?.trim()) throw new ForbiddenException();
    this.clusterAccessService.assertPlatformAdmin(actor);
  }

  private findRule(id: string): AlertRuleItem {
    const item = this.alertRules.find((candidate) => candidate.id === id);
    if (!item) {
      throw new NotFoundException('告警规则不存在');
    }
    return item;
  }

  private findRuleIndex(id: string): number {
    const index = this.alertRules.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      throw new NotFoundException('告警规则不存在');
    }
    return index;
  }

  private isSeverity(value: string): value is AlertRuleItem['severity'] {
    return value === 'critical' || value === 'warning' || value === 'info';
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private toStringMap(value: unknown): Record<string, string> {
    const record = this.toRecord(value);
    const result: Record<string, string> = {};
    Object.entries(record).forEach(([k, v]) => {
      if (typeof v === 'string' && v.trim()) {
        result[k] = v;
      }
    });
    return result;
  }

  private hasAutoscaleHint(
    spec: unknown,
    labels: unknown,
    annotations: unknown,
  ): boolean {
    const specObj = this.toRecord(spec);
    const labelMap = this.toStringMap(labels);
    const annoMap = this.toStringMap(annotations);

    const specHint =
      specObj.autoscaling !== undefined ||
      specObj.hpa !== undefined ||
      specObj.vpa !== undefined;

    const textHints = [
      ...Object.keys(labelMap),
      ...Object.values(labelMap),
      ...Object.keys(annoMap),
      ...Object.values(annoMap),
    ]
      .join(' ')
      .toLowerCase();

    return (
      specHint ||
      textHints.includes('hpa') ||
      textHints.includes('vpa') ||
      textHints.includes('autoscaling')
    );
  }

  private defaultIssueActions(
    category: InspectionIssue['category'],
  ): InspectionIssueAction[] {
    return [
      {
        type: 'generate-yaml',
        label: '生成修复 YAML',
        description: `生成 ${category} 类问题的修复 YAML 草案。`,
      },
    ];
  }

  private buildInspectionIssueId(raw: string): string {
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    let hash = 2166136261;
    for (let index = 0; index < raw.length; index += 1) {
      hash ^= raw.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }

    return `issue-${slug || 'item'}-${hash.toString(36)}`;
  }

  private parseResourceRef(
    ref: string,
    clusterId?: string,
  ): NonNullable<InspectionActionResponse['target']> {
    const parts = ref.split('/');
    if (parts.length >= 3) {
      return {
        kind: parts[0],
        namespace: parts[1] === '-' ? undefined : parts[1],
        name: parts[2],
        clusterId,
      };
    }
    if (parts.length === 2) {
      return {
        kind: parts[0],
        name: parts[1],
        clusterId,
      };
    }
    return {
      kind: 'Resource',
      name: ref,
      clusterId,
    };
  }

  private buildInspectionReportCsv(report: ClusterInspectionReport): string {
    const summaryRows = [
      ['timestamp', report.timestamp],
      ['clusterId', report.clusterId ?? ''],
      ['namespace', report.namespace ?? ''],
      ['score', String(report.summary.score)],
      ['totalResources', String(report.summary.totalResources)],
      ['issueTotal', String(report.summary.issueTotal)],
      ['critical', String(report.summary.critical)],
      ['warning', String(report.summary.warning)],
      ['pass', String(report.summary.pass)],
    ];

    const itemHeader = [
      'id',
      'severity',
      'category',
      'title',
      'resourceRef',
      'clusterId',
      'namespace',
      'suggestion',
      'evidence',
      'actions',
    ];

    const itemRows = report.items.map((item) => [
      item.id,
      item.severity,
      item.category,
      item.title,
      item.resourceRef,
      item.clusterId ?? '',
      item.namespace ?? '',
      item.suggestion,
      item.evidence ?? '',
      (item.actions ?? []).map((action) => action.type).join('|'),
    ]);

    return [...summaryRows, [], itemHeader, ...itemRows]
      .map((row) => row.map((cell) => this.toCsvCell(cell)).join(','))
      .join('\n');
  }

  private buildInspectionReportWorkbook(
    report: ClusterInspectionReport,
  ): Buffer {
    const workbook = XLSX.utils.book_new();

    const summaryData = [
      { key: 'timestamp', value: report.timestamp },
      { key: 'clusterId', value: report.clusterId ?? '' },
      { key: 'namespace', value: report.namespace ?? '' },
      { key: 'score', value: report.summary.score },
      { key: 'totalResources', value: report.summary.totalResources },
      { key: 'issueTotal', value: report.summary.issueTotal },
      { key: 'critical', value: report.summary.critical },
      { key: 'warning', value: report.summary.warning },
      { key: 'pass', value: report.summary.pass },
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'summary');

    const issueData = report.items.map((item) => ({
      id: item.id,
      severity: item.severity,
      category: item.category,
      title: item.title,
      resourceRef: item.resourceRef,
      clusterId: item.clusterId ?? '',
      namespace: item.namespace ?? '',
      suggestion: item.suggestion,
      evidence: item.evidence ?? '',
      actions: (item.actions ?? []).map((action) => action.type).join('|'),
    }));
    const issuesSheet = XLSX.utils.json_to_sheet(issueData);
    XLSX.utils.book_append_sheet(workbook, issuesSheet, 'issues');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  private buildAlertsCsv(alerts: AlertsResponse): string {
    const header = [
      'id',
      'severity',
      'status',
      'title',
      'message',
      'clusterId',
      'namespace',
      'resourceType',
      'resourceName',
      'source',
      'firedAt',
      'resolvedAt',
    ];
    const rows = alerts.items.map((item) => [
      item.id,
      item.severity,
      item.status,
      item.title,
      item.message,
      item.clusterId ?? '',
      item.namespace ?? '',
      item.resourceType ?? '',
      item.resourceName ?? '',
      item.source ?? '',
      item.firedAt,
      item.resolvedAt ?? '',
    ]);

    return [header, ...rows]
      .map((row) => row.map((cell) => this.toCsvCell(cell)).join(','))
      .join('\n');
  }

  private buildAlertsWorkbook(alerts: AlertsResponse): Buffer {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(
      alerts.items.map((item) => ({
        id: item.id,
        severity: item.severity,
        status: item.status,
        title: item.title,
        message: item.message,
        clusterId: item.clusterId ?? '',
        namespace: item.namespace ?? '',
        resourceType: item.resourceType ?? '',
        resourceName: item.resourceName ?? '',
        source: item.source ?? '',
        firedAt: item.firedAt,
        resolvedAt: item.resolvedAt ?? '',
      })),
    );
    XLSX.utils.book_append_sheet(workbook, sheet, 'alerts');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  private toCsvCell(value: string): string {
    const escaped = String(value ?? '').replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private buildHpaDraftYaml(issue: InspectionIssue): string {
    const target = this.parseResourceRef(
      issue.resourceRef,
      issue.clusterId ?? undefined,
    );
    const targetKindValue = target.kind ?? '';
    const targetKind = ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(
      targetKindValue,
    )
      ? targetKindValue
      : 'Deployment';
    const targetName = target.name ?? 'replace-workload';
    const namespace = target.namespace ?? issue.namespace ?? 'default';

    return `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${targetName}-hpa
  namespace: ${namespace}
  annotations:
    aiops.kubenova.io/generated-by: inspection
    aiops.kubenova.io/issue-id: ${issue.id}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: ${targetKind}
    name: ${targetName}
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 75
`;
  }

  private buildGenericFixYaml(issue: InspectionIssue): string {
    const target = this.parseResourceRef(
      issue.resourceRef,
      issue.clusterId ?? undefined,
    );
    const namespace = target.namespace ?? issue.namespace ?? 'default';
    const sanitize = (value: string): string =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 42) || 'issue';

    return `apiVersion: v1
kind: ConfigMap
metadata:
  name: inspection-fix-${sanitize(issue.id)}
  namespace: ${namespace}
  labels:
    aiops.kubenova.io/type: inspection-fix
    aiops.kubenova.io/severity: ${issue.severity}
data:
  issueId: "${issue.id}"
  title: "${issue.title.replace(/"/g, '\\"')}"
  category: "${issue.category}"
  resourceRef: "${issue.resourceRef}"
  recommendation: "${issue.suggestion.replace(/"/g, '\\"')}"
  nextStep: "Review and convert this draft into concrete resource patches before kubectl apply."
`;
  }

  private audit(
    actor: Actor | undefined,
    action: 'create' | 'update' | 'delete' | 'enable' | 'disable',
    resourceId: string,
  ): void {
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action,
      resourceType: 'alert-rules',
      resourceId,
      result: 'success',
    });
  }
}
