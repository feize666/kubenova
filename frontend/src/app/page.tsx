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
  LineChartOutlined,
  NodeIndexOutlined,
  RadarChartOutlined,
  PlusOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Skeleton, Space } from "antd";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { useAuth } from "@/components/auth-context";
import {
  OpsFilterChip,
  OpsScopeSelector,
  OpsStatusTag,
  type OpsScopeSelectorOption,
} from "@/components/ops";
import { MetricUnitFormatter } from "@/components/visual-system";
import { getClusters } from "@/lib/api/clusters";
import { getClusterHealthList, type ClusterHealthListItem } from "@/lib/api/cluster-health";
import {
  formatDashboardCount,
  getDashboardStats,
  isDashboardMetricAvailable,
  type DashboardStats,
} from "@/lib/api/dashboard";
import { OverviewCommandCenter } from "@/components/overview/overview-command-center";
import { OverviewRiskPanel } from "@/components/overview/overview-risk-panel";
import { OverviewMetricStrip } from "@/components/overview/overview-metric-strip";
import { OverviewTrendPanel } from "@/components/overview/overview-trend-panel";

type DashboardStatsQueryResult = {
  stats: DashboardStats;
  scopedFallback: boolean;
};
type DashboardMetricMeta = NonNullable<
  DashboardStats["metrics"]
>[keyof NonNullable<DashboardStats["metrics"]>];
type DashboardHistory = NonNullable<
  NonNullable<DashboardStats["resourceUsage"]>["liveSnapshot"]
>["history"];

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
  return clusterId
    ? `${path}?clusterId=${encodeURIComponent(clusterId)}`
    : path;
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${Math.round(value)}%`;
}

function formatCount(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "--";
}

function formatMetricCount(value: number | undefined, metric?: DashboardMetricMeta) {
  return formatDashboardCount(value, metric);
}

function metricCountShare(
  value: number | undefined,
  total: number | undefined,
  metric?: DashboardMetricMeta,
) {
  return isDashboardMetricAvailable(metric) ? countShare(value, total) : 0;
}

function countShare(value: number | undefined, total: number | undefined) {
  return typeof value === "number" && typeof total === "number" && total > 0
    ? clampPercent((value / total) * 100)
    : 0;
}

function formatMetricProvenance(metric?: DashboardMetricMeta) {
  if (!metric) return "数据来源不可用";
  const freshness = {
    fresh: "刚刚采集",
    cached: "已缓存",
    stale: "已陈旧",
    unavailable: "不可用",
  }[metric.freshness];
  return `${freshness} · ${metric.source}`;
}

function buildUsageTrendPoints(
  history: DashboardHistory | undefined,
  kind: "cpu" | "memory",
  capacity: number | null | undefined,
) {
  if (!history || !Number.isFinite(capacity) || !capacity || capacity <= 0)
    return [];
  return history.map((point) => {
    const raw = kind === "cpu" ? point.cpuUsage : point.memoryUsage;
    const value =
      typeof raw === "number" && Number.isFinite(raw)
        ? clampPercent((raw / capacity) * 100)
        : null;
    return {
      timestamp: point.timestamp,
      value,
      label:
        kind === "cpu" && typeof raw === "number"
          ? formatLiveCpu(raw)
          : kind === "memory" && typeof raw === "number"
            ? formatLiveMemory(raw)
            : "--",
    };
  });
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function ClusterOverviewCard({ cluster, health }: { cluster: NonNullable<Awaited<ReturnType<typeof getClusters>>>["items"][number]; health?: ClusterHealthListItem }) {
  const cpu = Number.isFinite(cluster.cpuUsage) ? cluster.cpuUsage : null;
  const memory = Number.isFinite(cluster.memoryUsage) ? cluster.memoryUsage : null;
  const status = health?.runtimeStatus === "running" ? "运行中" : health?.runtimeStatus === "checking" ? "探测中" : health?.runtimeStatus === "disabled" || cluster.state === "disabled" ? "已停用" : health?.runtimeStatus === "offline-mode" ? "未接入" : "离线";
  return (
    <Link href={`/clusters/${encodeURIComponent(cluster.id)}/overview`} prefetch={false} className="ops-overview-cluster-card">
      <div className="ops-overview-cluster-card__head">
        <div>
          <span className="ops-overview-cluster-card__eyebrow">{cluster.provider || "Kubernetes"} · {cluster.environment || "未标注环境"}</span>
          <strong>{cluster.name}</strong>
        </div>
        <OpsStatusTag tone={status === "运行中" ? "success" : status === "离线" ? "danger" : "warning"}>{status}</OpsStatusTag>
      </div>
      <div className="ops-overview-cluster-card__metrics">
        <div><span>节点</span><b>{cluster.nodeCount ?? "--"}</b></div>
        <div><span>版本</span><b>{cluster.kubernetesVersion || "--"}</b></div>
        <div><span>接入状态</span><b>{cluster.hasKubeconfig === false ? "未接入" : "已接入"}</b></div>
      </div>
      <div className="ops-overview-cluster-card__usage">
        <div><span>CPU</span><b>{cpu === null ? "--" : `${Math.round(cpu)}%`}</b><i><em style={{ width: `${clampPercent(cpu ?? 0)}%` }} /></i></div>
        <div><span>内存</span><b>{memory === null ? "--" : `${Math.round(memory)}%`}</b><i><em style={{ width: `${clampPercent(memory ?? 0)}%` }} /></i></div>
      </div>
      <span className="ops-overview-cluster-card__link">进入集群信息 <ArrowRightOutlined /></span>
    </Link>
  );
}

type TrendPoint = {
  timestamp: string;
  value: number | null;
  label: string;
};

function MiniTrendChart({
  tone,
  points,
  height = 92,
  valueLabel = "使用率",
}: {
  tone: "blue" | "green";
  points: TrendPoint[];
  height?: number;
  valueLabel?: string;
}) {
  const validPoints = points.filter(
    (point): point is TrendPoint & { value: number } =>
      typeof point.value === "number" && Number.isFinite(point.value),
  );

  if (validPoints.length === 0) {
    return (
      <div
        className={`ops-overview-trend ops-overview-trend--${tone} ops-overview-trend--empty`}
        role="status"
      >
        暂无可用趋势数据
      </div>
    );
  }

  const width = 280;
  const step =
    validPoints.length > 1 ? width / (validPoints.length - 1) : width;
  const chartPoints = validPoints.map((point, index) => {
    const normalized = clampPercent(point.value);
    return {
      ...point,
      x: validPoints.length > 1 ? index * step : width / 2,
      y: height - (normalized / 100) * (height - 18) - 8,
      time: new Date(point.timestamp).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  });
  const path = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = `0,${height - 8} ${path} ${width},${height - 8}`;

  return (
    <svg
      className={`ops-overview-trend ops-overview-trend--${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${valueLabel}趋势图`}
    >
      <line
        x1="0"
        y1="20"
        x2={width}
        y2="20"
        className="ops-overview-trend__limit"
      />
      <line
        x1="0"
        y1={height - 8}
        x2={width}
        y2={height - 8}
        className="ops-overview-trend__grid"
      />
      <line
        x1="0"
        y1={height / 2}
        x2={width}
        y2={height / 2}
        className="ops-overview-trend__grid"
      />
      {chartPoints.length > 1 ? (
        <polygon points={areaPath} className="ops-overview-trend__area" />
      ) : null}
      {chartPoints.length > 1 ? (
        <polyline points={path} className="ops-overview-trend__line" />
      ) : null}
      {chartPoints.map((point, index) => {
        const tooltipX = Math.min(Math.max(point.x - 38, 4), width - 78);
        const tooltipY = Math.max(point.y - 42, 4);
        return (
          <g
            key={`${point.timestamp}-${index}`}
            className="ops-overview-trend__point"
            tabIndex={0}
            aria-label={`${point.time} ${valueLabel} ${point.label}`}
          >
            <line
              x1={point.x}
              y1="20"
              x2={point.x}
              y2={height - 8}
              className="ops-overview-trend__hover-line"
            />
            <circle
              cx={point.x}
              cy={point.y}
              r="4"
              className="ops-overview-trend__dot"
            />
            <rect
              x={tooltipX}
              y={tooltipY}
              width="76"
              height="34"
              rx="6"
              className="ops-overview-trend__tooltip-box"
            />
            <text
              x={tooltipX + 8}
              y={tooltipY + 14}
              className="ops-overview-trend__tooltip-time"
            >
              {point.time}
            </text>
            <text
              x={tooltipX + 8}
              y={tooltipY + 27}
              className="ops-overview-trend__tooltip-value"
            >
              {valueLabel} {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HealthGauge({ score }: { score?: number }) {
  const percent =
    typeof score === "number" && Number.isFinite(score)
      ? clampPercent(score)
      : null;
  return (
    <div
      className="ops-overview-gauge"
      aria-label={`健康评分 ${percent === null ? "不可用" : percent}`}
    >
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="46" className="ops-overview-gauge__track" />
        {percent !== null ? (
          <circle
            cx="60"
            cy="60"
            r="46"
            className="ops-overview-gauge__value"
            pathLength="100"
            strokeDasharray={`${percent} 100`}
          />
        ) : null}
      </svg>
      <div className="ops-overview-gauge__text">
        <strong>{percent === null ? "--" : percent}</strong>
        {percent !== null ? <span>/100</span> : null}
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
  state = "ready",
}: {
  title: string;
  scope?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  state?: "ready" | "loading" | "empty" | "degraded";
}) {
  return (
    <OverviewRiskPanel
      title={title}
      scope={scope}
      action={action}
      className={className}
      state={state}
    >
      {children}
    </OverviewRiskPanel>
  );
}

function SummaryMetric({
  label,
  value,
  meta,
}: {
  label: string;
  value: string | number;
  meta?: DashboardMetricMeta;
}) {
  return (
    <div className="ops-overview-summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {meta ? <small>{formatMetricProvenance(meta)}</small> : null}
    </div>
  );
}

function MetricProvenance({ meta }: { meta?: DashboardMetricMeta }) {
  if (!meta) return null;
  return (
    <small className="ops-overview-metric-provenance">
      {formatMetricProvenance(meta)}
      {meta.degradedReason ? ` · ${meta.degradedReason}` : ""}
    </small>
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
        <i
          className={`ops-overview-bar-row__value ops-overview-bar-row__value--${tone}`}
          style={{ width: `${clampPercent(percent)}%` }}
        />
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

function getImpactTone(
  severity: ImpactSeverity | undefined,
): "red" | "orange" | "green" | "blue" {
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
  const resource = [operation.resourceType, operation.resourceId]
    .filter(Boolean)
    .join("/");
  return [resource, operation.actor, formatAge(operation.timestamp)]
    .filter(Boolean)
    .join(" · ");
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
    nodes.find((node) => node.id === id) ??
    nodes[fallbackIndex] ??
    fallbackNodes[fallbackIndex];
  const internet = getNode("internet", 0);
  const ingress = getNode("ingress", 1);
  const service0 = getNode("service-0", 2);
  const service1 = getNode("service-1", 3);
  const service2 = getNode("service-2", 4);
  const backend = getNode("backend", 5);

  return (
    <div className="ops-overview-impact-map" aria-label="服务影响拓扑">
      <svg
        className="ops-overview-impact-links"
        viewBox="0 0 420 172"
        aria-hidden
      >
        <path d="M86 86 H124" />
        <path d="M204 86 C228 48 250 42 282 42" />
        <path d="M204 86 H282" />
        <path d="M204 86 C228 124 250 132 282 132" />
        <path className="is-danger" d="M332 86 H362" />
      </svg>
      <div
        className={`ops-overview-impact-node ops-overview-impact-node--edge ${getImpactNodeToneClass(internet.status)} is-internet`}
        data-node-status={internet.status ?? "unknown"}
      >
        {internet.label}
      </div>
      <div
        className={`ops-overview-impact-node ${getImpactNodeToneClass(ingress.status)} is-gateway`}
        data-node-status={ingress.status ?? "unknown"}
      >
        {ingress.label}
      </div>
      <div
        className={`ops-overview-impact-node ${getImpactNodeToneClass(service0.status)} is-user`}
        data-node-status={service0.status ?? "unknown"}
      >
        {service0.label}
      </div>
      <div
        className={`ops-overview-impact-node ${getImpactNodeToneClass(service1.status)} is-order`}
        data-node-status={service1.status ?? "unknown"}
      >
        {service1.label}
      </div>
      <div
        className={`ops-overview-impact-node ${getImpactNodeToneClass(service2.status)} is-payment`}
        data-node-status={service2.status ?? "unknown"}
      >
        {service2.label}
      </div>
      <div
        className={`ops-overview-impact-node ${getImpactNodeToneClass(backend.status)} is-db`}
        data-node-status={backend.status ?? "unknown"}
      >
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
    queryFn: () =>
      getClusters(
        { state: "active", selectableOnly: false, pageSize: 500 },
        accessToken!,
      ),
    enabled: !isInitializing && Boolean(accessToken),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: 30_000,
  });
  const healthQuery = useQuery({
    queryKey: ["cluster-health", "overview", accessToken],
    queryFn: () => getClusterHealthList({ lifecycleState: "active", page: 1, pageSize: 500 }, accessToken || undefined),
    enabled: !isInitializing && Boolean(accessToken),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const clusterHealth = useMemo(() => Object.fromEntries((healthQuery.data?.items ?? []).map((item) => [item.clusterId, item])), [healthQuery.data?.items]);
  const latestProbeAt = useMemo(() => {
    const values = (healthQuery.data?.items ?? []).map((item) => item.checkedAt).filter((value): value is string => Boolean(value));
    return values.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  }, [healthQuery.data?.items]);
  const scopeOptions = useMemo<OpsScopeSelectorOption[]>(
    () =>
      (clustersQuery.data?.items ?? []).map((item) => ({
        value: item.id,
        label: item.name,
        description:
          [item.environment, item.provider].filter(Boolean).join(" · ") ||
          "已接入",
      })),
    [clustersQuery.data?.items],
  );

  const selectedCluster = useMemo(
    () =>
      (clustersQuery.data?.items ?? []).find((item) => item.id === clusterId),
    [clusterId, clustersQuery.data?.items],
  );
  const clusterNodes = useMemo(() => {
    const items = clusterId ? [selectedCluster].filter(Boolean) : clustersQuery.data?.items ?? [];
    if (!items.length || items.some((item) => typeof item?.nodeCount !== "number")) return null;
    return items.reduce((total, item) => total + (item?.nodeCount ?? 0), 0);
  }, [clusterId, clustersQuery.data?.items, selectedCluster]);
  const clusterCards = clusterId ? (selectedCluster ? [selectedCluster] : []) : clustersQuery.data?.items ?? [];

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
        const stats = await getDashboardStats(
          clusterId ? { clusterId } : {},
          accessToken || undefined,
        );
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
    refetchInterval: 60_000,
  });
  const refreshOverview = useCallback(() => {
    void Promise.all([statsQuery.refetch(), clustersQuery.refetch(), healthQuery.refetch()]);
  }, [clustersQuery, healthQuery, statsQuery]);

  const stats = statsQuery.data?.stats;
  const alerts = isDashboardMetricAvailable(stats?.metrics?.alerts)
    ? stats?.alerts
    : undefined;
  const healthScore = isDashboardMetricAvailable(stats?.metrics?.healthScore)
    ? stats?.healthScore
    : undefined;
  const isLoading = statsQuery.isLoading;
  const scopedFallback = Boolean(statsQuery.data?.scopedFallback);
  const scopedDegraded = Boolean(stats?.scope?.degraded);
  const scopeLabel =
    selectedCluster?.name ??
    (clusterId ? `Cluster ${clusterId.slice(0, 8)}` : "全部集群");

  const riskSummary = useMemo(() => {
    const critical = alerts?.critical ?? 0;
    const unhealthy = isDashboardMetricAvailable(stats?.metrics?.workloads)
      ? stats?.workloads.unhealthy ?? 0
      : 0;
    const clusterWarning = isDashboardMetricAvailable(stats?.metrics?.clusters)
      ? stats?.clusters.warning ?? 0
      : 0;
    const unavailable = !stats || [stats.metrics?.clusters, stats.metrics?.workloads, stats.metrics?.alerts, stats.metrics?.healthScore].some(
      (metric) => metric?.freshness === "unavailable" || metric?.freshness === "stale",
    );
    const riskLevel =
      critical > 0
        ? "critical"
        : unhealthy > 0 || clusterWarning > 0
          ? "warning"
          : unavailable
            ? "unknown"
            : stats.scope?.degraded
              ? "warning"
              : "success";
    return {
      critical,
      unhealthy,
      clusterWarning,
      healthScore,
      riskLevel,
    } as const;
  }, [alerts, healthScore, stats]);

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
  const showResourceUsageWarning =
    Boolean(stats?.resourceUsage?.degraded) && !isLoading;
  const cpuTrendPoints = useMemo(
    () =>
      buildUsageTrendPoints(
        liveSnapshot?.history,
        "cpu",
        stats?.resourceUsage?.cpu.capacity,
      ),
    [liveSnapshot?.history, stats?.resourceUsage?.cpu.capacity],
  );
  const memoryTrendPoints = useMemo(
    () =>
      buildUsageTrendPoints(
        liveSnapshot?.history,
        "memory",
        stats?.resourceUsage?.memory.capacity,
      ),
    [liveSnapshot?.history, stats?.resourceUsage?.memory.capacity],
  );

  const topology = stats?.topology;
  const serviceImpactRows = useMemo(
    () =>
      (stats?.serviceImpact?.impactedServices ?? [])
        .slice(0, 5)
        .map((item) => ({
          id:
            [item.clusterId, item.namespace, item.name]
              .filter(Boolean)
              .join(":") || item.name,
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
        detail: item.reason
          ? `${formatOperationDetail(item)} · ${item.reason}`
          : formatOperationDetail(item),
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
  ];

  return (
    <div
      className={[
        "ops-overview-shell",
        "dashboard-workbench",
        statsQuery.isFetching ? "ops-scoped-loading" : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="resource-workbench dashboard-workbench__header-zone">
        <OverviewCommandCenter
          scopeLabel={scopeLabel}
          clusterId={clusterId}
          riskLevel={riskSummary.riskLevel}
          generatedAt={stats?.scope?.generatedAt}
          isFetching={statsQuery.isFetching}
          onRefresh={refreshOverview}
        />
      </div>

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
          description={
            stats?.scope?.degradedReason ?? "当前选择的集群不存在或已删除。"
          }
        />
      ) : null}

      {statsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="仪表盘数据加载失败"
          description={
            statsQuery.error instanceof Error
              ? statsQuery.error.message
              : "请稍后重试。"
          }
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
              <span>
                {stats.resourceUsage.note ??
                  "请先执行集群同步以获取真实 CPU/内存数据。"}
              </span>
              <OpsFilterChip tone="neutral">
                来源: {stats.resourceUsage.dataSource}
              </OpsFilterChip>
            </Space>
          }
        />
      ) : null}

      <section className="ops-overview-context-bar" aria-label="集群范围">
        <div className="ops-overview-context-bar__selector">
          <span>数据范围</span>
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
        <div className="ops-overview-context-bar__meta">
          <OpsStatusTag tone={riskSummary.riskLevel}>{riskSummary.riskLevel === "critical" ? "高风险" : riskSummary.riskLevel === "warning" ? "需关注" : riskSummary.riskLevel === "unknown" ? "数据不足" : "运行稳定"}</OpsStatusTag>
          <span>{latestProbeAt ? `最近探测 ${formatAge(latestProbeAt)}` : "等待首次数据采集"}</span>
          <span>{clusterId ? "单集群视图" : "多集群全局视图"}</span>
          <button type="button" onClick={refreshOverview} disabled={statsQuery.isFetching || clustersQuery.isFetching || healthQuery.isFetching}>刷新数据</button>
        </div>
      </section>

      <section className="ops-overview-cluster-board" aria-label="集群资源总览">
        <div className="ops-overview-cluster-board__main">
          <div className="ops-overview-section-heading">
            <div><span>资源工作区</span><h2>集群资源概览</h2></div>
            <Link href="/clusters" prefetch={false}>管理全部集群 <ArrowRightOutlined /></Link>
          </div>
          {clustersQuery.isLoading ? <div className="ops-overview-cluster-grid"><Skeleton active paragraph={{ rows: 4 }} /></div> : clusterCards.length ? (
            <div className="ops-overview-cluster-grid">
              {clusterCards.map((cluster) => <ClusterOverviewCard key={cluster.id} cluster={cluster} health={clusterHealth[cluster.id]} />)}
            </div>
          ) : <div className="ops-overview-empty ops-overview-empty--panel">暂无已接入集群，<Link href="/clusters">立即接入第一个集群</Link></div>}
        </div>
        <aside className="ops-overview-quick-rail">
          <div className="ops-overview-section-heading"><div><span>快速入口</span><h2>常用操作</h2></div></div>
          <div className="ops-overview-quick-links">
            <Link href="/clusters" prefetch={false}><PlusOutlined /><span>创建集群<small>接入新的 Kubernetes 集群</small></span><ArrowRightOutlined /></Link>
            <Link href={formatScopedHref("/network/topology", clusterId)} prefetch={false}><NodeIndexOutlined /><span>资源拓扑<small>查看服务访问链路</small></span><ArrowRightOutlined /></Link>
            <Link href={formatScopedHref("/monitoring", clusterId)} prefetch={false}><LineChartOutlined /><span>监控中心<small>查看指标与告警</small></span><ArrowRightOutlined /></Link>
            <Link href={formatScopedHref("/logs", clusterId)} prefetch={false}><FileTextOutlined /><span>日志中心<small>检索集群运行日志</small></span><ArrowRightOutlined /></Link>
          </div>
          <div className="ops-overview-quick-rail__status"><span>数据状态</span><strong>{stats?.scope?.generatedAt ? "已同步" : "等待采集"}</strong><small>{stats?.scope?.generatedAt ? `最近采集 ${formatAge(stats.scope.generatedAt)}` : "首次采集完成后显示实时状态"}</small></div>
          <div className="ops-overview-quick-rail__events">
            <div className="ops-overview-section-heading"><div><span>近况</span><h2>最近异常事件</h2></div></div>
            {timelineItems.length ? timelineItems.slice(0, 5).map((item) => <Link href={formatScopedHref("/observability", clusterId)} prefetch={false} key={item.id} data-level={item.level}><i /><span><strong>{item.title}</strong><small>{item.source} · {item.time}</small></span><ArrowRightOutlined /></Link>) : <div className="ops-overview-empty">当前无异常事件</div>}
            {timelineItems.length ? <Link className="ops-overview-quick-rail__all" href={formatScopedHref("/observability", clusterId)} prefetch={false}>查看全部事件 <ArrowRightOutlined /></Link> : null}
          </div>
        </aside>
      </section>

      <section className="ops-overview-metric-grid" aria-label="平台核心指标">
        <article><span>集群总数</span><strong>{clusterCards.length}</strong><small>{healthQuery.data?.items.filter((item) => item.runtimeStatus === "running" && (!clusterId || item.clusterId === clusterId)).length ?? "--"} 个运行中 · {healthQuery.data?.items.filter((item) => item.runtimeStatus !== "running" && (!clusterId || item.clusterId === clusterId)).length ?? "--"} 个需关注</small></article>
        <article><span>节点总数</span><strong>{clusterNodes === null ? "--" : clusterNodes}</strong><small>来自集群最近一次同步</small></article>
        <article><span>工作负载</span><strong>{formatMetricCount(stats?.workloads.total, stats?.metrics?.workloads)}</strong><small>{formatMetricCount(stats?.workloads.healthy, stats?.metrics?.workloads)} 个健康</small></article>
        <article data-tone={Number(stats?.workloads.unhealthy ?? 0) > 0 ? "warning" : "success"}><span>异常资源</span><strong>{formatMetricCount(stats?.workloads.unhealthy, stats?.metrics?.workloads)}</strong><small>异常工作负载</small></article>
      </section>

    </div>
  );
}
