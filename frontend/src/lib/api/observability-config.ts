import { apiRequest } from "./client";

export const OBSERVABILITY_KINDS = [
  "prometheus",
  "grafana",
  "alertmanager",
  "elasticsearch",
  "kibana",
] as const;
export type ObservabilityKind = (typeof OBSERVABILITY_KINDS)[number];
export type ObservabilityStatus = "unknown" | "healthy" | "degraded" | "unavailable" | "disabled";
export type AlertSeverity = "critical" | "warning" | "info";
export const NOTIFICATION_CHANNELS = ["feishu", "dingtalk", "wecom", "email", "webhook", "slack", "pagerduty"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface ObservabilityDataSource {
  id: string;
  clusterId?: string;
  kind: ObservabilityKind;
  name: string;
  endpoint: string;
  secretRef?: string;
  enabled: boolean;
  status: ObservabilityStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AlertTemplate {
  id: string;
  name: string;
  severity: AlertSeverity;
  expression: string;
  duration?: string;
  enabled: boolean;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: NotificationChannel;
  endpoint: string;
  secretRef?: string;
  bodyTemplate: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ObservabilityCatalog {
  dataSourceKinds: ObservabilityKind[];
  notificationChannels: NotificationChannel[];
  defaults: Partial<Record<ObservabilityKind, string | null>>;
}

interface Collection<T> {
  items: T[];
  total: number;
  timestamp: string;
}

export interface DataSourceInput {
  clusterId?: string;
  kind: ObservabilityKind;
  name: string;
  endpoint: string;
  secretRef?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AlertTemplateInput {
  name: string;
  severity: AlertSeverity;
  expression: string;
  duration?: string;
  enabled?: boolean;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface NotificationTemplateInput {
  name: string;
  channel: NotificationChannel;
  endpoint: string;
  secretRef?: string;
  bodyTemplate: string;
  enabled?: boolean;
}

export interface SourceHealthResult {
  id?: string;
  status: ObservabilityStatus;
  latencyMs: number | null;
  checkedAt?: string;
  error: string | null;
}

export function getObservabilityCatalog(token?: string) {
  return apiRequest<ObservabilityCatalog>("/api/observability/catalog", { token });
}

export function listObservabilityDataSources(clusterId?: string, token?: string) {
  return apiRequest<Collection<ObservabilityDataSource>>("/api/observability/data-sources", {
    token,
    query: { clusterId },
  });
}

export function createObservabilityDataSource(input: DataSourceInput, token?: string) {
  return apiRequest<ObservabilityDataSource, DataSourceInput>("/api/observability/data-sources", {
    method: "POST",
    token,
    body: input,
  });
}

export function updateObservabilityDataSource(id: string, input: Partial<DataSourceInput>, token?: string) {
  return apiRequest<ObservabilityDataSource, Partial<DataSourceInput>>(`/api/observability/data-sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteObservabilityDataSource(id: string, token?: string) {
  return apiRequest<{ id: string; deleted: true }>(`/api/observability/data-sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
    token,
  });
}

export function testObservabilityDataSource(id: string, token?: string) {
  return apiRequest<SourceHealthResult>(`/api/observability/data-sources/${encodeURIComponent(id)}/test`, {
    method: "POST",
    token,
  });
}

export function testObservabilityEndpoint(kind: ObservabilityKind, endpoint: string, token?: string) {
  return apiRequest<SourceHealthResult, { kind: ObservabilityKind; endpoint: string }>("/api/observability/data-sources/test", {
    method: "POST",
    token,
    body: { kind, endpoint },
  });
}

export function listAlertTemplates(token?: string) {
  return apiRequest<Collection<AlertTemplate>>("/api/observability/alert-templates", { token });
}

export function createAlertTemplate(input: AlertTemplateInput, token?: string) {
  return apiRequest<AlertTemplate, AlertTemplateInput>("/api/observability/alert-templates", {
    method: "POST",
    token,
    body: input,
  });
}

export function updateAlertTemplate(id: string, input: Partial<AlertTemplateInput>, token?: string) {
  return apiRequest<AlertTemplate, Partial<AlertTemplateInput>>(`/api/observability/alert-templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteAlertTemplate(id: string, token?: string) {
  return apiRequest<{ id: string; deleted: true }>(`/api/observability/alert-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
    token,
  });
}

export function listNotificationTemplates(token?: string) {
  return apiRequest<Collection<NotificationTemplate>>("/api/observability/notification-templates", { token });
}

export function createNotificationTemplate(input: NotificationTemplateInput, token?: string) {
  return apiRequest<NotificationTemplate, NotificationTemplateInput>("/api/observability/notification-templates", {
    method: "POST",
    token,
    body: input,
  });
}

export function updateNotificationTemplate(id: string, input: Partial<NotificationTemplateInput>, token?: string) {
  return apiRequest<NotificationTemplate, Partial<NotificationTemplateInput>>(`/api/observability/notification-templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteNotificationTemplate(id: string, token?: string) {
  return apiRequest<{ id: string; deleted: true }>(`/api/observability/notification-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
    token,
  });
}
