import { apiRequest } from "./client";
import type { QueryParams } from "./types";

export type DashboardMetricSource =
  | "metrics-server"
  | "cluster-metrics-cache"
  | "k8s-node-allocatable-requested"
  | "none";

export type DashboardMetricFreshness = "fresh" | "cached" | "stale" | "unavailable";

export interface DashboardResourceMetric {
  value: number | null;
  used: number | null;
  capacity: number | null;
  unit: "cores" | "bytes";
  source: DashboardMetricSource;
  capturedAt: string | null;
  freshness: DashboardMetricFreshness;
  degraded: boolean;
  note?: string;
}

export interface DashboardMetricPresentation {
  valueLabel: string;
  capacityLabel: string;
  percent: number | null;
  sourceLabel: string;
  freshnessLabel: string;
}

function formatCpu(value: number): string {
  if (value < 1) return `${Math.round(value * 1000)} mCPU`;
  return `${value.toFixed(2)} cores`;
}

function formatBytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let display = value;
  let unitIndex = 0;
  while (display >= 1024 && unitIndex < units.length - 1) {
    display /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : display >= 10 ? 1 : 2;
  return `${display.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatDashboardMetric(
  metric: DashboardResourceMetric,
): DashboardMetricPresentation {
  const formatValue = metric.unit === "cores" ? formatCpu : formatBytes;
  const sourceLabels: Record<DashboardMetricSource, string> = {
    "metrics-server": "metrics-server 实时采样",
    "cluster-metrics-cache": "metrics-server 缓存采样",
    "k8s-node-allocatable-requested": "K8s 请求量 / 可分配量快照",
    none: "无可用数据",
  };
  const freshnessLabels: Record<DashboardMetricFreshness, string> = {
    fresh: "实时",
    cached: "已同步",
    stale: "已陈旧",
    unavailable: "不可用",
  };
  const capacityPrefix =
    metric.source === "k8s-node-allocatable-requested" ? "可分配" : "容量";

  return {
    valueLabel: metric.used === null ? "--" : formatValue(metric.used),
    capacityLabel:
      metric.capacity === null
        ? `${capacityPrefix} --`
        : `${capacityPrefix} ${formatValue(metric.capacity)}`,
    percent:
      typeof metric.value === "number" && Number.isFinite(metric.value)
        ? Math.max(0, Math.min(100, metric.value))
        : null,
    sourceLabel: sourceLabels[metric.source],
    freshnessLabel: freshnessLabels[metric.freshness],
  };
}

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
  healthScore?: number;
  resourceUsage?: {
    cpu: DashboardResourceMetric;
    memory: DashboardResourceMetric;
    cpuUsagePercent?: number;
    memoryUsagePercent?: number;
    dataSource: "metrics-server" | "k8s-metadata" | "none";
    degraded: boolean;
    note?: string;
    liveSnapshot?: {
      capturedAt: string;
      source: "metrics-server" | "cluster-metrics-cache" | "none";
      available: boolean;
      freshnessWindowMs: number;
      cpuUsage: number | null;
      memoryUsage: number | null;
      pods: Array<{
        podName: string;
        namespace: string;
        clusterId: string;
        capturedAt: string;
        cpuUsage: number | null;
        memoryUsage: number | null;
        source: "metrics-server" | "cluster-metrics-cache" | "none";
        available: boolean;
        freshnessWindowMs: number;
        history: Array<{
          timestamp: string;
          cpuUsage: number | null;
          memoryUsage: number | null;
        }>;
        note?: string;
      }>;
      history: Array<{
        timestamp: string;
        cpuUsage: number | null;
        memoryUsage: number | null;
      }>;
      note?: string;
    };
  };
  topology?: {
    services: number;
    ingresses: number;
    deployments: number;
    statefulsets: number;
    daemonsets: number;
    pods: number;
    edges: number;
  };
  serviceImpact?: {
    nodes: Array<{
      id: string;
      label: string;
      kind: "internet" | "ingress" | "service" | "workload" | "database";
      status: "healthy" | "warning" | "critical" | "unknown";
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      status: "healthy" | "warning" | "critical" | "unknown";
    }>;
    impactedServices: Array<{
      name: string;
      namespace?: string;
      clusterId?: string;
      severity: "critical" | "warning" | "info" | "healthy";
      impactScore: number;
      alertCount: number;
      workloadCount: number;
    }>;
    generatedAt: string;
    degraded: boolean;
    note?: string;
  };
  recentOperations?: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    actor: string;
    result: "success" | "failure";
    timestamp: string;
    reason?: string;
  }>;
  recentEvents?: Array<{
    id: string;
    level: "critical" | "warning" | "info";
    event: string;
    source: string;
    timestamp: string;
  }>;
  scope?: {
    mode: "all" | "cluster";
    clusterId?: string;
    clusterName?: string;
    generatedAt: string;
    degraded?: boolean;
    degradedReason?: string;
  };
}

export interface DashboardStatsParams {
  clusterId?: string;
}

function isDashboardStatsParams(value: unknown): value is DashboardStatsParams {
  return typeof value === "object" && value !== null;
}

export async function getDashboardStats(token?: string): Promise<DashboardStats>;
export async function getDashboardStats(params?: DashboardStatsParams, token?: string): Promise<DashboardStats>;
export async function getDashboardStats(
  paramsOrToken?: DashboardStatsParams | string,
  token?: string,
): Promise<DashboardStats> {
  const params = isDashboardStatsParams(paramsOrToken) ? paramsOrToken : {};
  const resolvedToken = typeof paramsOrToken === "string" ? paramsOrToken : token;
  const query: QueryParams = {
    clusterId: params.clusterId || undefined,
  };

  return apiRequest<DashboardStats>("/api/dashboard/stats", { token: resolvedToken, query });
}
