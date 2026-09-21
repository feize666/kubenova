import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('grant revocation transaction', () => {
  function setup(group = false) {
    const tx = {
      accessGrant: { findUnique: jest.fn().mockResolvedValue({ id: 'g', version: 2, userId: group ? null : 'u', groupId: group ? 'team' : null, revokedAt: null }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      groupMembership: { findMany: jest.fn().mockResolvedValue([{ userId: 'u' }, { userId: 'v' }]) },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      authorizationChange: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn(async (fn) => fn(tx)) };
    const service = new UsersService(prisma as never);
    const revoke = (actor: unknown = { id: 'admin', role: 'admin' }) => (service as any).revokeAccessGrant(actor, 'g');
    return { tx, prisma, revoke };
  }
  it('denies non-administrators before a transaction', async () => {
    const { revoke, prisma } = setup();
    await expect(revoke({ id: 'u', role: 'operator' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('revokes and invalidates the user authorization version in one transaction', async () => {
    const { revoke, tx } = setup();
    await expect(revoke()).resolves.toEqual({ id: 'g', revoked: true });
    expect(tx.accessGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'g', version: 2, revokedAt: null }, data: expect.objectContaining({ state: 'revoked', version: { increment: 1 } }) }));
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['u'] } }, data: { authzVersion: { increment: 1 } } });
    expect(tx.authorizationChange.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: 'admin', grantId: 'g', version: 3 }) });
  });
  it('invalidates all group members', async () => {
    const { revoke, tx } = setup(true);
    await revoke();
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['u', 'v'] } }, data: { authzVersion: { increment: 1 } } });
  });
  it('does not repeat side effects for an already revoked grant', async () => {
    const { revoke, tx } = setup();
    tx.accessGrant.findUnique.mockResolvedValue({ id: 'g', revokedAt: new Date() } as never);
    await revoke();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
  it('returns not found for an unknown grant', async () => {
    const { revoke, tx } = setup();
    tx.accessGrant.findUnique.mockResolvedValue(null);
    await expect(revoke()).rejects.toBeInstanceOf(NotFoundException);
  });
  it('does not invalidate sessions or append audit after losing a concurrent update', async () => {
    const { revoke, tx } = setup();
    tx.accessGrant.updateMany.mockResolvedValue({ count: 0 });
    await expect(revoke()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.authorizationChange.create).not.toHaveBeenCalled();
  });
});
