import { apiRequest } from "./client";

export type SystemUpdateOperationType =
  | "install"
  | "restart"
  | "rollback"
  | "post_release_audit";

export type SystemUpdateOperationResult = "queued" | "running" | "success" | "failed";

export interface SystemUpdateHistoryItem {
  operationType: SystemUpdateOperationType;
  targetVersion?: string;
  result: SystemUpdateOperationResult;
  message: string;
  timestamp: string;
  operator: string;
  durationMs?: number;
}

export interface SystemUpdateStatusPayload {
  deploymentMode: "compose" | "systemd" | "kubernetes" | "source" | "unknown";
  checkState: "checking" | "current" | "available" | "migration-required" | "ahead" | "error";
  releaseNotes: string | null;
  migrationRequired: boolean;
  runningVersion: string;
  installedVersion?: string | null;
  latestVersion: string;
  updateAvailable?: boolean;
  latestReleaseUrl?: string | null;
  latestReleasePublishedAt?: string | null;
  lastUpdateCheckAt?: string | null;
  buildType: "release" | "source";
  updateCheckError: string | null;
  releaseValidationMessage: string | null;
  releaseReady: boolean;
  downloadUrl: string | null;
  checksumUrl: string | null;
  manifestUrl: string | null;
  imageDigests?: { frontend: string; controlApi: string; runtimeGateway: string } | null;
  manualUpdateReason: string;
  backupVersion?: string | null;
  rollbackCandidates?: Array<{ version: string; backupAvailable: boolean; imageDigests?: Record<string, string> }>;
  installStatus: "idle" | "queued" | "installing" | "backing-up" | "downloading" | "verifying" | "switching" | "health-check" | "installed-not-active" | "installed" | "restarting" | "rollbacking" | "failed";
  installable?: boolean;
  updateExecutorReady?: boolean;
  installReady?: boolean;
  installProgress?: { taskId: string; targetVersion: string; phase: string; percent: number | null; message: string | null; startedAt: string } | null;
  backupAvailable: boolean;
  releaseMode?: "pointer-swap" | "manual";
  rollbackSlaTargetMs?: number;
  rollbackSlaLastMs?: number | null;
  rollbackSlaMet?: boolean | null;
  postReleaseAudit: {
    enabled: boolean;
    strategy: "async-after-release";
    status: "idle" | "running" | "passed" | "failed";
    lastRunAt: string | null;
    lastSummary: string | null;
  };
  lastOperation: SystemUpdateHistoryItem | null;
  lastOperationResult: SystemUpdateOperationResult | null;
  timestamp: string;
  preflight: SystemUpdatePreflightPayload | null;
}

export interface SystemUpdatePreflightPayload {
  id: string;
  status: "running" | "passed" | "failed" | "expired";
  targetVersion: string;
  deploymentMode: SystemUpdateStatusPayload["deploymentMode"];
  expiresAt: string | null;
  backupTargetId: string | null;
  migrationTargetId: string | null;
  message: string;
  imageDigests?: { frontend: string; controlApi: string; runtimeGateway: string } | null;
  checks: Array<{ name: string; status: "passed" | "failed" | "skipped"; message: string }>;
}

export interface SystemUpdateSettings {
  backupTargets: Array<{ id: string; name: string; type: "local" | "s3"; location: string; configured: boolean }>;
  migrationTargets: Array<{ id: string; name: string; type: "local" | "external"; configured: boolean }>;
  registry: { defaultPrefix: string; components: Record<string, string>; imagePullSecretName: string | null; configured: boolean };
}

export interface SystemUpdateHistoryResponse {
  items: SystemUpdateHistoryItem[];
  total: number;
  timestamp: string;
}

export interface KubernetesUpdateTask {
  id: string;
  payload: { action: "install" | "rollback"; targetVersion: string };
  status: "queued" | "running" | "succeeded" | "failed";
  phase: string;
  percent: number | null;
  message: string | null;
  attempt: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export async function getLatestKubernetesUpdateTask(token?: string): Promise<KubernetesUpdateTask | null> {
  return apiRequest<KubernetesUpdateTask | null>("/api/system/update/tasks/latest", { token });
}

export async function getKubernetesUpdateTask(taskId: string, token?: string): Promise<KubernetesUpdateTask | null> {
  return apiRequest<KubernetesUpdateTask | null>(`/api/system/update/tasks/${encodeURIComponent(taskId)}`, { token });
}

export interface SystemRelease {
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
  notes: string | null;
  downloadUrl: string | null;
  checksumUrl: string | null;
  manifestUrl: string | null;
  imageDigests?: { frontend: string; controlApi: string; runtimeGateway: string } | null;
  validationMessage?: string | null;
  releaseReady: boolean;
}

export function getSystemReleases(token?: string) {
  return apiRequest<{ items: SystemRelease[]; total: number; timestamp: string; error?: string | null }>(
    "/api/system/update/releases", { token },
  );
}

export async function getSystemUpdateStatus(token?: string): Promise<SystemUpdateStatusPayload> {
  return apiRequest<SystemUpdateStatusPayload>("/api/system/update/status", { token });
}

export async function checkSystemUpdate(token?: string): Promise<SystemUpdateStatusPayload> {
  return apiRequest<SystemUpdateStatusPayload>("/api/system/update/check", { method: "POST", token });
}

export async function preflightSystemUpdate(payload: { targetVersion?: string; backupTargetId?: string; migrationTargetId?: string }, token?: string): Promise<SystemUpdateStatusPayload> {
  return apiRequest<SystemUpdateStatusPayload, typeof payload>("/api/system/update/preflight", { method: "POST", token, body: payload });
}

export async function getSystemUpdateSettings(token?: string): Promise<SystemUpdateSettings> {
  return apiRequest<SystemUpdateSettings>("/api/system/update/settings", { token });
}

export async function saveSystemUpdateSettings(payload: SystemUpdateSettingsInput, token?: string): Promise<SystemUpdateSettings> {
  return apiRequest<SystemUpdateSettings, SystemUpdateSettingsInput>("/api/system/update/settings", { method: "PUT", token, body: payload });
}

export interface SystemUpdateSettingsInput {
  backupTargets: Array<{ id: string; name: string; type: "local" | "s3"; location: string; secret?: Record<string, string> }>;
  migrationTargets: Array<{ id: string; name: string; type: "local" | "external"; connection?: string }>;
  registry: { defaultPrefix: string; components: Record<string, string>; imagePullSecretName: string | null; token?: string };
}

export async function getSystemUpdateHistory(token?: string): Promise<SystemUpdateHistoryResponse> {
  return apiRequest<SystemUpdateHistoryResponse>("/api/system/update/history", { token });
}

export async function installSystemUpdate(
  payload: { confirm: true; targetVersion: string; preflightId: string; backupTargetId: string },
  token?: string,
): Promise<SystemUpdateStatusPayload> {
  return apiRequest<SystemUpdateStatusPayload, typeof payload>("/api/system/update/install", {
    method: "POST",
    token,
    body: payload,
  });
}

export async function rollbackSystemUpdate(
  payload: { confirm: true; targetVersion?: string; message?: string },
  token?: string,
): Promise<SystemUpdateStatusPayload> {
  return apiRequest<SystemUpdateStatusPayload, typeof payload>("/api/system/update/rollback", {
    method: "POST",
    token,
    body: payload,
  });
}

export async function restartSystemUpdate(
  payload: { confirm: true; message?: string },
  token?: string,
): Promise<SystemUpdateStatusPayload> {
  return apiRequest<SystemUpdateStatusPayload, typeof payload>("/api/system/update/restart", {
    method: "POST",
    token,
    body: payload,
  });
}

export async function triggerPostReleaseAudit(
  payload: { confirm: true; releaseVersion?: string },
  token?: string,
): Promise<SystemUpdateStatusPayload> {
  return apiRequest<SystemUpdateStatusPayload, typeof payload>("/api/system/update/post-release-audit", {
    method: "POST",
    token,
    body: payload,
  });
}
