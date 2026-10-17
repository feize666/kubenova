import { ForbiddenException } from '@nestjs/common';
jest.mock('@kubernetes/client-node', () => ({}));
import { AiActionApprovalService } from './ai-action-approval.service';

describe('AiActionApprovalService', () => {
  const action = {
    operation: 'restart-workload' as const,
    target: { clusterId: 'cluster-a', namespace: 'apps', kind: 'Deployment', name: 'web' },
  };

  function setup() {
    const records = new Map<string, Record<string, unknown>>();
    const prisma = {
      aiActionApproval: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const record = { id: 'approval-1', createdAt: new Date(), ...data };
          records.set('approval-1', record);
          return record;
        }),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null),
        updateMany: jest.fn(async ({ where, data }: { where: { id: string; status?: string; actorUserId?: string }; data: Record<string, unknown> }) => {
          const record = records.get(where.id);
          if (!record || (where.status && record.status !== where.status) || (where.actorUserId && record.actorUserId !== where.actorUserId)) return { count: 0 };
          Object.assign(record, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const record = records.get(where.id)!;
          Object.assign(record, data);
          return record;
        }),
      },
    };
    const executor = {
      preview: jest.fn(() => ({ status: 'ok', operation: 'restart-workload', targets: [action.target] })),
      execute: jest.fn(async () => ({ status: 'success', requestId: 'request-1', operation: 'restart-workload' })),
    };
    return {
      records,
      prisma,
      executor,
      service: new AiActionApprovalService(prisma as never, executor as never),
    };
  }

  const actor = { userId: 'user-a', username: 'operator', role: 'cluster-operator' as const };

  it('creates an actor-bound, short-lived approval for a mutating action', async () => {
    const { service, prisma } = setup();
    const preview = await service.preview(actor, action);

    expect(preview).toMatchObject({ status: 'ok', approvalId: 'approval-1' });
    expect(prisma.aiActionApproval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: 'user-a',
        clusterId: 'cluster-a',
        action: 'restart-workload',
        status: 'pending',
      }),
    }));
  });

  it('rejects a write without a matching approval and never reaches the executor', async () => {
    const { service, executor } = setup();
    await expect(service.execute(actor, action)).rejects.toBeInstanceOf(ForbiddenException);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('consumes the approval once and rejects replay', async () => {
    const { service, executor } = setup();
    const preview = await service.preview(actor, action);

    await expect(service.execute(actor, action, preview.approvalId)).resolves.toMatchObject({ status: 'success' });
    await expect(service.execute(actor, action, preview.approvalId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed target or a different actor', async () => {
    const { service, executor } = setup();
    const preview = await service.preview(actor, action);
    await expect(service.execute(actor, { ...action, target: { ...action.target, name: 'other' } }, preview.approvalId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.execute({ ...actor, userId: 'user-b' }, action, preview.approvalId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('does not require approval for read-only queries', async () => {
    const { service, executor, prisma } = setup();
    const query = { operation: 'query-pods-overview' as const, target: { clusterId: 'cluster-a', namespace: 'apps' } };
    await expect(service.execute(actor, query)).resolves.toMatchObject({ status: 'success' });
    expect(prisma.aiActionApproval.create).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledWith(actor, query);
  });

  it.each([
    ['expired', -5 * 60_000 - 1],
    ['future-dated', 60_000],
  ])('rejects a %s approval before dispatch', async (_label, offset) => {
    const { service, executor, records } = setup();
    const preview = await service.preview(actor, action);
    records.get(preview.approvalId!)!.createdAt = new Date(Date.now() + offset);
    await expect(service.execute(actor, action, preview.approvalId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('rejects changed operation options even when the resource target is unchanged', async () => {
    const { service, executor } = setup();
    const preview = await service.preview(actor, action);
    const changed = { ...action, options: { namespace: 'other' } };
    await expect(service.execute(actor, changed, preview.approvalId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('dispatches at most once when two requests race for the same approval', async () => {
    const { service, executor } = setup();
    const preview = await service.preview(actor, action);
    const results = await Promise.allSettled([
      service.execute(actor, action, preview.approvalId),
      service.execute(actor, action, preview.approvalId),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
});
