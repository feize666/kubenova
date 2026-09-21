import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('local group membership', () => {
  function setup() {
    const tx = {
      identityGroup: { findUnique: jest.fn().mockResolvedValue({ id: 'g', active: true, externalId: null }) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u', isActive: true }), update: jest.fn() },
      groupMembership: { upsert: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      authorizationChange: { create: jest.fn() },
    };
    const transaction = jest.fn(async fn => fn(tx));
    const service = new UsersService({ $transaction: transaction } as never);
    const set = (active = true, role = 'admin') => (service as any).setGroupMembership({ id: 'a', role }, 'g', 'u', active);
    return { tx, transaction, set };
  }
  it('rejects operators before writing', async () => {
    const { set, transaction } = setup();
    await expect(set(true, 'operator')).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('prevents local overrides of externally managed groups', async () => {
    const { set, tx } = setup();
    tx.identityGroup.findUnique.mockResolvedValue({ id: 'g', active: true, externalId: 'keycloak-group' } as never);
    await expect(set()).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.groupMembership.upsert).not.toHaveBeenCalled();
  });
  it('rejects missing groups', async () => {
    const { set, tx } = setup();
    tx.identityGroup.findUnique.mockResolvedValue(null);
    await expect(set()).rejects.toBeInstanceOf(NotFoundException);
  });
  it('adds a member and invalidates cached authorization', async () => {
    const { set, tx } = setup();
    await expect(set()).resolves.toEqual({ groupId: 'g', userId: 'u', active: true });
    expect(tx.groupMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { groupId_userId: { groupId: 'g', userId: 'u' } }, update: expect.objectContaining({ state: 'active', expiresAt: null }) }));
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u' }, data: { authzVersion: { increment: 1 } } });
    expect(tx.authorizationChange.create).toHaveBeenCalledWith({ data: { actorUserId: 'a', affectedUserId: 'u', reason: 'group-member-added:g' } });
  });
  it('removes membership without deleting its history', async () => {
    const { set, tx } = setup();
    await expect(set(false)).resolves.toEqual({ groupId: 'g', userId: 'u', active: false });
    expect(tx.groupMembership.updateMany).toHaveBeenCalledWith({ where: { groupId: 'g', userId: 'u', state: 'active' }, data: { state: 'disabled' } });
    expect(tx.authorizationChange.create).toHaveBeenCalledWith({ data: { actorUserId: 'a', affectedUserId: 'u', reason: 'group-member-removed:g' } });
  });
});
