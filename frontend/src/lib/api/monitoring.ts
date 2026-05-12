import { apiRequest } from "./client";
import { withQuery } from "./query";

export interface MonitoringOverview {
  range: string;
  timestamp: string;
  healthScore: number;
  clusterTotal: number;
  clusterHealthy: number;
  warningCount: number;
  criticalCount: number;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  usageDataSource?: "metrics-server" | "k8s-metadata" | "none";
  dataSource?: "monitoring-alert" | "workload-derived" | "mixed";
  degraded?: boolean;
  note?: string;
  liveSnapshot?: {
    capturedAt: string;
    source: "metrics-server" | "cluster-metrics-cache" | "none";
    available: boolean;
    freshnessWindowMs: number;
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
}

export interface MonitoringAlert {
  id: string;
  clusterId: string | null;
  namespace: string | null;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  source: string | null;
  resourceType: string | null;
  resourceName: string | null;
  status: "firing" | "resolved";
  firedAt: string;
  resolvedAt: string | null;
}

export interface MonitoringAlertsResponse {
  items: MonitoringAlert[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
  dataSource?: "monitoring-alert" | "workload-derived";
  degraded?: boolean;
  note?: string;
}

export interface InspectionIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  category: "cluster" | "namespace" | "workload" | "network" | "storage" | "config" | "security" | "alert";
  title: string;
  resourceRef: string;
  clusterId?: string | null;
  namespace?: string | null;
  suggestion: string;
  evidence?: string;
  actions: InspectionIssueAction[];
}

export type InspectionActionType = "generate-yaml" | "create-hpa-draft";

export interface InspectionIssueAction {
  type: InspectionActionType;
  label: string;
  description: string;
}

export interface InspectionActionResult {
  issueId: string;
  action: InspectionActionType;
  success: boolean;
  message: string;
  generatedYaml?: string;
  target?: {
    kind: string;
    namespace?: string;
    name?: string;
    clusterId?: string;
  };
}

export interface ClusterInspectionReport {
  timestamp: string;
  clusterId?: string;
  summary: {
    score: number;
    totalResources: number;
    issueTotal: number;
    critical: number;
    warning: number;
    pass: number;
  };
  items: InspectionIssue[];
}

export type InspectionExportFormat = "json" | "csv" | "xlsx";
export type MonitoringTimePreset = "15m" | "1h" | "6h" | "24h" | "7d";

export interface MonitoringTimeFilter {
  range?: MonitoringTimePreset;
  from?: string;
  to?: string;
}

export interface InspectionReportDownload {
  blob: Blob;
  filename: string;
  contentType: string;
}

export interface AlertsReportDownload {
  blob: Blob;
  filename: string;
  contentType: string;
}

export async function getMonitoringOverview(
  options: { range?: MonitoringTimePreset; from?: string; to?: string } = {},
  token?: string,
): Promise<MonitoringOverview> {
  return apiRequest<MonitoringOverview>("/api/monitoring/overview", {
    query: { range: options.range, from: options.from, to: options.to },
    token,
  });
}

export async function getMonitoringAlerts(
  params: {
    severity?: string;
    status?: string;
    page?: number;
    pageSize?: number;
    range?: MonitoringTimePreset;
    from?: string;
    to?: string;
  } = {},
  token?: string,
): Promise<MonitoringAlertsResponse> {
  return apiRequest<MonitoringAlertsResponse>("/api/monitoring/alerts", {
    query: {
      severity: params.severity,
      status: params.status,
      page: params.page,
      pageSize: params.pageSize,
      range: params.range,
      from: params.from,
      to: params.to,
    },
    token,
  });
}

export async function resolveAlert(id: string, token?: string): Promise<MonitoringAlert> {
  return apiRequest<MonitoringAlert>(`/api/monitoring/alerts/${id}`, {
    method: "PATCH",
    body: { status: "resolved" },
    token,
  });
}

export async function getClusterInspection(
  options?:
    | string
    | ({
        clusterId?: string;
        namespace?: string;
        token?: string;
      } & MonitoringTimeFilter),
  tokenArg?: string,
  requestOptions?: { suppressAuthExpiryBroadcast?: boolean },
): Promise<ClusterInspectionReport> {
  const resolved =
    typeof options === "string"
      ? { clusterId: options, token: tokenArg }
      : {
          clusterId: options?.clusterId,
          namespace: options?.namespace,
          token: options?.token,
          range: options?.range,
          from: options?.from,
          to: options?.to,
        };

  return apiRequest<ClusterInspectionReport>("/api/monitoring/inspection", {
    query: {
      clusterId: resolved.clusterId?.trim() || undefined,
      namespace: resolved.namespace?.trim() || undefined,
      range: resolved.range,
      from: resolved.from,
      to: resolved.to,
    },
    token: resolved.token,
    suppressAuthExpiryBroadcast: requestOptions?.suppressAuthExpiryBroadcast,
  });
}

export async function executeInspectionAction(
  issueId: string,
  action: InspectionActionType,
  options: { clusterId?: string; token?: string } = {},
): Promise<InspectionActionResult> {
  const endpoint =
    action === "create-hpa-draft"
      ? `/api/monitoring/inspection/${issueId}/actions/create-hpa-draft`
      : `/api/monitoring/inspection/${issueId}/actions/generate-yaml`;

  return apiRequest<InspectionActionResult>(endpoint, {
    method: "POST",
    body: { clusterId: options.clusterId?.trim() || undefined },
    token: options.token,
  });
}

function parseDownloadFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) {
    return fallback;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  return fallback;
}

export async function exportInspectionReport(
  options: {
    clusterId?: string;
    format: InspectionExportFormat;
    range?: MonitoringTimePreset;
    from?: string;
    to?: string;
    token?: string;
  },
): Promise<InspectionReportDownload> {
  const path = withQuery("/api/monitoring/inspection/export", {
    clusterId: options.clusterId?.trim() || undefined,
    format: options.format,
    range: options.range,
    from: options.from,
    to: options.to,
  });
  const headers = new Headers();
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  const response = await fetch(path, {
    method: "GET",
    headers,
  });
  if (!response.ok) {
    throw new Error(`导出失败 (${response.status})`);
  }
  const blob = await response.blob();
  const fallbackName = `inspection-report.${options.format}`;
  const filename = parseDownloadFilename(response.headers.get("content-disposition"), fallbackName);
  const contentType = response.headers.get("content-type") ?? blob.type ?? "application/octet-stream";

  return {
    blob,
    filename,
    contentType,
  };
}

export async function rerunClusterInspection(
  options: {
    clusterId?: string;
    range?: MonitoringTimePreset;
    from?: string;
    to?: string;
    token?: string;
  },
): Promise<ClusterInspectionReport> {
  return apiRequest<ClusterInspectionReport>("/api/monitoring/inspection/rerun", {
    method: "POST",
    body: {
      clusterId: options.clusterId?.trim() || undefined,
      range: options.range,
      from: options.from,
      to: options.to,
    },
    token: options.token,
  });
}

export async function exportAlertsReport(
  options: {
    severity?: string;
    status?: string;
    format: InspectionExportFormat;
    range?: MonitoringTimePreset;
    from?: string;
    to?: string;
    token?: string;
  },
): Promise<AlertsReportDownload> {
  const path = withQuery("/api/monitoring/alerts/export", {
    severity: options.severity,
    status: options.status,
    format: options.format,
    range: options.range,
    from: options.from,
    to: options.to,
  });
  const headers = new Headers();
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  const response = await fetch(path, {
    method: "GET",
    headers,
  });
  if (!response.ok) {
    throw new Error(`导出失败 (${response.status})`);
  }
  const blob = await response.blob();
  const fallbackName = `alerts-report.${options.format}`;
  const filename = parseDownloadFilename(response.headers.get("content-disposition"), fallbackName);
  const contentType = response.headers.get("content-type") ?? blob.type ?? "application/octet-stream";

  return {
    blob,
    filename,
    contentType,
  };
}
