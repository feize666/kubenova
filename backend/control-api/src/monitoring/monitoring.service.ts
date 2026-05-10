import {
  BadRequestException,
  Injectable,
  NotFoundException,
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

export type MonitoringRange = '15m' | '1h' | '6h' | '24h' | '7d';
type ResourceState = 'active' | 'disabled';

interface Actor {
  username?: string;
  role?: PlatformRole;
}

export interface MonitoringOverviewResponse {
  range: MonitoringRange;
  timestamp: string;
  healthScore: number;
  clusterTotal: number;
  clusterHealthy: number;
  warningCount: number;
  criticalCount: number;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
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
}

export interface InspectionTimeFilter {
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly clustersService: ClustersService,
    private readonly liveMetricsService: LiveMetricsService,
  ) {}

  private activeClusterAlertWhere(
    base: Prisma.MonitoringAlertWhereInput = {},
  ): Prisma.MonitoringAlertWhereInput {
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

  async getOverview(
    timeFilter: InspectionTimeFilter,
  ): Promise<MonitoringOverviewResponse> {
    const { range, from, to } = this.resolveTimeWindow(timeFilter, '24h');
    const firedAt = this.buildDateRangeWhere(from, to);
    const [clusterTotal, clusterHealthy, warningCountRaw, criticalCountRaw] =
      await Promise.all([
        this.prisma.clusterRegistry.count({
          where: { deletedAt: null, status: { not: 'deleted' } },
        }),
        this.prisma.clusterRegistry.count({
          where: {
            deletedAt: null,
            status: { in: ['healthy', '正常'] },
          },
        }),
        this.prisma.monitoringAlert.count({
          where: this.activeClusterAlertWhere({
            severity: 'warning',
            status: 'firing',
            ...(firedAt ? { firedAt } : {}),
          }),
        }),
        this.prisma.monitoringAlert.count({
          where: this.activeClusterAlertWhere({
            severity: 'critical',
            status: 'firing',
            ...(firedAt ? { firedAt } : {}),
          }),
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
      const derived = await this.buildDerivedAlerts(400);
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
      where: { deletedAt: null, status: { not: 'deleted' } },
      select: { id: true },
    });
    const liveSnapshots = await Promise.all(
      activeClusters.map(async (row) => {
        const kubeconfig = await this.clustersService.getKubeconfig(row.id);
        if (!kubeconfig) {
          return null;
        }
        return this.liveMetricsService.getClusterSnapshot(row.id, kubeconfig);
      }),
    );
    const availableSnapshots = liveSnapshots.filter((snapshot) =>
      Boolean(snapshot?.available),
    );
    const livePodSnapshots = availableSnapshots.flatMap(
      (snapshot) => snapshot?.pods ?? [],
    );
    const cpuValues = livePodSnapshots
      .map((item) => item.cpuUsage)
      .filter((value): value is number => typeof value === 'number');
    const memoryValues = livePodSnapshots
      .map((item) => item.memoryUsage)
      .filter((value): value is number => typeof value === 'number');
    const cpuUsagePercent =
      cpuValues.length > 0
        ? Math.round(
            (cpuValues.reduce((sum, item) => sum + item, 0) /
              cpuValues.length) *
              100,
          )
        : 0;
    const memoryUsagePercent =
      memoryValues.length > 0
        ? Math.round(
            (memoryValues.reduce((sum, item) => sum + item, 0) /
              memoryValues.length /
              (1024 * 1024 * 1024)) *
              100,
          )
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
      healthScore,
      clusterTotal,
      clusterHealthy,
      warningCount,
      criticalCount,
      cpuUsagePercent,
      memoryUsagePercent,
      usageDataSource,
      dataSource,
      degraded,
      note,
      liveSnapshot: availableSnapshots[0] ?? undefined,
    };
  }

  async getEvents(
    timeFilter: InspectionTimeFilter,
  ): Promise<MonitoringEventsResponse> {
    const { range, from, to } = this.resolveTimeWindow(timeFilter, '1h');
    const firedAt = this.buildDateRangeWhere(from, to);
    const rows = await this.prisma.monitoringAlert.findMany({
      where: this.activeClusterAlertWhere({
        ...(firedAt ? { firedAt } : {}),
      }),
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

    const derived = await this.buildDerivedAlerts(200);
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

  async resolveAlert(id: string): Promise<AlertItem> {
    const record = await this.prisma.monitoringAlert.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('告警不存在');
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

  async getAlerts(query: AlertsQuery): Promise<AlertsResponse> {
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

    const where: Prisma.MonitoringAlertWhereInput = {};
    if (query.severity) {
      where['severity'] = query.severity;
    }
    if (query.status) {
      where['status'] = query.status;
    }
    if (firedAt) {
      where['firedAt'] = firedAt;
    }

    const normalizedWhere = this.activeClusterAlertWhere(where);

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
      const derivedItems = (await this.buildDerivedAlerts(300))
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
    timeFilter?: InspectionTimeFilter,
  ): Promise<ClusterInspectionReport> {
    const { from, to } = this.resolveTimeWindow(timeFilter, '24h');
    const updatedAt = this.buildDateRangeWhere(from, to);
    const firedAt = this.buildDateRangeWhere(from, to);
    const clusters = await this.prisma.clusterRegistry.findMany({
      where: {
        deletedAt: null,
        status: { not: 'deleted' },
        ...(clusterId ? { id: clusterId } : {}),
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
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
            ...(updatedAt ? { updatedAt } : {}),
          },
          select: { clusterId: true, name: true, state: true, labels: true },
        }),
        this.prisma.workloadRecord.findMany({
          where: {
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
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
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
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
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
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
            clusterId: { in: clusterIds },
            state: { not: 'deleted' },
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
            status: 'firing',
            ...(clusterIds.length > 0 ? { clusterId: { in: clusterIds } } : {}),
            ...(firedAt ? { firedAt } : {}),
          }),
          orderBy: { firedAt: 'desc' },
          take: 300,
        }),
      ]);

    const items: InspectionIssue[] = [];
    const pushIssue = (issue: Omit<InspectionIssue, 'id'>) => {
      items.push({
        id: `issue-${items.length + 1}`,
        ...issue,
      });
    };

    clusters.forEach((cluster) => {
      const status = (cluster.status ?? '').toLowerCase();
      if (status && !['healthy', '正常', 'ready'].includes(status)) {
        pushIssue({
          severity: 'critical',
          category: 'cluster',
          title: '集群健康状态异常',
          resourceRef: `Cluster/${cluster.name}`,
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
      clusters.length +
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
    timeFilter?: InspectionTimeFilter,
  ): Promise<ClusterInspectionReport> {
    return this.getClusterInspection(clusterId, timeFilter);
  }

  async exportAlerts(
    query: AlertsQuery,
    format: InspectionExportFormat,
  ): Promise<AlertsExportResult> {
    const alerts = await this.getAlerts({
      ...query,
      page: 1,
      pageSize: 5000,
    });
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
    format: InspectionExportFormat,
    timeFilter?: InspectionTimeFilter,
  ): Promise<InspectionReportExportResult> {
    const report = await this.getClusterInspection(clusterId, timeFilter);
    const clusterSegment = clusterId?.trim()
      ? clusterId.trim()
      : 'all-clusters';
    const timestampSegment = report.timestamp
      .replace(/[:]/g, '-')
      .replace(/\..+$/, '')
      .replace('T', '_');
    const baseName = `inspection-report-${clusterSegment}-${timestampSegment}`;

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
  ): Promise<InspectionActionResponse> {
    const report = await this.getClusterInspection(
      request.clusterId?.trim() || undefined,
    );
    const issue = report.items.find((item) => item.id === issueId);
    if (!issue) {
      throw new NotFoundException('巡检问题项不存在或已过期，请重新巡检。');
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

  private async buildDerivedAlerts(limit: number): Promise<AlertItem[]> {
    const derived = await this.prisma.workloadRecord.findMany({
      where: {
        state: { not: 'deleted' },
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

  listAlertRules(): MonitoringAlertRulesResponse {
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
    const item = this.findRule(id);
    item.state = state;
    item.version += 1;
    item.updatedAt = new Date().toISOString();
    this.audit(actor, state === 'active' ? 'enable' : 'disable', item.id);
    return item;
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
