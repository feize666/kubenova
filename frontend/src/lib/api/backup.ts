import { apiRequest } from './client';

export type BackupRepositoryType = 's3' | 'oss' | 'unknown' | 'unconfigured';
export type BackupRunStatus = 'success' | 'failed' | 'running' | 'unknown';

export interface BackupStatusPayload {
  configuration: {
    ready: boolean;
    repositoryConfigured: boolean;
    passwordFileConfigured: boolean;
    databaseConfigured: boolean;
    configurationFilesConfigured: boolean;
  };
  repository: { type: BackupRepositoryType };
  retention: { daily: 7; weekly: 4 };
  schedule: { configured: boolean; expression: string | null; timezone: string };
  lastRun: { status: BackupRunStatus; startedAt: string | null; completedAt: string | null };
  recovery: { webRestoreEnabled: false; rehearsalRequired: true };
  timestamp: string;
}

export function getBackupStatus(token?: string): Promise<BackupStatusPayload> {
  return apiRequest<BackupStatusPayload>('/api/system/backup/status', { token });
}
