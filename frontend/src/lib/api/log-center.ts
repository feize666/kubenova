import { apiRequest } from "./client";

export interface LogCenterSource {
  id: string;
  name: string;
  clusterId: string;
  kind: string;
  enabled: boolean;
}

export type LogTimeRange = "15m" | "1h" | "6h" | "24h";
export interface LogCenterQuery {
  clusterId: string;
  dataSourceId: string;
  from: string;
  to: string;
  namespace?: string;
  keyword?: string;
  pod?: string;
  container?: string;
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

// Query readiness only; the server checks the effective logs grant for each request.
export function canQueryLogCenter(role: string, namespace?: string) {
  return role === "admin" || role === "platform-admin" || Boolean(namespace?.trim());
}

export function eligibleLogSources(sources: LogCenterSource[], clusterId: string) {
  return sources.filter((source) => source.clusterId === clusterId && source.kind === "elasticsearch" && source.enabled);
}

export function listLogCenterSources(clusterId: string, token?: string, signal?: AbortSignal) {
  return apiRequest<{ items: LogCenterSource[] }>(`/api/log-center/sources?clusterId=${encodeURIComponent(clusterId)}`, { token, signal });
}

export function logQueryWindow(range: LogTimeRange, now = new Date()) {
  const minutes = { "15m": 15, "1h": 60, "6h": 360, "24h": 1440 }[range];
  return { from: new Date(now.getTime() - minutes * 60_000).toISOString(), to: now.toISOString() };
}

export function queryLogCenter(input: LogCenterQuery, token?: string, signal?: AbortSignal) {
  return apiRequest<{ rows: LogCenterRow[] }, LogCenterQuery>("/api/log-center/query", { method: "POST", body: input, token, signal });
}
