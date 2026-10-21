export interface SystemUpdateInstallRequest {
  confirm?: boolean;
  targetVersion?: string;
  preflightId?: string;
  backupTargetId?: string;
}

export interface SystemUpdatePreflightRequest {
  targetVersion?: string;
  backupTargetId?: string;
  migrationTargetId?: string;
}

export interface SystemUpdatePreflightPayload {
  id: string;
  taskId?: string | null;
  status: 'running' | 'passed' | 'failed' | 'expired';
  targetVersion: string;
  deploymentMode: 'compose' | 'systemd' | 'kubernetes' | 'source' | 'unknown';
  expiresAt: string | null;
  backupTargetId: string | null;
  migrationTargetId: string | null;
  message: string;
  imageDigests?: {
    frontend: string;
    controlApi: string;
    runtimeGateway: string;
  } | null;
  checks: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; message: string }>;
}

export interface SystemUpdateRestartRequest {
  confirm?: boolean;
  message?: string;
}

export interface SystemUpdateRollbackRequest {
  confirm?: boolean;
  targetVersion?: string;
  message?: string;
}

export interface SystemUpdatePostReleaseAuditRequest {
  confirm?: boolean;
  releaseVersion?: string;
}

export type SystemUpdateOperationType =
  | 'install'
  | 'restart'
  | 'rollback'
  | 'post_release_audit';

export type SystemUpdateOperationResult = 'queued' | 'running' | 'success' | 'failed';

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
  deploymentMode: 'compose' | 'systemd' | 'kubernetes' | 'source' | 'unknown';
  runningVersion: string;
  installedVersion?: string | null;
  latestVersion: string;
  checkState: 'checking' | 'current' | 'available' | 'migration-required' | 'ahead' | 'error';
  releaseNotes: string | null;
  migrationRequired: boolean;
  updateAvailable?: boolean;
  latestReleaseUrl?: string | null;
  latestReleasePublishedAt?: string | null;
  lastUpdateCheckAt?: string | null;
  buildType: 'release' | 'source';
  updateCheckError: string | null;
  releaseValidationMessage: string | null;
  releaseReady: boolean;
  downloadUrl: string | null;
  checksumUrl: string | null;
  manifestUrl: string | null;
  imageDigests?: {
    frontend: string;
    controlApi: string;
    runtimeGateway: string;
  } | null;
  manualUpdateReason: string;
  backupVersion?: string | null;
  rollbackCandidates?: Array<{
    version: string;
    backupAvailable: boolean;
    imageDigests?: Record<string, string>;
  }>;
  installStatus:
    | 'idle'
    | 'queued'
    | 'installing'
    | 'backing-up'
    | 'downloading'
    | 'verifying'
    | 'switching'
    | 'health-check'
    | 'installed-not-active'
    | 'installed'
    | 'restarting'
    | 'rollbacking'
    | 'failed';
  installable?: boolean;
  updateExecutorReady?: boolean;
  installReady?: boolean;
  installProgress?: {
    taskId: string;
    targetVersion: string;
    phase: string;
    percent: number | null;
    message: string | null;
    startedAt: string;
  } | null;
  backupAvailable: boolean;
  releaseMode?: 'pointer-swap' | 'manual';
  rollbackSlaTargetMs?: number;
  rollbackSlaLastMs?: number | null;
  rollbackSlaMet?: boolean | null;
  postReleaseAudit: {
    enabled: boolean;
    strategy: 'async-after-release';
    status: 'idle' | 'running' | 'passed' | 'failed';
    lastRunAt: string | null;
    lastSummary: string | null;
  };
  lastOperation: SystemUpdateHistoryItem | null;
  lastOperationResult: SystemUpdateOperationResult | null;
  timestamp: string;
  preflight: SystemUpdatePreflightPayload | null;
}

export interface SystemUpdateRelease {
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
  notes: string | null;
  downloadUrl: string | null;
  checksumUrl: string | null;
  manifestUrl: string | null;
  imageDigests?: {
    frontend: string;
    controlApi: string;
    runtimeGateway: string;
  } | null;
  validationMessage?: string | null;
  releaseReady: boolean;
}

export interface SystemUpdateReleasesPayload {
  items: SystemUpdateRelease[];
  total: number;
  timestamp: string;
  error?: string;
}
