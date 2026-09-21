import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AlertReceiverService } from './alert-receiver.service';

function setup() {
  let stored: any = null;
  const db = {
    auditLog: { create: jest.fn(async ({ data }) => data) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    clusterRegistry: { findFirst: jest.fn(async ({ where }) => where.id === 'a' ? { id: 'a' } : null) },
    alertReceiverCredential: {
      upsert: jest.fn(async ({ create, update }) => { stored = { ...(stored ? { ...stored, ...update } : create), updatedAt: new Date() }; return stored; }),
      findUnique: jest.fn(async ({ where }) => stored?.clusterId === where.clusterId ? stored : null),
      updateMany: jest.fn(async () => { if (stored) stored.enabled = false; return { count: stored ? 1 : 0 }; }),
    },
  };
  return { db, service: new AlertReceiverService(db as never), stored: () => stored };
}
describe('cluster alert receiver credentials', () => {
  it('records actor, cluster and action without secrets', async () => {
    const { service, db } = setup();
    const result = await service.rotate({ id: 'admin-id', role: 'admin' }, 'a');
    await service.disable({ id: 'admin-id', role: 'admin' }, 'a');
    expect(db.auditLog.create.mock.calls.map(([arg]) => arg.data)).toEqual([
      { actorUserId: 'admin-id', clusterId: 'a', action: 'rotate', resourceType: 'alert-receiver', resourceId: 'a' },
      { actorUserId: 'admin-id', clusterId: 'a', action: 'disable', resourceType: 'alert-receiver', resourceId: 'a' },
    ]);
    expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain(result.token);
  });
  it('stores only a hash and rotation revokes the old credential', async () => {
    const { service, stored } = setup();
    const first = await service.rotate({ role: 'admin' }, 'a');
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(stored())).not.toContain(first.token);
    await expect(service.authenticate('a', `Bearer ${first.token}`)).resolves.toBe('a');
    const second = await service.rotate({ role: 'admin' }, 'a');
    expect(second.token).not.toBe(first.token);
    await expect(service.authenticate('a', `Bearer ${first.token}`)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.authenticate('b', `Bearer ${second.token}`)).rejects.toBeInstanceOf(UnauthorizedException);
    await service.disable({ role: 'admin' }, 'a');
    await expect(service.authenticate('a', `Bearer ${second.token}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects ordinary users before writes', async () => {
    const { service, db } = setup();
    await expect(service.rotate({ role: 'user' }, 'a')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.disable({ role: 'operator' }, 'a')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.alertReceiverCredential.upsert).not.toHaveBeenCalled();
    expect(db.alertReceiverCredential.updateMany).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'Basic abc', 'Bearer short', `Bearer ${'x'.repeat(500)}`])('rejects malformed authorization %s', async header => {
    const { service, db } = setup();
    await expect(service.authenticate('a', header)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.alertReceiverCredential.findUnique).not.toHaveBeenCalled();
  });
  it('rejects a soft-deleted cluster even with a valid receiver token', async () => {
    const { service, db } = setup();
    const { token } = await service.rotate({ role: 'admin' }, 'a');
    db.clusterRegistry.findFirst.mockResolvedValue(null);
    await expect(service.authenticate('a', `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
