import { KubernetesUpdateWorker } from './kubernetes-update.worker';
import type { KubernetesUpdateTaskRecord } from './kubernetes-update-tasks.service';

const task: KubernetesUpdateTaskRecord = {
  id: 'task-1',
  action: 'install',
  payload: {
    action: 'install',
    targetVersion: 'v1.9',
    preflightId: 'preflight-1',
    backupTargetId: 'local-backup',
    settingsFingerprint: 'f'.repeat(64),
    preflightExpiresAt: '2026-10-22T01:30:00.000Z',
    operator: 'admin',
    images: {
      frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'a'.repeat(64)}`,
      controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'b'.repeat(64)}`,
      runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'c'.repeat(64)}`,
    },
  },
  status: 'running',
  phase: 'initializing',
  percent: 0,
  message: null,
  attempt: 1,
  createdAt: new Date(0),
  startedAt: new Date(0),
  completedAt: null,
  backupLocation: null,
  backupBytes: null,
  result: null,
};

const preflightTask: KubernetesUpdateTaskRecord = {
  ...task,
  id: 'preflight-task-1',
  action: 'preflight',
  payload: {
    ...task.payload,
    action: 'preflight',
    migrationTargetId: 'local-test-db',
    preflightChecks: [
      { name: '发布资产', status: 'passed', message: '镜像已固定到摘要' },
    ],
  },
};

describe('Kubernetes update worker', () => {
  it('completes a preflight rehearsal and records its checks without applying a rollout', async () => {
    const events: string[] = [];
    let finishResult: KubernetesUpdateTaskRecord['result'] | undefined;
    const tasks = {
      claimNext: jest.fn(async () => preflightTask),
      heartbeat: jest.fn(async () => undefined),
      recordBackup: jest.fn(async () => {
        events.push('backup-recorded');
      }),
      finish: jest.fn(
        async (_id, _worker, status, phase, _percent, _message, result) => {
          events.push(`finish:${status}:${phase}`);
          finishResult = result;
        },
      ),
    };
    const backupTarget = {
      id: 'local-backup',
      name: 'backup',
      type: 'local' as const,
      location: '/backup',
    };
    const backups = {
      createBackup: jest.fn(async () => ({
        location: '/backup/preflight.dump',
        bytes: 100,
        createdAt: new Date().toISOString(),
      })),
      withBackupFile: jest.fn(async (_input, callback) =>
        callback('/tmp/preflight.dump'),
      ),
    };
    const migrationDatabase = {
      createTemporaryDatabase: jest.fn(async () => {
        events.push('create-db');
        return {
          name: 'kubenova_preflight_12345678',
          connectionString: 'postgresql://test/preflight',
        };
      }),
      restoreBackup: jest.fn(async () => {
        events.push('restore-db');
      }),
      dropTemporaryDatabase: jest.fn(async () => {
        events.push('drop-db');
      }),
    };
    const migrationJobs = {
      runTargetMigrations: jest.fn(async (image, connection) => {
        events.push('target-migrations');
        expect(image).toBe(preflightTask.payload.images.controlApi);
        expect(connection).toBe('postgresql://test/preflight');
      }),
      checkPreviousVersionCompatibility: jest.fn(async (connection) => {
        events.push('previous-compatibility');
        expect(connection).toBe('postgresql://test/preflight');
      }),
    };
    const adapter = { apply: jest.fn() };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({
        fingerprint: 'f'.repeat(64),
        backupTargets: [backupTarget],
        migrationTargets: [
          { id: 'local-test-db', name: 'local test', type: 'local' },
        ],
      }),
      'postgresql://user@postgres/db',
      'controller-1',
      migrationDatabase as never,
      migrationJobs as never,
    );

    await expect(worker.runOnce()).resolves.toBe(true);

    expect(backups.withBackupFile).toHaveBeenCalledWith(
      { location: '/backup/preflight.dump', target: backupTarget },
      expect.any(Function),
    );
    expect(migrationDatabase.createTemporaryDatabase).toHaveBeenCalledWith(
      'postgresql://user@postgres/db',
    );
    expect(migrationJobs.runTargetMigrations).toHaveBeenCalledTimes(1);
    expect(
      migrationJobs.checkPreviousVersionCompatibility,
    ).toHaveBeenCalledTimes(1);
    expect(migrationDatabase.dropTemporaryDatabase).toHaveBeenCalledTimes(1);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(
      finishResult?.checks?.map(({ name, status }) => [name, status]),
    ).toEqual(
      expect.arrayContaining([
        ['发布资产', 'passed'],
        ['数据库备份', 'passed'],
        ['目标版本迁移', 'passed'],
        ['旧版本兼容', 'passed'],
        ['临时测试库清理', 'passed'],
      ]),
    );
    expect(events).toEqual([
      'backup-recorded',
      'create-db',
      'restore-db',
      'target-migrations',
      'previous-compatibility',
      'drop-db',
      'finish:succeeded:completed',
    ]);
  });

  it('fails a preflight on target migration error, skips compatibility, cleans the temporary database, and persists checks', async () => {
    let finishStatus: string | undefined;
    let finishPhase: string | undefined;
    let finishResult: KubernetesUpdateTaskRecord['result'] | undefined;
    const tasks = {
      claimNext: jest.fn(async () => preflightTask),
      heartbeat: jest.fn(async () => undefined),
      recordBackup: jest.fn(async () => undefined),
      finish: jest.fn(
        async (id, worker, status, phase, percent, message, result) => {
          finishStatus = status;
          finishPhase = phase;
          finishResult = result;
        },
      ),
    };
    const backups = {
      createBackup: jest.fn(async () => ({
        location: '/backup/preflight.dump',
        bytes: 100,
        createdAt: new Date().toISOString(),
      })),
      withBackupFile: jest.fn(async (_input, callback) =>
        callback('/tmp/preflight.dump'),
      ),
    };
    const migrationDatabase = {
      createTemporaryDatabase: jest.fn(async () => ({
        name: 'kubenova_preflight_12345678',
        connectionString: 'postgresql://test/preflight',
      })),
      restoreBackup: jest.fn(async () => undefined),
      dropTemporaryDatabase: jest.fn(async () => undefined),
    };
    const migrationJobs = {
      runTargetMigrations: jest.fn(async () => {
        throw new Error('migration failed');
      }),
      checkPreviousVersionCompatibility: jest.fn(),
    };
    const adapter = { apply: jest.fn() };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({
        fingerprint: 'f'.repeat(64),
        backupTargets: [
          {
            id: 'local-backup',
            name: 'backup',
            type: 'local',
            location: '/backup',
          },
        ],
        migrationTargets: [
          { id: 'local-test-db', name: 'local test', type: 'local' },
        ],
      }),
      'postgresql://user@postgres/db',
      'controller-1',
      migrationDatabase as never,
      migrationJobs as never,
    );

    await expect(worker.runOnce()).resolves.toBe(true);

    expect(finishStatus).toBe('failed');
    expect(finishPhase).toBe('failed');
    expect(
      finishResult?.checks?.map(({ name, status }) => [name, status]),
    ).toEqual(
      expect.arrayContaining([
        ['目标版本迁移', 'failed'],
        ['旧版本兼容', 'skipped'],
        ['临时测试库清理', 'passed'],
      ]),
    );
    expect(
      migrationJobs.checkPreviousVersionCompatibility,
    ).not.toHaveBeenCalled();
    expect(migrationDatabase.dropTemporaryDatabase).toHaveBeenCalledTimes(1);
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('renews the task lease while the PostgreSQL backup is still running', async () => {
    jest.useFakeTimers();
    let finishBackup!: (value: {
      location: string;
      bytes: number;
      createdAt: string;
    }) => void;
    const backupPending = new Promise<{
      location: string;
      bytes: number;
      createdAt: string;
    }>((resolve) => {
      finishBackup = resolve;
    });
    const tasks = {
      claimNext: jest.fn(async () => task),
      heartbeat: jest.fn(async () => undefined),
      recordBackup: jest.fn(async () => undefined),
      finish: jest.fn(async () => undefined),
    };
    const backups = { createBackup: jest.fn(() => backupPending) };
    const adapter = { apply: jest.fn(async () => undefined) };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({
        fingerprint: 'f'.repeat(64),
        backupTargets: [
          {
            id: 'local-backup',
            name: 'backup',
            type: 'local',
            location: '/var/lib/kubenova/update-backups/local-backup',
          },
        ],
      }),
      'postgresql://user@postgres/db',
      'controller-1',
    );

    try {
      const running = worker.runOnce();
      const initialHeartbeats = tasks.heartbeat.mock.calls.length;
      await jest.advanceTimersByTimeAsync(10_000);
      expect(tasks.heartbeat.mock.calls.length).toBeGreaterThan(
        initialHeartbeats,
      );
      expect(tasks.heartbeat).toHaveBeenCalledWith(
        task.id,
        'controller-1',
        'backing-up',
        8,
        '正在备份 PostgreSQL',
      );
      finishBackup({
        location: '/backup',
        bytes: 100,
        createdAt: new Date().toISOString(),
      });
      await running;
      expect(adapter.apply).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not start a rollout when a lease renewal fails during backup', async () => {
    jest.useFakeTimers();
    let finishBackup!: (value: {
      location: string;
      bytes: number;
      createdAt: string;
    }) => void;
    const backupPending = new Promise<{
      location: string;
      bytes: number;
      createdAt: string;
    }>((resolve) => {
      finishBackup = resolve;
    });
    const tasks = {
      claimNext: jest.fn(async () => task),
      heartbeat: jest.fn(async () => {
        if (tasks.heartbeat.mock.calls.length >= 3)
          throw new Error('worker lease lost');
      }),
      recordBackup: jest.fn(async () => undefined),
      finish: jest.fn(async () => undefined),
    };
    const backups = { createBackup: jest.fn(() => backupPending) };
    const adapter = { apply: jest.fn(async () => undefined) };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({
        fingerprint: 'f'.repeat(64),
        backupTargets: [
          {
            id: 'local-backup',
            name: 'backup',
            type: 'local',
            location: '/var/lib/kubenova/update-backups/local-backup',
          },
        ],
      }),
      'postgresql://user@postgres/db',
      'controller-1',
    );

    try {
      const running = worker.runOnce();
      await jest.advanceTimersByTimeAsync(10_000);
      finishBackup({
        location: '/backup',
        bytes: 100,
        createdAt: new Date().toISOString(),
      });
      await running;
      expect(adapter.apply).not.toHaveBeenCalled();
      expect(tasks.finish).toHaveBeenCalledWith(
        task.id,
        'controller-1',
        'failed',
        'failed',
        null,
        expect.stringMatching(/lease/i),
        undefined,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('renews its lease during ordered rollout progress and records success only after completion', async () => {
    const events: string[] = [];
    const tasks = {
      claimNext: jest.fn(async () => task),
      heartbeat: jest.fn(async (_id, _worker, phase, percent) => {
        events.push(`heartbeat:${phase}:${percent}`);
      }),
      recordBackup: jest.fn(async () => {
        events.push('backup-recorded');
      }),
      finish: jest.fn(async (_id, _worker, status, phase) => {
        events.push(`finish:${status}:${phase}`);
      }),
    };
    const backups = {
      createBackup: jest.fn(async () => ({
        location: '/var/lib/kubenova/update-backups/backup.dump',
        bytes: 1024,
        createdAt: new Date().toISOString(),
      })),
    };
    const adapter = {
      apply: jest.fn(async (_images, onProgress) => {
        await onProgress?.('updating', 35, 'updating control-api');
        events.push('rollout-complete');
      }),
    };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({
        fingerprint: 'f'.repeat(64),
        backupTargets: [
          {
            id: 'local-backup',
            name: 'backup',
            type: 'local',
            location: '/var/lib/kubenova/update-backups/local-backup',
          },
        ],
      }),
      'postgresql://user@postgres/db',
      'controller-1',
    );

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(tasks.claimNext).toHaveBeenCalledWith('controller-1');
    expect(adapter.apply).toHaveBeenCalledWith(
      task.payload.images,
      expect.any(Function),
    );
    expect(events).toEqual([
      'heartbeat:updating:5',
      'heartbeat:backing-up:8',
      'backup-recorded',
      'heartbeat:updating:25',
      'heartbeat:updating:35',
      'rollout-complete',
      'finish:succeeded:completed',
    ]);
  });

  it('persists the prior immutable image set after a successful rollout for an audited rollback', async () => {
    const previousImages = {
      controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'d'.repeat(64)}`,
      runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'e'.repeat(64)}`,
      frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'f'.repeat(64)}`,
    };
    const installTask = {
      ...task,
      payload: { ...task.payload, previousVersion: 'v1.8' },
    };
    const tasks = {
      claimNext: jest.fn(async () => installTask),
      heartbeat: jest.fn(async () => undefined),
      recordBackup: jest.fn(async () => undefined),
      finish: jest.fn(async () => undefined),
    };
    const backups = {
      createBackup: jest.fn(async () => ({
        location: '/backup',
        bytes: 100,
        createdAt: new Date().toISOString(),
      })),
    };
    const adapter = { apply: jest.fn(async () => ({ previousImages })) };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({
        fingerprint: 'f'.repeat(64),
        backupTargets: [
          {
            id: 'local-backup',
            name: 'backup',
            type: 'local',
            location: '/backup',
          },
        ],
      }),
      'postgresql://user@postgres/db',
      'controller-1',
    );

    await worker.runOnce();

    expect(tasks.finish).toHaveBeenCalledWith(
      installTask.id,
      'controller-1',
      'succeeded',
      'completed',
      100,
      expect.stringContaining('已完成滚动更新'),
      { previousImages, previousVersion: 'v1.8' },
    );
  });

  it('records incomplete automatic rollback distinctly and never reports success', async () => {
    const tasks = {
      claimNext: jest.fn(async () => task),
      heartbeat: jest.fn(async () => undefined),
      recordBackup: jest.fn(async () => undefined),
      finish: jest.fn(async () => undefined),
    };
    const adapter = {
      apply: jest.fn(async () => {
        throw new Error(
          'Kubernetes update failed and automatic rollback was incomplete',
        );
      }),
    };
    const backups = {
      createBackup: jest.fn(async () => ({
        location: '/backup',
        bytes: 100,
        createdAt: new Date().toISOString(),
      })),
    };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({
        fingerprint: 'f'.repeat(64),
        backupTargets: [
          {
            id: 'local-backup',
            name: 'backup',
            type: 'local',
            location: '/var/lib/kubenova/update-backups/local-backup',
          },
        ],
      }),
      'postgresql://user@postgres/db',
      'controller-1',
    );

    await worker.runOnce();
    expect(tasks.finish).toHaveBeenCalledWith(
      task.id,
      'controller-1',
      'failed',
      'rollback-incomplete',
      null,
      expect.stringMatching(/rollback was incomplete/),
      undefined,
    );
  });

  it('does not start work when the durable queue is empty', async () => {
    const tasks = {
      claimNext: jest.fn(async () => null),
      heartbeat: jest.fn(),
      recordBackup: jest.fn(),
      finish: jest.fn(),
    };
    const backups = { createBackup: jest.fn() };
    const adapter = { apply: jest.fn() };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({ backupTargets: [] }),
      'postgresql://user@postgres/db',
      'controller-1',
    );

    await expect(worker.runOnce()).resolves.toBe(false);
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('never mutates deployments if the database backup fails', async () => {
    const tasks = {
      claimNext: jest.fn(async () => task),
      heartbeat: jest.fn(async () => undefined),
      recordBackup: jest.fn(),
      finish: jest.fn(async () => undefined),
    };
    const backups = {
      createBackup: jest.fn(async () => {
        throw new Error('backup failed');
      }),
    };
    const adapter = { apply: jest.fn() };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({
        fingerprint: 'f'.repeat(64),
        backupTargets: [
          {
            id: 'local-backup',
            name: 'backup',
            type: 'local',
            location: '/var/lib/kubenova/update-backups/local-backup',
          },
        ],
      }),
      'postgresql://user@postgres/db',
      'controller-1',
    );

    await worker.runOnce();
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(tasks.recordBackup).not.toHaveBeenCalled();
    expect(tasks.finish).toHaveBeenCalledWith(
      task.id,
      'controller-1',
      'failed',
      'failed',
      null,
      'backup failed',
      undefined,
    );
  });

  it('does not back up or change deployments when update settings changed after task submission', async () => {
    const queuedTask = {
      ...task,
      payload: { ...task.payload, settingsFingerprint: 'a'.repeat(64) },
    };
    const tasks = {
      claimNext: jest.fn(async () => queuedTask),
      heartbeat: jest.fn(async () => undefined),
      recordBackup: jest.fn(),
      finish: jest.fn(async () => undefined),
    };
    const backups = { createBackup: jest.fn() };
    const adapter = { apply: jest.fn() };
    const worker = new KubernetesUpdateWorker(
      tasks as never,
      adapter as never,
      backups as never,
      async () => ({
        fingerprint: 'b'.repeat(64),
        backupTargets: [
          {
            id: 'local-backup',
            name: 'backup',
            type: 'local',
            location: '/backup',
          },
        ],
      }),
      'postgresql://user@postgres/db',
      'controller-1',
    );

    await worker.runOnce();

    expect(backups.createBackup).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(tasks.finish).toHaveBeenCalledWith(
      queuedTask.id,
      'controller-1',
      'failed',
      'failed',
      null,
      expect.stringContaining('任务排队后已变化'),
      undefined,
    );
  });
});
