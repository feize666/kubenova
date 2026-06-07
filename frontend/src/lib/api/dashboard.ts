import { apiRequest } from "./client";
import type { QueryParams } from "./types";

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
    cpuUsagePercent: number;
    memoryUsagePercent: number;
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
