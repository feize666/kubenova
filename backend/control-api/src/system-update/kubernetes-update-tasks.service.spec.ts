import { KubernetesUpdateTasksService } from './kubernetes-update-tasks.service';

type Row = {
  id: string;
  action: string;
  payload: unknown;
  signature: string;
  status: string;
  phase: string;
  percent: number | null;
  message: string | null;
  claimedBy: string | null;
  leaseUntil: Date | null;
  attempt: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  backupLocation: string | null;
  backupBytes: string | null;
  result: unknown;
  resultSignature: string | null;
  activeSlot: string | null;
};

function fakeDb() {
  const rows = new Map<string, Row>();
  let nextId = 0;
  return {
    rows,
    kubernetesUpdateTask: {
      create: jest.fn(async ({ data }: { data: Omit<Row, 'id' | 'createdAt' | 'startedAt' | 'completedAt' | 'attempt'> }) => {
        if (data.activeSlot && [...rows.values()].some((row) => row.activeSlot === data.activeSlot)) throw Object.assign(new Error('unique active slot'), { code: 'P2002' });
        const row: Row = { ...data, id: `task-${++nextId}`, createdAt: new Date(0), startedAt: null, completedAt: null, attempt: 0, backupLocation: null, backupBytes: null, result: null, resultSignature: null, activeSlot: data.activeSlot ?? null };
        rows.set(row.id, row);
        return structuredClone(row);
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => structuredClone(rows.get(where.id) ?? null)),
      findMany: jest.fn(async ({ take }: { take: number }) => [...rows.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take).map((row) => structuredClone(row))),
      findFirst: jest.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy: { createdAt: 'asc' | 'desc' } }) => {
        const candidates = [...rows.values()].filter((row) => {
          if (where.action && typeof where.action === 'object' && 'in' in where.action) {
            if (!(where.action as { in: string[] }).in.includes(row.action)) return false;
          } else if (where.action && row.action !== where.action) return false;
          if (Array.isArray(where.OR)) return row.status === 'queued' || (row.status === 'running' && !!row.leaseUntil && row.leaseUntil < new Date());
          return true;
        }).sort((a, b) => orderBy.createdAt === 'asc' ? a.createdAt.getTime() - b.createdAt.getTime() : b.createdAt.getTime() - a.createdAt.getTime());
        return candidates[0] ?? null;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = rows.get(String(where.id));
        if (!row || (where.status && row.status !== where.status) || (where.claimedBy && row.claimedBy !== where.claimedBy)) return { count: 0 };
        if (where.OR && row.status === 'running' && row.leaseUntil && row.leaseUntil >= new Date()) return { count: 0 };
        if (where.leaseUntil && typeof where.leaseUntil === 'object') {
          const filter = where.leaseUntil as { gt?: Date; lt?: Date };
          if (!row.leaseUntil || (filter.gt && row.leaseUntil <= filter.gt) || (filter.lt && row.leaseUntil >= filter.lt)) return { count: 0 };
        }
        const { attempt, ...fields } = data;
        Object.assign(row, fields);
        if (attempt && typeof attempt === 'object' && 'increment' in attempt) row.attempt += Number((attempt as { increment: number }).increment);
        return { count: 1 };
      }),
    },
  };
}

const futurePreflightExpiry = () => new Date(Date.now() + 60 * 60_000).toISOString();

const payload = {
  action: 'install' as const,
  targetVersion: 'v1.9',
  preflightId: 'preflight-1',
  preflightExpiresAt: futurePreflightExpiry(),
  backupTargetId: 'local-backup',
  settingsFingerprint: 'f'.repeat(64),
  images: {
    frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'a'.repeat(64)}`,
    controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'b'.repeat(64)}`,
    runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'c'.repeat(64)}`,
  },
  operator: 'root-admin',
};

describe('Kubernetes durable update task queue', () => {
  const originalKey = process.env.KUBENOVA_K8S_UPDATE_TASK_KEY;
  beforeEach(() => { process.env.KUBENOVA_K8S_UPDATE_TASK_KEY = '0123456789abcdef'.repeat(4); });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.KUBENOVA_K8S_UPDATE_TASK_KEY;
    else process.env.KUBENOVA_K8S_UPDATE_TASK_KEY = originalKey;
  });

  it('persists signed task inputs and returns a durable public task record', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const created = await service.submit(payload);

    expect(created).toMatchObject({ id: 'task-1', status: 'queued', phase: 'queued', payload });
    expect(created).not.toHaveProperty('signature');
    expect(db.rows.get('task-1')?.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(db.kubernetesUpdateTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'queued', payload }),
    }));
  });

  it('allows only one active update task at a time and releases the slot after completion', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const first = await service.submit(payload);

    await expect(service.submit({ ...payload, preflightId: 'another-task' })).rejects.toThrow(/已有 Kubernetes 更新或预检任务正在执行/);
    await service.claimNext('controller-a');
    await service.finish(first.id, 'controller-a', 'succeeded', 'completed', 100, 'done');
    await expect(service.submit({ ...payload, preflightId: 'after-completion' })).resolves.toMatchObject({ status: 'queued' });
  });

  it('persists a separate preflight action with its migration target and returns its durable result after completion', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const task = await service.submit({ ...payload, action: 'preflight', preflightId: 'preflight-async', migrationTargetId: 'migration-target', settingsFingerprint: 'a'.repeat(64), preflightChecks: [{ name: '发布资产', status: 'passed', message: '完整' }] });
    await service.claimNext('controller-a');
    const result = { checks: [{ name: '临时测试库清理', status: 'passed' as const, message: '已删除' }] };
    await service.finish(task.id, 'controller-a', 'succeeded', 'completed', 100, '预检通过', result);

    await expect(service.getLatestPreflight()).resolves.toMatchObject({
      id: task.id, status: 'succeeded', action: 'preflight', result,
      payload: expect.objectContaining({ action: 'preflight', migrationTargetId: 'migration-target' }),
    });
    expect(db.kubernetesUpdateTask.findFirst).toHaveBeenCalledWith({ where: { action: 'preflight' }, orderBy: { createdAt: 'desc' } });
  });

  it('invalidates a previously passed rehearsal when a newer preflight cannot be queued', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const previous = await service.submit({ ...payload, action: 'preflight', migrationTargetId: 'migration-target', settingsFingerprint: 'a'.repeat(64), preflightChecks: [{ name: 'release', status: 'passed', message: 'valid' }] });
    await service.claimNext('controller-a');
    await service.finish(previous.id, 'controller-a', 'succeeded', 'completed', 100, 'passed', { checks: [{ name: 'migration', status: 'passed', message: 'ok' }] });

    await service.invalidateLatestPreflight([{ name: 'release', status: 'failed', message: 'missing' }], 'new rehearsal failed');

    await expect(service.getLatestPreflight()).resolves.toMatchObject({ status: 'failed', phase: 'failed', message: 'new rehearsal failed', result: { checks: [{ status: 'failed' }] } });
  });

  it('persists the prior release version and immutable images as a rollback record', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const submitted = await service.submit({ ...payload, previousVersion: 'v1.8' });
    await service.claimNext('controller-a');
    const result = {
      previousVersion: 'v1.8',
      previousImages: {
        frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'d'.repeat(64)}`,
        controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'e'.repeat(64)}`,
        runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'f'.repeat(64)}`,
      },
    };
    await service.finish(submitted.id, 'controller-a', 'succeeded', 'completed', 100, 'installed', result);

    await expect(service.getLatest()).resolves.toMatchObject({ result, payload: expect.objectContaining({ previousVersion: 'v1.8' }) });
    expect(db.rows.get(submitted.id)?.resultSignature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a modified persisted rollback result even when the signed task payload is intact', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const submitted = await service.submit({ ...payload, previousVersion: 'v1.8' });
    await service.claimNext('controller-a');
    await service.finish(submitted.id, 'controller-a', 'succeeded', 'completed', 100, 'installed', {
      previousVersion: 'v1.8', previousImages: {
        frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'d'.repeat(64)}`,
        controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'e'.repeat(64)}`,
        runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'f'.repeat(64)}`,
      },
    });
    db.rows.get(submitted.id)!.result = { previousVersion: 'v0.1', previousImages: {} };

    await expect(service.getLatest()).rejects.toThrow(/result signature/);
  });

  it('returns the newest persisted task for status recovery after API process restart', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const created = await service.submit(payload);

    await expect(service.getLatest()).resolves.toMatchObject({ id: created.id, status: 'queued', payload });
    expect(db.kubernetesUpdateTask.findFirst).toHaveBeenCalledWith({ where: { action: { in: ['install', 'rollback'] } }, orderBy: { createdAt: 'desc' } });
  });

  it('lists bounded recent task records newest-first for durable audit history', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const first = await service.submit(payload);
    await service.claimNext('controller-a');
    await service.finish(first.id, 'controller-a', 'succeeded', 'completed', 100, 'done');
    const second = await service.submit({ ...payload, preflightId: 'preflight-2' });

    await expect(service.listRecent(10)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id }), expect.objectContaining({ id: second.id }),
    ]));
    expect(db.kubernetesUpdateTask.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 10 });
  });

  it('does not expose tampered persisted task payloads through status recovery or history', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const created = await service.submit(payload);
    db.rows.get(created.id)!.payload = { ...payload, operator: 'forged-operator' };

    await expect(service.getLatest()).rejects.toThrow(/signature/);
    await expect(service.listRecent()).rejects.toThrow(/signature/);
  });

  it('atomically claims the oldest queued task and exposes it to the independent controller', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const submitted = await service.submit(payload);
    const claimed = await service.claimNext('controller-a');

    expect(claimed).toMatchObject({ id: submitted.id, status: 'running', phase: 'initializing', attempt: 1, payload });
    expect(db.rows.get(submitted.id)?.claimedBy).toBe('controller-a');
    expect(db.rows.get(submitted.id)?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('reclaims a task after its worker lease expires so controller restarts do not strand updates', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const submitted = await service.submit(payload);
    await service.claimNext('controller-a');
    db.rows.get(submitted.id)!.leaseUntil = new Date(Date.now() - 1);

    const reclaimed = await service.claimNext('controller-b');

    expect(reclaimed).toMatchObject({ id: submitted.id, status: 'running', attempt: 2, payload });
    expect(db.rows.get(submitted.id)?.claimedBy).toBe('controller-b');
  });

  it('rejects task progress or completion from a worker that does not own the lease', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const submitted = await service.submit(payload);
    await service.claimNext('controller-a');

    await expect(service.heartbeat(submitted.id, 'controller-b', 'updating', 20, 'progress')).rejects.toThrow(/lease/);
    await expect(service.finish(submitted.id, 'controller-b', 'succeeded', 'completed', 100, 'done')).rejects.toThrow(/lease/);
    expect(db.rows.get(submitted.id)).toMatchObject({ status: 'running', phase: 'initializing', percent: 0 });
  });

  it('stores the verified backup reference only for the current lease owner', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const submitted = await service.submit(payload);
    await service.claimNext('controller-a');

    await expect(service.recordBackup(submitted.id, 'controller-a', 's3://bucket/prefix/backup.dump', 1234)).resolves.toBeUndefined();
    await expect(service.get(submitted.id)).resolves.toMatchObject({ backupLocation: 's3://bucket/prefix/backup.dump', backupBytes: '1234' });
    await expect(service.recordBackup(submitted.id, 'controller-b', '/backup.dump', 1)).rejects.toThrow(/lease/);
  });

  it('rejects writes from the former worker after its lease has expired', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const submitted = await service.submit(payload);
    await service.claimNext('controller-a');
    db.rows.get(submitted.id)!.leaseUntil = new Date(Date.now() - 1);

    await expect(service.heartbeat(submitted.id, 'controller-a', 'updating', 20, 'stale update')).rejects.toThrow(/lease/);
    await expect(service.finish(submitted.id, 'controller-a', 'succeeded', 'completed', 100, 'stale completion')).rejects.toThrow(/lease/);
    expect(db.rows.get(submitted.id)?.status).toBe('running');
  });

  it('marks a persisted task failed instead of running it if its signed payload was modified', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const submitted = await service.submit(payload);
    db.rows.get(submitted.id)!.payload = { ...payload, targetVersion: 'v99.0' };

    await expect(service.claimNext('controller-a')).resolves.toBeNull();
    expect(db.rows.get(submitted.id)).toMatchObject({ status: 'failed', phase: 'rejected', message: expect.stringContaining('signature') });
  });

  it('rejects mutable image tags before persisting a task', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);

    await expect(service.submit({ ...payload, images: { ...payload.images, frontend: 'ghcr.io/feize666/kubenova-frontend:latest' } }))
      .rejects.toThrow(/immutable/);
    expect(db.kubernetesUpdateTask.create).not.toHaveBeenCalled();
  });

  it('rejects expired preflight bindings and missing task-signing secrets before enqueueing', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    await expect(service.submit({ ...payload, preflightExpiresAt: '2020-01-01T00:00:00.000Z' })).rejects.toThrow(/expiry/);
    delete process.env.KUBENOVA_K8S_UPDATE_TASK_KEY;
    await expect(service.submit(payload)).rejects.toThrow(/KUBENOVA_K8S_UPDATE_TASK_KEY/);
    expect(db.kubernetesUpdateTask.create).not.toHaveBeenCalled();
  });

  it('does not mutate queued tasks when the worker signing secret is missing', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    await service.submit(payload);
    delete process.env.KUBENOVA_K8S_UPDATE_TASK_KEY;

    await expect(service.claimNext('controller-a')).rejects.toThrow(/KUBENOVA_K8S_UPDATE_TASK_KEY/);
    expect([...db.rows.values()][0]).toMatchObject({ status: 'queued', phase: 'queued' });
  });

  it('rejects terminal status and phase combinations that contradict each other', async () => {
    const db = fakeDb();
    const service = new KubernetesUpdateTasksService(db as never);
    const submitted = await service.submit(payload);
    await service.claimNext('controller-a');

    await expect(service.finish(submitted.id, 'controller-a', 'succeeded', 'failed', 100, 'contradictory'))
      .rejects.toThrow(/phase/);
    await expect(service.finish(submitted.id, 'controller-a', 'failed', 'completed', 100, 'contradictory'))
      .rejects.toThrow(/phase/);
    expect(db.rows.get(submitted.id)?.status).toBe('running');
  });
});
