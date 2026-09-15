import { apiRequest } from "./client";
import type { ObservabilityDataSource } from "./observability-config";

export type LogTimeRange = "15m" | "1h" | "6h" | "24h";
export interface LogCenterQuery {
  clusterId: string;
  dataSourceId: string;
  from: string;
  to: string;
  namespace?: string;
  keyword?: string;
  limit?: number;
}
export interface LogCenterRow {
  id: string;
  timestamp: string;
  namespace: string;
  pod: string;
  container: string;
  message: string;
}

export function canQueryLogCenter(role: string) {
  return role === "admin" || role === "platform-admin";
}

export function eligibleLogSources(sources: ObservabilityDataSource[], clusterId: string) {
  return sources.filter((source) => source.clusterId === clusterId && source.kind === "elasticsearch" && source.enabled);
}

export function logQueryWindow(range: LogTimeRange, now = new Date()) {
  const minutes = { "15m": 15, "1h": 60, "6h": 360, "24h": 1440 }[range];
  return { from: new Date(now.getTime() - minutes * 60_000).toISOString(), to: now.toISOString() };
}

export function queryLogCenter(input: LogCenterQuery, token?: string, signal?: AbortSignal) {
  return apiRequest<{ rows: LogCenterRow[] }, LogCenterQuery>("/api/log-center/query", { method: "POST", body: input, token, signal });
}
