import { BackupStatusService } from './backup-status.service';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('BackupStatusService', () => {
  const names = [
    'RESTIC_REPOSITORY',
    'RESTIC_PASSWORD_FILE',
    'DATABASE_URL',
    'KEYCLOAK_DATABASE_URL',
    'BACKUP_CONFIG_FILES',
    'BACKUP_SCHEDULE',
    'BACKUP_SCHEDULE_TIMEZONE',
    'BACKUP_STATUS_FILE',
  ] as const;
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });

  it('reports presence only and never exposes repository credentials', async () => {
    process.env.RESTIC_REPOSITORY = 's3:https://access:secret@s3.example.test/bucket';
    process.env.RESTIC_PASSWORD_FILE = '/etc/kubenova/restic.password';
    process.env.DATABASE_URL = 'postgres://db-secret/app';
    process.env.KEYCLOAK_DATABASE_URL = 'postgres://db-secret/keycloak';
    process.env.BACKUP_CONFIG_FILES = '["/etc/kubenova/control-api.env"]';
    process.env.BACKUP_SCHEDULE = '03:00';

    const status = await new BackupStatusService().getStatus();
    expect(status.configuration.ready).toBe(true);
    expect(status.repository).toEqual({ type: 's3' });
    expect(status.retention).toEqual({ daily: 7, weekly: 4 });
    expect(status.schedule).toMatchObject({ configured: true, expression: '03:00' });
    expect(JSON.stringify(status)).not.toContain('secret');
    expect(JSON.stringify(status)).not.toContain('postgres://');
  });

  it('fails closed to unknown last-run state when no state file exists', async () => {
    process.env.BACKUP_STATUS_FILE = '/tmp/kubenova-backup-status-does-not-exist';
    const status = await new BackupStatusService().getStatus();
    expect(status.lastRun).toEqual({ status: 'unknown', startedAt: null, completedAt: null });
    expect(status.recovery).toEqual({ webRestoreEnabled: false, rehearsalRequired: true });
  });

  it('requires the S3-compatible Restic scheme even for OSS', async () => {
    process.env.RESTIC_PASSWORD_FILE = '/configured/password';
    process.env.DATABASE_URL = 'configured';
    process.env.KEYCLOAK_DATABASE_URL = 'configured';
    process.env.BACKUP_CONFIG_FILES = '["/configured/env"]';
    process.env.RESTIC_REPOSITORY = 'oss:https://oss-cn-beijing.aliyuncs.com/bucket';
    expect((await new BackupStatusService().getStatus()).configuration.ready).toBe(false);
    process.env.RESTIC_REPOSITORY = 's3:https://oss-cn-beijing.aliyuncs.com/bucket';
    expect((await new BackupStatusService().getStatus()).repository.type).toBe('oss');
    expect((await new BackupStatusService().getStatus()).configuration.ready).toBe(true);
  });

  it('reads published outcomes without returning extra persisted fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'backup-status-'));
    try {
      process.env.BACKUP_STATUS_FILE = join(directory, 'status.json');
      for (const status of ['running', 'success', 'failed']) {
        const expected = { status, startedAt: '2026-09-22T00:00:00.000Z',
          completedAt: status === 'running' ? null : '2026-09-22T00:01:00.000Z' };
        await writeFile(process.env.BACKUP_STATUS_FILE, JSON.stringify({ ...expected, credentials: 'must-not-return' }));
        const result = await new BackupStatusService().getStatus();
        expect(result.lastRun).toEqual(expected);
        expect(JSON.stringify(result)).not.toContain('must-not-return');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
