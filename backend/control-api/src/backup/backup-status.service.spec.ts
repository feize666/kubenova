import { BackupStatusService } from './backup-status.service';

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
});
