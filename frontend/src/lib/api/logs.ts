import { apiRequest } from "./client";
import type { CreateRuntimeSessionResponse } from "./runtime";
import { buildRuntimeTargetParams, resolveRuntimeContainer, type RuntimeTargetBase } from "./runtime";

export type LogLevel = "INFO" | "WARN" | "ERROR";
export type LogsTimeMode = "quick" | "relative" | "absolute" | "recent";

export interface LogRecord {
  id: string;
  clusterId: string;
  clusterName?: string;
  namespace: string;
  pod: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

export interface LogsQueryParams {
  clusterId?: string;
  namespace?: string;
  pod?: string;
  container?: string;
  level?: LogLevel;
  keyword?: string;
  tailLines?: number;
  sinceSeconds?: number;
  sinceTime?: string;
  untilTime?: string;
  timeMode?: LogsTimeMode;
  from?: string;
  to?: string;
  refreshIntervalSeconds?: number;
  follow?: boolean;
  previous?: boolean;
  timestamps?: boolean;
  page?: number;
  pageSize?: number;
}

export interface LogsRouteTarget extends RuntimeTargetBase {
  containerNames?: string[];
  clusterName?: string;
  resourceKind?: string;
  resourceName?: string;
  resourceId?: string;
  level?: LogLevel;
  keyword?: string;
  sinceSeconds?: number;
  sinceTime?: string;
  untilTime?: string;
  timeMode?: LogsTimeMode;
  refreshIntervalSeconds?: number;
  tailLines?: number;
  follow?: boolean;
  previous?: boolean;
  timestamps?: boolean;
  from?: string;
  to?: string;
  returnTo?: string;
  returnClusterId?: string;
  returnClusterName?: string;
  returnNamespace?: string;
  returnKeyword?: string;
  returnPhase?: string;
  returnPage?: number;
}

export interface LogsResourceFocus {
  kind?: string;
  name?: string;
  id?: string;
  section?: string;
}

export function buildLogsQueryParams(params: LogsQueryParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.clusterId) query.set("clusterId", params.clusterId);
  if (params.namespace) query.set("namespace", params.namespace);
  if (params.pod) query.set("pod", params.pod);
  if (params.container) query.set("container", resolveRuntimeContainer(params.container));
  if (params.level) query.set("level", params.level);
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.tailLines !== undefined) query.set("tailLines", String(params.tailLines));
  if (params.sinceSeconds !== undefined) query.set("sinceSeconds", String(params.sinceSeconds));
  if (params.sinceTime) query.set("sinceTime", params.sinceTime);
  if (params.untilTime) query.set("untilTime", params.untilTime);
  if (params.timeMode) query.set("timeMode", params.timeMode);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.refreshIntervalSeconds !== undefined) {
    query.set("refreshIntervalSeconds", String(params.refreshIntervalSeconds));
  }
  if (params.follow !== undefined) query.set("follow", String(params.follow));
  if (params.previous !== undefined) query.set("previous", String(params.previous));
  if (params.timestamps !== undefined) query.set("timestamps", String(params.timestamps));
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.pageSize !== undefined) query.set("pageSize", String(params.pageSize));
  return query;
}

export function buildLogsRoute(target: LogsRouteTarget): string {
  const params = buildRuntimeTargetParams({
    ...target,
    container: resolveRuntimeContainer(target.container, target.containerNames),
  });
  if (target.clusterName) params.set("clusterName", target.clusterName);
  if (target.resourceKind) params.set("resourceKind", target.resourceKind);
  if (target.resourceName) params.set("resourceName", target.resourceName);
  if (target.resourceId) params.set("resourceId", target.resourceId);
  if (target.level) params.set("level", target.level);
  if (target.keyword) params.set("keyword", target.keyword);
  if (typeof target.sinceSeconds === "number" && Number.isFinite(target.sinceSeconds)) {
    params.set("sinceSeconds", String(target.sinceSeconds));
  }
  if (target.sinceTime) params.set("sinceTime", target.sinceTime);
  if (target.untilTime) params.set("untilTime", target.untilTime);
  if (target.timeMode) params.set("timeMode", target.timeMode);
  if (
    typeof target.refreshIntervalSeconds === "number" &&
    Number.isFinite(target.refreshIntervalSeconds)
  ) {
    params.set("refreshIntervalSeconds", String(target.refreshIntervalSeconds));
  }
  if (typeof target.tailLines === "number" && Number.isFinite(target.tailLines)) {
    params.set("tailLines", String(target.tailLines));
  }
  if (typeof target.follow === "boolean") params.set("follow", String(target.follow));
  if (typeof target.previous === "boolean") params.set("previous", String(target.previous));
  if (typeof target.timestamps === "boolean") params.set("timestamps", String(target.timestamps));
  if (target.from) params.set("from", target.from);
  if (target.to) params.set("to", target.to);
  if (target.returnTo) params.set("returnTo", target.returnTo);
  if (target.returnClusterId) params.set("returnClusterId", target.returnClusterId);
  if (target.returnClusterName) params.set("returnClusterName", target.returnClusterName);
  if (target.returnNamespace) params.set("returnNamespace", target.returnNamespace);
  if (target.returnKeyword) params.set("returnKeyword", target.returnKeyword);
  if (target.returnPhase) params.set("returnPhase", target.returnPhase);
  if (typeof target.returnPage === "number" && Number.isFinite(target.returnPage)) {
    params.set("returnPage", String(target.returnPage));
  }
  return `/logs?${params.toString()}`;
}

export function buildLogsResourceContext(target: LogsRouteTarget, focus?: LogsResourceFocus): string {
  const params = buildLogsQueryParams(target);
  params.set("view", "resource");
  if (target.resourceKind) params.set("resourceKind", target.resourceKind);
  if (target.resourceName) params.set("resourceName", target.resourceName);
  if (target.resourceId) params.set("resourceId", target.resourceId);
  if (focus?.kind) params.set("resourceKind", focus.kind);
  if (focus?.name) params.set("resourceName", focus.name);
  if (focus?.id) params.set("resourceId", focus.id);
  if (focus?.section) params.set("resourceSection", focus.section);
  return params.toString();
}

export interface LogsQueryResponse {
  items: LogRecord[];
  page: number;
  pageSize: number;
  total: number;
  lastLogTimestamp?: string;
  emptyReason?:
    | "TARGET_REQUIRED"
    | "NO_LOG_LINES"
    | "NO_PARSEABLE_TIMESTAMPS"
    | "TIME_RANGE_NO_MATCH"
    | "FILTER_NO_MATCH";
  timestamp: string;
}

export function getLogs(params: LogsQueryParams, token?: string) {
  const query: Record<string, string | number> = {};
  buildLogsQueryParams(params).forEach((value, key) => {
    query[key] = value;
  });
  return apiRequest<LogsQueryResponse>("/api/logs", { query, token });
}

export function createLogsStreamSession(params: LogsQueryParams, token?: string) {
  return apiRequest<CreateRuntimeSessionResponse, Record<string, unknown>>("/api/logs/stream", {
    method: "POST",
    body: {
      clusterId: params.clusterId,
      namespace: params.namespace,
      pod: params.pod,
      container: resolveRuntimeContainer(params.container),
      level: params.level,
      keyword: params.keyword,
      tailLines: params.tailLines,
      sinceSeconds: params.sinceSeconds,
      sinceTime: params.sinceTime,
      untilTime: params.untilTime,
      timeMode: params.timeMode,
      from: params.from,
      to: params.to,
      refreshIntervalSeconds: params.refreshIntervalSeconds,
      follow: params.follow,
      previous: params.previous,
      timestamps: params.timestamps,
    },
    token,
  });
}
