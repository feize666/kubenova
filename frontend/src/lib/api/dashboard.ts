import { apiRequest } from "./client";

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
  recentEvents?: Array<{
    id: string;
    level: "critical" | "warning" | "info";
    event: string;
    source: string;
    timestamp: string;
  }>;
}

export async function getDashboardStats(token?: string): Promise<DashboardStats> {
  return apiRequest<DashboardStats>("/api/dashboard/stats", { token });
}
