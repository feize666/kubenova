import { KubernetesMigrationRehearsalService } from './kubernetes-migration-rehearsal.service';

describe('Kubernetes migration rehearsal', () => {
  it('restores, tests target migrations and previous-image compatibility, then deletes the temporary database', async () => {
    const events: string[] = [];
    const service = new KubernetesMigrationRehearsalService({
      createTemporaryDatabase: async () => { events.push('create'); return { name: 'kubenova_preflight_a1b2c3d4', connectionString: 'postgresql://test/db' }; },
      restoreBackup: async () => { events.push('restore'); },
      runTargetMigrations: async () => { events.push('target-migrations'); },
      checkPreviousVersionCompatibility: async () => { events.push('previous-compatibility'); },
      dropTemporaryDatabase: async () => { events.push('drop'); },
    });

    const result = await service.run({ backupLocation: '/backup.dump', targetVersion: 'v1.9', targetImage: 'target@sha256:abc', previousImage: 'previous@sha256:def' });

    expect(result.status).toBe('passed');
    expect(result.checks.map((check) => check.name)).toEqual(['临时测试库', '备份恢复', '目标版本迁移', '旧版本兼容', '临时测试库清理']);
    expect(result.checks.every((check) => check.status === 'passed')).toBe(true);
    expect(events).toEqual(['create', 'restore', 'target-migrations', 'previous-compatibility', 'drop']);
  });

  it('skips compatibility after migration failure but still drops the temporary database', async () => {
    const events: string[] = [];
    const service = new KubernetesMigrationRehearsalService({
      createTemporaryDatabase: async () => ({ name: 'kubenova_preflight_a1b2c3d4', connectionString: 'postgresql://test/db' }),
      restoreBackup: async () => { events.push('restore'); },
      runTargetMigrations: async () => { events.push('target-migrations'); throw new Error('migration failed'); },
      checkPreviousVersionCompatibility: async () => { events.push('previous-compatibility'); },
      dropTemporaryDatabase: async () => { events.push('drop'); },
    });

    const result = await service.run({ backupLocation: '/backup.dump', targetVersion: 'v1.9', targetImage: 'target@sha256:abc', previousImage: 'previous@sha256:def' });

    expect(result.status).toBe('failed');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '目标版本迁移', status: 'failed' }),
      expect.objectContaining({ name: '旧版本兼容', status: 'skipped' }),
      expect.objectContaining({ name: '临时测试库清理', status: 'passed' }),
    ]));
    expect(events).toEqual(['restore', 'target-migrations', 'drop']);
  });

  it('fails closed when temporary database cleanup fails after otherwise successful tests', async () => {
    const service = new KubernetesMigrationRehearsalService({
      createTemporaryDatabase: async () => ({ name: 'kubenova_preflight_a1b2c3d4', connectionString: 'postgresql://test/db' }),
      restoreBackup: async () => undefined,
      runTargetMigrations: async () => undefined,
      checkPreviousVersionCompatibility: async () => undefined,
      dropTemporaryDatabase: async () => { throw new Error('drop failed'); },
    });

    const result = await service.run({ backupLocation: '/backup.dump', targetVersion: 'v1.9', targetImage: 'target@sha256:abc', previousImage: 'previous@sha256:def' });

    expect(result.status).toBe('failed');
    expect(result.checks.at(-1)).toMatchObject({ name: '临时测试库清理', status: 'failed' });
  });

  it('does not report success if database creation may have partially succeeded and cleanup cannot be confirmed', async () => {
    const events: string[] = [];
    const service = new KubernetesMigrationRehearsalService({
      createTemporaryDatabase: async () => { throw Object.assign(new Error('create timed out'), { databaseHandle: { name: 'kubenova_preflight_a1b2c3d4', connectionString: 'postgresql://test/db' } }); },
      restoreBackup: async () => undefined,
      runTargetMigrations: async () => undefined,
      checkPreviousVersionCompatibility: async () => undefined,
      dropTemporaryDatabase: async () => { events.push('drop'); throw new Error('cleanup failed'); },
    });

    const result = await service.run({ backupLocation: '/backup.dump', targetVersion: 'v1.9', targetImage: 'target@sha256:abc', previousImage: 'previous@sha256:def' });

    expect(result.status).toBe('failed');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '临时测试库', status: 'failed' }),
      expect.objectContaining({ name: '临时测试库清理', status: 'failed' }),
    ]));
    expect(events).toEqual(['drop']);
  });
});
