import { apiRequest } from "./client";

// ---------- 原有类型 ----------

export interface SecurityRiskItem {
  id: string;
  name: string;
  resource: string;
  level: string;
  owner: string;
  status: string;
  namespace: string;
}

export interface SecuritySummaryStats {
  total: number;
  high: number;
  medium: number;
  low: number;
}

export interface SecuritySummaryResponse {
  summary: SecuritySummaryStats;
  items: SecurityRiskItem[];
  timestamp: string;
}

// ---------- 安全统计 ----------

export interface SecurityStatsResponse {
  criticalVulnerabilities: number;
  openEvents: number;
  complianceScore: number;
  todayAuditLogs: number;
  timestamp: string;
}

// ---------- 安全事件 ----------

export type EventSeverity = "critical" | "high" | "medium" | "low";
export type EventStatus = "open" | "resolved";

export interface SecurityEvent {
  id: string;
  severity: EventSeverity;
  title: string;
  type: string;
  resourceName: string;
  cluster: string;
  namespace?: string | null;
  occurredAt: string;
  status: EventStatus;
  resolvedAt?: string;
}

export interface SecurityEventsResponse {
  items: SecurityEvent[];
  total: number;
  timestamp: string;
}

// ---------- 审计日志 ----------

export interface AuditLogRecord {
  id: string;
  actor: string;
  role: string;
  action: string;
  resourceType: string;
  resourceId: string;
  result: "success" | "failure";
  reason?: string;
  requestId?: string;
  timestamp: string;
}

export interface AuditLogsResponse {
  items: AuditLogRecord[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

// ---------- API 函数 ----------

export async function getSecuritySummary(token?: string): Promise<SecuritySummaryResponse> {
  return apiRequest<SecuritySummaryResponse>("/api/security/summary", {
    method: "GET",
    token,
  });
}

export async function getSecurityStats(token?: string): Promise<SecurityStatsResponse> {
  return apiRequest<SecurityStatsResponse>("/api/security/stats", {
    method: "GET",
    token,
  });
}

export async function getSecurityEvents(
  params: {
    severity?: string;
    status?: string;
    clusterId?: string;
    namespace?: string;
    page?: number;
    pageSize?: number;
  } = {},
  token?: string,
): Promise<SecurityEventsResponse> {
  return apiRequest<SecurityEventsResponse>("/api/security/events", {
    method: "GET",
    query: {
      severity: params.severity,
      status: params.status,
      clusterId: params.clusterId,
      namespace: params.namespace,
      page: params.page,
      pageSize: params.pageSize,
    },
    token,
  });
}

export async function resolveSecurityEvent(id: string, token?: string): Promise<SecurityEvent> {
  return apiRequest<SecurityEvent>(`/api/security/events/${id}/resolve`, {
    method: "PATCH",
    token,
  });
}

export async function getAuditLogs(
  params: {
    action?: string;
    resourceType?: string;
    actor?: string;
    result?: string;
    page?: number;
    pageSize?: number;
  } = {},
  token?: string,
): Promise<AuditLogsResponse> {
  return apiRequest<AuditLogsResponse>("/api/security/audit-logs", {
    method: "GET",
    query: {
      action: params.action,
      resourceType: params.resourceType,
      actor: params.actor,
      result: params.result,
      page: params.page,
      pageSize: params.pageSize,
    },
    token,
  });
}
