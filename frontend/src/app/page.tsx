"use client";

import {
  ArrowRightOutlined,
  AlertOutlined,
  AppstoreOutlined,
  BellOutlined,
  CheckCircleOutlined,
  ClusterOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FireOutlined,
  GlobalOutlined,
  HddOutlined,
  LineChartOutlined,
  NodeIndexOutlined,
  RadarChartOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Skeleton, Space } from "antd";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { useAuth } from "@/components/auth-context";
import { OpsFilterChip, OpsPageHeader, OpsScopeSelector, OpsStatusTag, type OpsScopeSelectorOption } from "@/components/ops";
import { MetricUnitFormatter } from "@/components/visual-system";
import { getClusters } from "@/lib/api/clusters";
import { getDashboardStats, type DashboardStats } from "@/lib/api/dashboard";

type DashboardStatsQueryResult = {
  stats: DashboardStats;
  scopedFallback: boolean;
};

type ServiceImpact = NonNullable<DashboardStats["serviceImpact"]>;
type RecentOperation = NonNullable<DashboardStats["recentOperations"]>[number];
type ImpactNode = ServiceImpact["nodes"][number];
type ImpactSeverity = ServiceImpact["impactedServices"][number]["severity"];

function formatAge(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "刚刚";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function getUsageSubtitle(params: {
  dataSource: "metrics-server" | "k8s-metadata" | "none";
  degraded: boolean;
  note?: string;
}) {
  if (params.degraded) {
    return params.note ?? "请先执行集群同步以获取真实 CPU/内存数据。";
  }
  return "集群平均";
}

function formatLiveCpu(value?: number | null) {
  return MetricUnitFormatter({ kind: "cpu", value });
}

function formatLiveMemory(value?: number | null) {
  return MetricUnitFormatter({ kind: "memory", value });
}

function formatScopedHref(path: string, clusterId: string) {
  return clusterId ? `${path}?clusterId=${encodeURIComponent(clusterId)}` : path;
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${Math.round(value)}%`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function MiniTrendChart({
  tone,
  value,
  height = 92,
  valueLabel = "使用率",
  formatPointValue,
}: {
  tone: "blue" | "green";
  value?: number;
  height?: number;
  valueLabel?: string;
  formatPointValue?: (value: number) => string;
}) {
  const base = typeof value === "number" && Number.isFinite(value) ? clampPercent(value) : 52;
  const points = [base - 10, base - 4, base + 8, base + 5, base + 13, base - 2, base + 4, base].map(clampPercent);
  const width = 280;
  const step = width / (points.length - 1);
  const timeLabels = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "22:00", "24:00"];
  const chartPoints = points.map((point, index) => ({
    value: Math.round(point),
    time: timeLabels[index] ?? `${index}:00`,
    x: index * step,
    y: height - (point / 100) * (height - 18) - 8,
    label: formatPointValue ? formatPointValue(point) : `${Math.round(point)}%`,
  }));
  const path = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = `0,${height - 8} ${path} ${width},${height - 8}`;

  return (
    <svg className={`ops-overview-trend ops-overview-trend--${tone}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="趋势图">
      <line x1="0" y1="20" x2={width} y2="20" className="ops-overview-trend__limit" />
      <line x1="0" y1={height - 8} x2={width} y2={height - 8} className="ops-overview-trend__grid" />
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="ops-overview-trend__grid" />
      <polygon points={areaPath} className="ops-overview-trend__area" />
      <polyline points={path} className="ops-overview-trend__line" />
      {chartPoints.map((point, index) => {
        const tooltipX = Math.min(Math.max(point.x - 38, 4), width - 78);
        const tooltipY = Math.max(point.y - 42, 4);
        return (
          <g
            key={`${point.time}-${index}`}
            className="ops-overview-trend__point"
            tabIndex={0}
            aria-label={`${point.time} ${valueLabel} ${point.label}`}
          >
            <line x1={point.x} y1="20" x2={point.x} y2={height - 8} className="ops-overview-trend__hover-line" />
            <circle cx={point.x} cy={point.y} r="4" className="ops-overview-trend__dot" />
            <rect x={tooltipX} y={tooltipY} width="76" height="34" rx="6" className="ops-overview-trend__tooltip-box" />
            <text x={tooltipX + 8} y={tooltipY + 14} className="ops-overview-trend__tooltip-time">{point.time}</text>
            <text x={tooltipX + 8} y={tooltipY + 27} className="ops-overview-trend__tooltip-value">
              {valueLabel} {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HealthGauge({ score }: { score: number }) {
  const percent = clampPercent(score);
  return (
    <div className="ops-overview-gauge" aria-label={`健康评分 ${percent}`}>
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="46" className="ops-overview-gauge__track" />
        <circle
          cx="60"
          cy="60"
          r="46"
          className="ops-overview-gauge__value"
          pathLength="100"
          strokeDasharray={`${percent} 100`}
        />
      </svg>
      <div className="ops-overview-gauge__text">
        <strong>{percent}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

function OverviewCard({
  title,
  scope,
  action,
  children,
  className,
}: {
  title: string;
  scope?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={["ops-overview-card", className].filter(Boolean).join(" ")}>
      <div className="ops-overview-card__header">
        <div className="ops-overview-card__heading">
          <div className="ops-overview-card__title">{title}</div>
          {scope ? <span className="ops-overview-card__scope">{scope}</span> : null}
        </div>
        {action}
      </div>
      <div className="ops-overview-card__body">{children}</div>
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ops-overview-summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BarRow({
  label,
  value,
  percent,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  percent: number;
  tone?: "red" | "orange" | "green" | "blue";
}) {
  return (
    <div className="ops-overview-bar-row">
      <span>{label}</span>
      <div className="ops-overview-bar-row__track">
        <i className={`ops-overview-bar-row__value ops-overview-bar-row__value--${tone}`} style={{ width: `${clampPercent(percent)}%` }} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function getImpactNodeToneClass(status?: ImpactNode["status"]) {
  if (status === "healthy") return "ops-overview-impact-node--ok";
  if (status === "warning") return "ops-overview-impact-node--warn";
  if (status === "critical") return "ops-overview-impact-node--danger";
  return "";
}

function getImpactTone(severity: ImpactSeverity | undefined): "red" | "orange" | "green" | "blue" {
  if (severity === "critical") return "red";
  if (severity === "warning") return "orange";
  if (severity === "healthy") return "green";
  return "blue";
}

function getImpactStatusLabel(severity: ImpactSeverity | undefined) {
  if (severity === "critical") return "严重";
  if (severity === "warning") return "告警";
  if (severity === "healthy") return "健康";
  return "关注";
}

function getOperationStatus(operation: RecentOperation) {
  return operation.result === "failure"
    ? { tone: "danger" as const, label: "失败" }
    : { tone: "success" as const, label: "成功" };
}

function formatOperationDetail(operation: RecentOperation) {
  const resource = [operation.resourceType, operation.resourceId].filter(Boolean).join("/");
  return [resource, operation.actor, formatAge(operation.timestamp)].filter(Boolean).join(" · ");
}

function ImpactMap({ impact }: { impact?: ServiceImpact }) {
  const fallbackNodes: ServiceImpact["nodes"] = [
    { id: "internet", label: "Internet", kind: "internet", status: "healthy" },
    { id: "ingress", label: "Ingress", kind: "ingress", status: "unknown" },
    { id: "service-0", label: "Service", kind: "service", status: "unknown" },
    { id: "service-1", label: "Workload", kind: "workload", status: "unknown" },
    { id: "service-2", label: "Pod", kind: "workload", status: "unknown" },
    { id: "backend", label: "backend", kind: "database", status: "unknown" },
  ];
  const nodes = impact?.nodes?.length ? impact.nodes : fallbackNodes;
  const getNode = (id: string, fallbackIndex: number) =>
    nodes.find((node) => node.id === id) ?? nodes[fallbackIndex] ?? fallbackNodes[fallbackIndex];
  const internet = getNode("internet", 0);
  const ingress = getNode("ingress", 1);
  const service0 = getNode("service-0", 2);
  const service1 = getNode("service-1", 3);
  const service2 = getNode("service-2", 4);
  const backend = getNode("backend", 5);

  return (
    <div className="ops-overview-impact-map" aria-label="服务影响拓扑">
      <svg className="ops-overview-impact-links" viewBox="0 0 420 172" aria-hidden>
        <path d="M86 86 H124" />
        <path d="M204 86 C228 48 250 42 282 42" />
        <path d="M204 86 H282" />
        <path d="M204 86 C228 124 250 132 282 132" />
        <path className="is-danger" d="M332 86 H362" />
      </svg>
      <div className={`ops-overview-impact-node ops-overview-impact-node--edge ${getImpactNodeToneClass(internet.status)} is-internet`}>
        {internet.label}
      </div>
      <div className={`ops-overview-impact-node ${getImpactNodeToneClass(ingress.status)} is-gateway`}>
        {ingress.label}
      </div>
      <div className={`ops-overview-impact-node ${getImpactNodeToneClass(service0.status)} is-user`}>
        {service0.label}
      </div>
      <div className={`ops-overview-impact-node ${getImpactNodeToneClass(service1.status)} is-order`}>
        {service1.label}
      </div>
      <div className={`ops-overview-impact-node ${getImpactNodeToneClass(service2.status)} is-payment`}>
        {service2.label}
      </div>
      <div className={`ops-overview-impact-node ${getImpactNodeToneClass(backend.status)} is-db`}>
        {backend.label}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { accessToken, isInitializing } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clusterId = searchParams.get("clusterId")?.trim() || "";

  const clustersQuery = useQuery({
    queryKey: ["clusters", "overview-scope", accessToken],
    queryFn: () => getClusters({ state: "active", selectableOnly: true, pageSize: 500 }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const scopeOptions = useMemo<OpsScopeSelectorOption[]>(
    () =>
      (clustersQuery.data?.items ?? []).map((item) => ({
        value: item.id,
        label: item.name,
        description: [item.environment, item.provider].filter(Boolean).join(" · ") || "已接入",
      })),
    [clustersQuery.data?.items],
  );

  const selectedCluster = useMemo(
    () => (clustersQuery.data?.items ?? []).find((item) => item.id === clusterId),
    [clusterId, clustersQuery.data?.items],
  );

  const updateClusterScope = useCallback(
    (nextClusterId?: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (nextClusterId) {
        next.set("clusterId", nextClusterId);
      } else {
        next.delete("clusterId");
      }
      const query = next.toString();
      router.replace(query ? `/?${query}` : "/");
    },
    [router, searchParams],
  );

  const statsQuery = useQuery<DashboardStatsQueryResult>({
    queryKey: ["dashboard", "stats", clusterId, accessToken],
    queryFn: async () => {
      try {
        const stats = await getDashboardStats(clusterId ? { clusterId } : {}, accessToken || undefined);
        return { stats, scopedFallback: false };
      } catch (error) {
        if (!clusterId) {
          throw error;
        }
        const stats = await getDashboardStats(accessToken || undefined);
        return { stats, scopedFallback: true };
      }
    },
    enabled: !isInitializing && Boolean(accessToken),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const stats = statsQuery.data?.stats;
  const isLoading = statsQuery.isLoading;
  const scopedFallback = Boolean(statsQuery.data?.scopedFallback);
  const scopedDegraded = Boolean(stats?.scope?.degraded);
  const scopeLabel = selectedCluster?.name ?? (clusterId ? `Cluster ${clusterId.slice(0, 8)}` : "全部集群");

  const riskSummary = useMemo(() => {
    const critical = stats?.alerts.critical ?? 0;
    const unhealthy = stats?.workloads.unhealthy ?? 0;
    const clusterWarning = stats?.clusters.warning ?? 0;
    const healthScore = stats?.healthScore ?? 0;
    const riskLevel =
      critical > 0 ? "critical" : unhealthy > 0 || clusterWarning > 0 ? "warning" : "success";
    return {
      critical,
      unhealthy,
      clusterWarning,
      healthScore,
      riskLevel,
    } as const;
  }, [stats]);

  const timelineItems = useMemo(
    () =>
      (stats?.recentEvents ?? []).slice(0, 6).map((item) => ({
        id: item.id,
        title: item.event,
        source: item.source,
        time: formatAge(item.timestamp),
        level: item.level,
      })),
    [stats?.recentEvents],
  );

  const resourceUsageSummary = useMemo(() => {
    const usage = stats?.resourceUsage;
    if (!usage) {
      return {
        cpuUsagePercent: undefined as number | undefined,
        memoryUsagePercent: undefined as number | undefined,
        dataSource: "none" as const,
        degraded: true,
        note: isLoading
          ? "正在加载实时使用率数据。"
          : "未检测到可用的 CPU/内存使用率同步数据，请先执行集群同步。",
      };
    }

    return {
      cpuUsagePercent: usage.cpuUsagePercent,
      memoryUsagePercent: usage.memoryUsagePercent,
      dataSource: usage.dataSource,
      degraded: usage.degraded,
      note: usage.note,
      liveSnapshot: usage.liveSnapshot,
    };
  }, [isLoading, stats?.resourceUsage]);

  const liveSnapshot = resourceUsageSummary.liveSnapshot;
  const showResourceUsageWarning = Boolean(stats?.resourceUsage?.degraded) && !isLoading;

  const topology = stats?.topology;
  const serviceImpactRows = useMemo(
    () =>
      (stats?.serviceImpact?.impactedServices ?? []).slice(0, 5).map((item) => ({
        id: [item.clusterId, item.namespace, item.name].filter(Boolean).join(":") || item.name,
        label: item.namespace ? `${item.namespace}/${item.name}` : item.name,
        value: getImpactStatusLabel(item.severity),
        percent: item.impactScore,
        tone: getImpactTone(item.severity),
      })),
    [stats?.serviceImpact?.impactedServices],
  );
  const recentOperationItems = useMemo(
    () =>
      (stats?.recentOperations ?? []).slice(0, 6).map((item) => ({
        ...item,
        status: getOperationStatus(item),
        detail: item.reason ? `${formatOperationDetail(item)} · ${item.reason}` : formatOperationDetail(item),
      })),
    [stats?.recentOperations],
  );

  const actions = [
    {
      href: formatScopedHref("/network/topology", clusterId),
      label: "资源拓扑",
      icon: <NodeIndexOutlined />,
      primary: true,
    },
    {
      href: formatScopedHref("/inspection", clusterId),
      label: "资源巡检",
      icon: <RadarChartOutlined />,
    },
    {
      href: formatScopedHref("/workloads/deployments", clusterId),
      label: "工作负载",
      icon: <DeploymentUnitOutlined />,
    },
    {
      href: formatScopedHref("/workloads/helm", clusterId),
      label: "Helm 应用",
      icon: <ThunderboltOutlined />,
    },
  ];

  return (
    <div className={["ops-overview-shell", statsQuery.isFetching ? "ops-scoped-loading" : undefined].filter(Boolean).join(" ")}>
      <OpsPageHeader
        className="ops-overview-header"
        title="总览"
        subtitle={`${scopeLabel} 的风险态势、资源容量、服务影响与运维入口`}
        actions={(
          <Space size={8} wrap className="ops-overview-header__chips">
          <OpsStatusTag tone={riskSummary.riskLevel}>{riskSummary.riskLevel === "critical" ? "高风险" : riskSummary.riskLevel === "warning" ? "需关注" : "稳定"}</OpsStatusTag>
          <OpsFilterChip tone="info" icon={<ClusterOutlined />}>集群 {stats?.clusters.total ?? 0}</OpsFilterChip>
          <OpsFilterChip tone="warning">活跃告警 {stats?.alerts.total ?? 0}</OpsFilterChip>
          {clusterId ? <OpsFilterChip tone="neutral">单集群</OpsFilterChip> : <OpsFilterChip tone="neutral">全部集群</OpsFilterChip>}
          </Space>
        )}
      />

      {scopedFallback ? (
        <Alert
          type="warning"
          showIcon
          title="集群作用域数据暂不可用"
          description="已回退到全局仪表盘数据，页面仍可继续使用。"
        />
      ) : null}

      {scopedDegraded ? (
        <Alert
          type="warning"
          showIcon
          title="集群作用域数据不可用"
          description={stats?.scope?.degradedReason ?? "当前选择的集群不存在或已删除。"}
        />
      ) : null}

      {statsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="仪表盘数据加载失败"
          description={statsQuery.error instanceof Error ? statsQuery.error.message : "请稍后重试。"}
        />
      ) : null}

      {clustersQuery.isError ? (
        <Alert
          type="warning"
          showIcon
          title="集群选择器加载失败"
          description="可继续查看当前仪表盘数据。"
        />
      ) : null}

      {showResourceUsageWarning && stats?.resourceUsage ? (
        <Alert
          type="warning"
          showIcon
          title="资源使用率数据降级"
          description={
            <Space size={8} wrap>
              <span>{stats.resourceUsage.note ?? "请先执行集群同步以获取真实 CPU/内存数据。"}</span>
              <OpsFilterChip tone="neutral">来源: {stats.resourceUsage.dataSource}</OpsFilterChip>
            </Space>
          }
        />
      ) : null}

      <section className="ops-overview-scope-strip" aria-label="范围和当前态势">
        <div className="ops-overview-scope-cell">
          <span>集群范围</span>
          <strong><GlobalOutlined /> {clusterId ? "单集群" : "全部集群"}</strong>
        </div>
        <div className="ops-overview-scope-cell ops-overview-scope-cell--selector">
          <span>或选择集群</span>
          <OpsScopeSelector
            value={clusterId || undefined}
            options={scopeOptions}
            onChange={updateClusterScope}
            loading={clustersQuery.isLoading}
            placeholder="选择集群"
            allLabel="全部集群"
            allDescription="全局态势"
          />
        </div>
        <div className={`ops-overview-scope-cell ops-overview-scope-cell--risk ops-overview-scope-cell--${riskSummary.riskLevel}`}>
          <span>当前风险态势</span>
          <strong><FireOutlined /> {riskSummary.riskLevel === "critical" ? "高风险" : riskSummary.riskLevel === "warning" ? "需关注" : "稳定"}</strong>
          <em>风险分 {100 - riskSummary.healthScore} / 100</em>
        </div>
        <div className="ops-overview-scope-cell ops-overview-scope-cell--status">
          <span>集群运行状态</span>
          <div className="ops-overview-status-inline">
            <b className="is-ok">正常 {stats?.clusters.healthy ?? 0}</b>
            <b className="is-warn">警告 {stats?.clusters.warning ?? 0}</b>
            <b className="is-danger">严重 {riskSummary.critical}</b>
          </div>
        </div>
        <div className="ops-overview-scope-cell ops-overview-scope-cell--summary">
          <span>概览摘要（{scopeLabel}）</span>
          <div className="ops-overview-summary-row">
            <SummaryMetric label="集群数" value={stats?.clusters.total ?? 0} />
            <SummaryMetric label="命名空间" value={stats?.namespaces ?? 0} />
            <SummaryMetric label="工作负载" value={stats?.workloads.total ?? 0} />
            <SummaryMetric label="Pod 数" value={topology?.pods ?? 0} />
            <SummaryMetric label="告警数" value={stats?.alerts.total ?? 0} />
          </div>
        </div>
      </section>

      <section className="ops-overview-grid" aria-label="风险卡片">
        <div className="ops-overview-span-3">
          <OverviewCard title="健康评分" scope={scopeLabel} action={<CheckCircleOutlined />}>
            <div className="ops-overview-health">
              <HealthGauge score={riskSummary.healthScore} />
              <MiniTrendChart tone="blue" value={riskSummary.healthScore} height={108} valueLabel="评分" formatPointValue={(point) => String(Math.round(point))} />
            </div>
            <div className="ops-overview-delta">较昨日 <span className={riskSummary.healthScore >= 70 ? "is-up" : "is-down"}>{riskSummary.healthScore >= 70 ? "↑" : "↓"} {Math.abs(riskSummary.healthScore - 70)}</span></div>
          </OverviewCard>
        </div>
        <div className="ops-overview-span-3">
          <OverviewCard title="严重告警" scope={scopeLabel} action={<AlertOutlined />}>
            <div className="ops-overview-big-number is-danger">{riskSummary.critical}<span>↑</span></div>
            <div className="ops-overview-list">
              <BarRow label="严重" value={riskSummary.critical} percent={riskSummary.critical * 12} tone="red" />
              <BarRow label="警告" value={stats?.alerts.warning ?? 0} percent={(stats?.alerts.warning ?? 0) * 8} tone="orange" />
              <BarRow label="告警总数" value={stats?.alerts.total ?? 0} percent={(stats?.alerts.total ?? 0) * 5} tone="blue" />
            </div>
          </OverviewCard>
        </div>
        <div className="ops-overview-span-3">
          <OverviewCard title="异常工作负载" scope={scopeLabel} action={<DeploymentUnitOutlined />}>
            <div className="ops-overview-big-number is-warning">{riskSummary.unhealthy}<span>↑</span></div>
            <div className="ops-overview-list">
              <BarRow label="异常负载" value={riskSummary.unhealthy} percent={riskSummary.unhealthy * 10} tone="orange" />
              <BarRow label="健康负载" value={stats?.workloads.healthy ?? 0} percent={(stats?.workloads.healthy ?? 0) * 2} tone="green" />
              <BarRow label="全部负载" value={stats?.workloads.total ?? 0} percent={(stats?.workloads.total ?? 0) * 2} tone="blue" />
            </div>
          </OverviewCard>
        </div>
        <div className="ops-overview-span-3">
          <OverviewCard title="风险集群" scope="风险分排序" action={<ClusterOutlined />}>
            <div className="ops-overview-list ops-overview-list--bars">
              <BarRow label="风险集群" value={riskSummary.clusterWarning} percent={riskSummary.clusterWarning * 20} tone="red" />
              <BarRow label="健康集群" value={stats?.clusters.healthy ?? 0} percent={(stats?.clusters.healthy ?? 0) * 10} tone="green" />
              <BarRow label="全部集群" value={stats?.clusters.total ?? 0} percent={(stats?.clusters.total ?? 0) * 8} tone="blue" />
            </div>
          </OverviewCard>
        </div>
      </section>

      <section className="ops-overview-grid" aria-label="运行态势">
        <div className="ops-overview-span-4">
          <OverviewCard title="CPU Usage" scope={resourceUsageSummary.dataSource} action={<LineChartOutlined />}>
            <div className="ops-overview-chart-card">
              <div className="ops-overview-chart-value">
                <strong>{liveSnapshot?.available ? formatLiveCpu(liveSnapshot.cpuUsage) : formatPercent(resourceUsageSummary.cpuUsagePercent)}</strong>
                <span>{getUsageSubtitle({ dataSource: resourceUsageSummary.dataSource, degraded: resourceUsageSummary.degraded, note: resourceUsageSummary.note })}</span>
              </div>
              <MiniTrendChart
                tone="blue"
                value={resourceUsageSummary.cpuUsagePercent}
                height={136}
                valueLabel="CPU"
                formatPointValue={(point) => {
                  if (liveSnapshot?.available && typeof liveSnapshot.cpuUsage === "number") {
                    return formatLiveCpu(liveSnapshot.cpuUsage * (point / Math.max(resourceUsageSummary.cpuUsagePercent ?? point, 1)));
                  }
                  return `${Math.round(point * 10)}m`;
                }}
              />
            </div>
          </OverviewCard>
        </div>
        <div className="ops-overview-span-4">
          <OverviewCard title="Memory Usage" scope={resourceUsageSummary.dataSource} action={<LineChartOutlined />}>
            <div className="ops-overview-chart-card">
              <div className="ops-overview-chart-value">
                <strong>{liveSnapshot?.available ? formatLiveMemory(liveSnapshot.memoryUsage) : formatPercent(resourceUsageSummary.memoryUsagePercent)}</strong>
                <span>{getUsageSubtitle({ dataSource: resourceUsageSummary.dataSource, degraded: resourceUsageSummary.degraded, note: resourceUsageSummary.note })}</span>
              </div>
              <MiniTrendChart
                tone="green"
                value={resourceUsageSummary.memoryUsagePercent}
                height={136}
                valueLabel="内存"
                formatPointValue={(point) => {
                  if (liveSnapshot?.available && typeof liveSnapshot.memoryUsage === "number") {
                    return formatLiveMemory(liveSnapshot.memoryUsage * (point / Math.max(resourceUsageSummary.memoryUsagePercent ?? point, 1)));
                  }
                  return `${(point / 10).toFixed(2)} Gi`;
                }}
              />
            </div>
          </OverviewCard>
        </div>
        <div className="ops-overview-span-4">
          <OverviewCard title="Service Impact（服务影响拓扑）" scope="6 小时" action={<NodeIndexOutlined />}>
            <div className="ops-overview-impact-layout">
              <ImpactMap impact={stats?.serviceImpact} />
              <div className="ops-overview-impact-services-list">
                {serviceImpactRows.length > 0 ? (
                  serviceImpactRows.map((item) => (
                    <BarRow
                      key={item.id}
                      label={item.label}
                      value={item.value}
                      percent={item.percent}
                      tone={item.tone}
                    />
                  ))
                ) : (
                  <div className="ops-overview-empty">{stats?.serviceImpact?.note ?? "暂无服务影响数据"}</div>
                )}
              </div>
            </div>
          </OverviewCard>
        </div>
      </section>

      <section className="ops-overview-grid" aria-label="运维流">
        <div className="ops-overview-span-5">
          <OverviewCard title="最近告警事件" action={<BellOutlined />}>
            {timelineItems.length > 0 ? (
              <div className="ops-overview-event-table">
                {timelineItems.map((item) => (
                  <div key={item.id} className="ops-overview-event-row">
                    <span className={`ops-overview-event-dot ops-overview-event-dot--${item.level}`} />
                    <strong>{item.title}</strong>
                    <span>{item.source}</span>
                    <time>{item.time}</time>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ops-overview-empty">暂无告警事件</div>
            )}
            <Link className="ops-overview-card-link" href={formatScopedHref("/observability", clusterId)} prefetch={false}>查看全部告警 <ArrowRightOutlined /></Link>
          </OverviewCard>
        </div>
        <div className="ops-overview-span-4">
          <OverviewCard title="最近运维操作" action={<CloudServerOutlined />}>
            {recentOperationItems.length > 0 ? (
              <div className="ops-overview-operation-list">
                {recentOperationItems.map((item) => (
                  <div key={item.id} className="ops-overview-operation-row">
                    {item.result === "failure" ? <AlertOutlined /> : <CheckCircleOutlined />}
                    <div>
                      <strong>{item.action}</strong>
                      <span>{item.detail}</span>
                    </div>
                    <OpsStatusTag tone={item.status.tone}>{item.status.label}</OpsStatusTag>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ops-overview-empty">暂无运维操作</div>
            )}
          </OverviewCard>
        </div>
        <div className="ops-overview-span-3">
          <OverviewCard title="高频运维入口" action={<AppstoreOutlined />}>
            <div className="ops-overview-shortcuts">
              {actions.map((item) => (
                <Link key={item.href} href={item.href} prefetch={false} className="ops-overview-shortcut">
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              ))}
              <Link href={formatScopedHref("/logs", clusterId)} prefetch={false} className="ops-overview-shortcut">
                <HddOutlined />
                <span>日志查询</span>
              </Link>
              <Link href={formatScopedHref("/terminal", clusterId)} prefetch={false} className="ops-overview-shortcut">
                <ThunderboltOutlined />
                <span>执行命令</span>
              </Link>
              <Link href={formatScopedHref("/namespaces", clusterId)} prefetch={false} className="ops-overview-shortcut">
                <DatabaseOutlined />
                <span>命名空间</span>
              </Link>
              <Link href={formatScopedHref("/aiops", clusterId)} prefetch={false} className="ops-overview-shortcut">
                <RadarChartOutlined />
                <span>智能巡检</span>
              </Link>
            </div>
          </OverviewCard>
        </div>
      </section>

      {isLoading ? (
        <div className="ops-overview-card">
          <div className="ops-overview-card__body">
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
