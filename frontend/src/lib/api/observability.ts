import { apiRequest } from "./client";
import type { MonitoringTimePreset } from "./monitoring";

export type ObservabilitySourceKey = "metrics" | "logs" | "traces" | "events" | "alerts" | "slo";
export type ObservabilityEntityScope = "cluster" | "namespace" | "workload" | "service" | "pod" | "node" | "network";

export interface ObservabilitySourceStatus {
  key: ObservabilitySourceKey;
  label: string;
  available: boolean;
  degraded: boolean;
  note: string;
  deepLink?: string;
}

export interface ObservabilityEntityHealth {
  scope: ObservabilityEntityScope;
  label: string;
  status: "healthy" | "warning" | "critical" | "unavailable";
  total: number;
  warning: number;
  critical: number;
  note?: string;
  detailPath?: string;
  signals: Record<"metrics" | "logs" | "traces" | "events" | "alerts", "available" | "degraded" | "unavailable">;
  slo: {
    targetPercent: number;
    burnRate: number;
    errorBudgetRemainingPercent: number;
    status: "healthy" | "at-risk" | "exhausted" | "unavailable";
  };
  alertOwner: string;
  runbookUrl: string | null;
  notificationStatus: "not-configured" | "ready" | "degraded";
  deepLinks: Array<{
    key: string;
    label: string;
    url: string | null;
    available: boolean;
  }>;
}

export interface ObservabilitySignalPanel {
  key: ObservabilitySourceKey;
  title: string;
  status: "available" | "degraded" | "unavailable";
  summary: string;
  updatedAt: string;
  detailPath?: string;
}

export interface ObservabilityEvent {
  id: string;
  level: "INFO" | "WARN" | "CRITICAL";
  source: string;
  message: string;
  timestamp: string;
}

export interface ObservabilitySummary {
  range: MonitoringTimePreset;
  timestamp: string;
  timeRange: {
    from: string;
    to: string;
  };
  healthScore: number;
  activeAlerts: {
    critical: number;
    warning: number;
    total: number;
    source: "monitoring-alert" | "workload-derived";
    degraded: boolean;
  };
  sourceStatus: ObservabilitySourceStatus[];
  entities: ObservabilityEntityHealth[];
  signalPanels: ObservabilitySignalPanel[];
  recentEvents: ObservabilityEvent[];
  externalLinks: Array<{
    key: string;
    label: string;
    url: string | null;
    available: boolean;
  }>;
  degraded: boolean;
  note?: string;
}

export async function getObservabilitySummary(
  options: { range?: MonitoringTimePreset; from?: string; to?: string } = {},
  token?: string,
  requestOptions: { signal?: AbortSignal } = {},
): Promise<ObservabilitySummary> {
  return apiRequest<ObservabilitySummary>("/api/monitoring/observability/summary", {
    query: { range: options.range, from: options.from, to: options.to },
    token,
    signal: requestOptions.signal,
  });
}
