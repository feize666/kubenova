import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('create scoped access grant', () => {
  const input = { userId: 'u', clusterId: 'c', role: 'viewer', namespaces: ['default'], capabilities: ['logs'] };
  function setup() {
    const tx = {
      clusterRegistry: { findUnique: jest.fn().mockResolvedValue({ id: 'c', deletedAt: null }) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u', isActive: true }), updateMany: jest.fn() },
      identityGroup: { findUnique: jest.fn() },
      groupMembership: { findMany: jest.fn().mockResolvedValue([]) },
      accessGrant: { create: jest.fn().mockResolvedValue({ id: 'g', version: 1 }) },
      authorizationChange: { create: jest.fn() },
    };
    const resolve = jest.fn().mockResolvedValue('live-uid');
    const prisma = { $transaction: jest.fn(async fn => fn(tx)) };
    const service = new (UsersService as any)(prisma, { resolve });
    const create = (body: unknown, actor: unknown = { id: 'a', role: 'admin' }) => service.createAccessGrant(actor, body);
    return { create, resolve, tx, prisma };
  }
  it('denies operators before looking up namespaces', async () => {
    const { create, resolve } = setup();
    await expect(create(input, { id: 'u', role: 'operator' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, groupId: 'team' }, { ...input, userId: undefined },
    { ...input, namespaces: [] }, { ...input, role: 'admin' },
    { ...input, capabilities: ['unknown'] }, { ...input, expiresAt: 'invalid' },
    { ...input, expiresAt: '2000-01-01T00:00:00Z' },
  ])('rejects invalid scope or lifetime %#', async body => {
    const { create, prisma } = setup();
    await expect(create(body)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('persists server-resolved UIDs with audit and session invalidation', async () => {
    const { create, tx, resolve } = setup();
    await expect(create(input)).resolves.toEqual({ id: 'g', version: 1 });
    expect(resolve).toHaveBeenCalledWith('c', 'default');
    expect(tx.accessGrant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u', clusterId: 'c', namespaces: { create: [{ namespaceName: 'default', namespaceUid: 'live-uid' }] } }), select: { id: true, version: true } });
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['u'] } }, data: { authzVersion: { increment: 1 } } });
    expect(tx.authorizationChange.create).toHaveBeenCalledWith({ data: expect.objectContaining({ grantId: 'g', actorUserId: 'a', reason: 'grant-created' }) });
  });
  it('does not write anything when namespace identity cannot be verified', async () => {
    const { create, resolve, prisma } = setup();
    resolve.mockRejectedValue(new ForbiddenException());
    await expect(create(input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects disabled users before grant creation', async () => {
    const { create, tx } = setup();
    tx.user.findUnique.mockResolvedValue({ id: 'u', isActive: false });
    await expect(create(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.accessGrant.create).not.toHaveBeenCalled();
    expect(tx.authorizationChange.create).not.toHaveBeenCalled();
  });
  it('rejects inactive groups', async () => {
    const { create, tx } = setup();
    tx.identityGroup.findUnique.mockResolvedValue({ active: false });
    await expect(create({ ...input, userId: undefined, groupId: 'team' })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.accessGrant.create).not.toHaveBeenCalled();
  });
  it.each([null, { id: 'c', deletedAt: new Date() }])('rejects unavailable clusters even with cached namespace identity', async cluster => {
    const { create, tx } = setup();
    tx.clusterRegistry.findUnique.mockResolvedValue(cluster);
    await expect(create(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.accessGrant.create).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.authorizationChange.create).not.toHaveBeenCalled();
  });
});
