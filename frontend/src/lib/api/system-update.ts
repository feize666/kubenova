import { apiRequest } from "./client";

export type SystemUpdateOperationType =
  | "install"
  | "restart"
  | "rollback"
  | "post_release_audit";

export type SystemUpdateOperationResult = "success" | "failed";

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
  runningVersion: string;
  installedVersion?: string | null;
  latestVersion: string;
  backupVersion?: string | null;
  installStatus: "idle" | "installing" | "installed-not-active" | "installed" | "restarting" | "rollbacking" | "failed";
  installable?: boolean;
  backupAvailable: boolean;
  releaseMode?: "pointer-swap";
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
}

export interface SystemUpdateHistoryResponse {
  items: SystemUpdateHistoryItem[];
  total: number;
  timestamp: string;
}

export async function getSystemUpdateStatus(token?: string): Promise<SystemUpdateStatusPayload> {
  return apiRequest<SystemUpdateStatusPayload>("/api/system/update/status", { token });
}

export async function getSystemUpdateHistory(token?: string): Promise<SystemUpdateHistoryResponse> {
  return apiRequest<SystemUpdateHistoryResponse>("/api/system/update/history", { token });
}

export async function installSystemUpdate(
  payload: { confirm: true; targetVersion: string },
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
