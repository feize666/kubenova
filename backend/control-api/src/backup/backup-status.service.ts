import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BackupRepositoryType,
  BackupRunStatus,
  BackupStatusPayload,
} from './backup-status.dto';

type PersistedBackupRun = {
  status?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
};

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function repositoryType(repository: string | undefined): BackupRepositoryType {
  const value = repository?.trim();
  if (!value) return 'unconfigured';
  if (!/^s3:/i.test(value) && !/^oss:/i.test(value)) return 'unknown';
  if (/^oss:/i.test(value) || /(?:^|[./])aliyuncs\.com(?:\/|$)/i.test(value)) {
    return 'oss';
  }
  return 's3';
}

function timestampOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function runStatus(value: unknown): BackupRunStatus {
  return value === 'success' || value === 'failed' || value === 'running'
    ? value
    : 'unknown';
}

@Injectable()
export class BackupStatusService {
  async getStatus(): Promise<BackupStatusPayload> {
    const repositoryConfigured = hasValue(process.env.RESTIC_REPOSITORY);
    const passwordFileConfigured = hasValue(process.env.RESTIC_PASSWORD_FILE);
    const databaseConfigured = hasValue(process.env.DATABASE_URL) && hasValue(process.env.KEYCLOAK_DATABASE_URL);
    const configurationFilesConfigured = hasValue(process.env.BACKUP_CONFIG_FILES);
    const type = repositoryType(process.env.RESTIC_REPOSITORY);
    const lastRun = await this.readLastRun();
    const scheduleExpression = process.env.BACKUP_SCHEDULE?.trim() || null;

    return {
      configuration: {
        ready: repositoryConfigured && passwordFileConfigured && databaseConfigured && configurationFilesConfigured && type !== 'unknown',
        repositoryConfigured,
        passwordFileConfigured,
        databaseConfigured,
        configurationFilesConfigured,
      },
      repository: { type },
      retention: { daily: 7, weekly: 4 },
      schedule: {
        configured: Boolean(scheduleExpression),
        expression: scheduleExpression,
        timezone: process.env.BACKUP_SCHEDULE_TIMEZONE?.trim() || 'Asia/Shanghai',
      },
      lastRun,
      recovery: { webRestoreEnabled: false, rehearsalRequired: true },
      timestamp: new Date().toISOString(),
    };
  }

  private async readLastRun(): Promise<BackupStatusPayload['lastRun']> {
    const path = process.env.BACKUP_STATUS_FILE?.trim() || join(process.cwd(), '.run/backup-status.json');
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as PersistedBackupRun;
      return {
        status: runStatus(parsed.status),
        startedAt: timestampOrNull(parsed.startedAt),
        completedAt: timestampOrNull(parsed.completedAt),
      };
    } catch {
      return { status: 'unknown', startedAt: null, completedAt: null };
    }
  }
}
