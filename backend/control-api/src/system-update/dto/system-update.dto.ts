export interface SystemUpdateInstallRequest {
  confirm?: boolean;
  targetVersion?: string;
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

export type SystemUpdateOperationResult = 'success' | 'failed';

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
  installStatus:
    | 'idle'
    | 'installing'
    | 'installed-not-active'
    | 'installed'
    | 'restarting'
    | 'rollbacking'
    | 'failed';
  installable?: boolean;
  backupAvailable: boolean;
  releaseMode?: 'pointer-swap';
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
}
