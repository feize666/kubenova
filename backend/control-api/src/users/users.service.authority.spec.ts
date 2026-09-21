import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { UsersService } from './users.service';
import { ConfigService } from '@nestjs/config';

describe('user administration authority', () => {
  it.each(['user', 'cluster-admin', 'operator', undefined])('denies account directory reads to %s', async role => {
    const { service } = setup();
    await expect(service.listUsers({}, { role } as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findById('target', { role } as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
  const row = {
    id: 'target',
    email: 'target@example.test',
    name: 'Target',
    role: 'user',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  function setup(superadminUserId?: string) {
    const writes: unknown[] = [];
    const prisma = {
      user: {
        findUnique: jest.fn(async () => null),
        findFirst: jest.fn(async () => row),
        create: jest.fn(async ({ data }) => {
          writes.push(data);
          return { ...row, ...data };
        }),
        update: jest.fn(async ({ data }) => {
          writes.push(data);
          return { ...row, ...data };
        }),
        delete: jest.fn(async () => {
          writes.push('delete');
          return row;
        }),
      },
    };
    const service = new UsersService(prisma as never, undefined, new ConfigService({ superadminUserId }));
    return { service, prisma, writes };
  }
  it.each([
    'user',
    'read-only',
    'cluster-operator',
    'operator',
    'cluster-admin',
    'unknown',
    undefined,
  ])('denies every administrative mutation to %s', async (role) => {
    const { service, writes } = setup();
    const actor = { id: 'caller', role } as never;
    const calls = [
      () => service.createUser(actor, { username: 'u', password: 'password' }),
      () => service.updateUser(actor, 'target', { role: 'platform-admin' }),
      () => service.deleteUser(actor, 'target'),
      () => service.setState(actor, 'target', false),
      () => service.createRbac(actor, {} as never),
      () => service.updateRbac(actor, 'binding', {}),
      () => service.deleteRbac(actor, 'binding'),
      () => service.setRbacState(actor, 'binding', 'disabled'),
    ];
    for (const call of calls)
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
  });
  it.each(['admin', 'platform-admin'])(
    'allows administrator %s to create default read-only users',
    async (role) => {
      const { service } = setup();
      const result = await service.createUser({ role } as never, {
        username: 'u',
        password: 'password',
      });
      expect(result.role).toBe('user');
      expect(result.username).toBe('u');
    },
  );
  it.each(['admin', 'platform-admin'])('rejects privilege assignment during account creation: %s', async (role) => {
    const { service, writes } = setup();
    await expect(service.createUser({ role: 'platform-admin' }, {
      username: 'new-user', password: 'password', role,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toEqual([]);
  });
  it.each(['invented-admin', 'cluster-admin', {}, ['platform-admin']])(
    'rejects unsupported role assignments %j',
    async (role) => {
      const { service, prisma, writes } = setup();
      await expect(
        service.createUser({ role: 'platform-admin' }, {
          username: 'u',
          password: 'password',
          role,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      prisma.user.findUnique.mockResolvedValue(row as never);
      await expect(
        service.updateUser({ role: 'platform-admin' }, 'target', {
          role,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(writes).toEqual([]);
    },
  );
  it.each(['admin', 'platform-admin', 'user'])('rejects role %s through ordinary profile editing without any writes', async role => {
    const { service, prisma, writes } = setup();
    prisma.user.findUnique.mockResolvedValue(row as never);
    await expect(service.updateUser({ role: 'admin' }, 'target', { role, name: 'Changed' })).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toEqual([]);
  });
  it('protects the last active platform administrator', async () => {
    const { service, prisma, writes } = setup();
    prisma.user.findUnique.mockResolvedValue({ ...row, role: 'admin', isActive: true } as never);
    (prisma.user as any).count = jest.fn().mockResolvedValue(1);
    await expect(service.setState({ role: 'platform-admin' }, 'target', false)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteUser({ role: 'platform-admin' }, 'target')).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toEqual([]);
  });
  it('allows rotating the last administrator password without demoting the account', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ ...row, role: 'admin', isActive: true } as never);
    (prisma.user as any).count = jest.fn().mockResolvedValue(1);
    await expect(service.updateUser({ role: 'admin' }, 'target', { password: 'new-test-password' })).resolves.toMatchObject({ id: 'target' });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ passwordHash: expect.any(String), authzVersion: { increment: 1 } }) }));
  });
  it.each(['delete', 'disable', 'legacy-disable'])('prevents designated administrator self-lockout through %s even with another administrator', async operation => {
    const { service, prisma, writes } = setup('target');
    const actor = { id: 'target', role: 'platform-admin' as const };
    prisma.user.findUnique.mockResolvedValue({ ...row, role: 'admin' } as never);
    (prisma.user as any).count = jest.fn().mockResolvedValue(2);
    const result = operation === 'delete' ? service.deleteUser(actor, 'target')
      : operation === 'disable' ? service.setState(actor, 'target', false)
      : service.setUserState(actor, 'target', 'disabled');
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toThrow(/transfer.*deployment designation/i);
    expect(writes).toEqual([]);
  });
  it('allows disabling and deleting unrelated administrators when another remains', async () => {
    const { service, prisma, writes } = setup('designated');
    const actor = { id: 'other-admin', role: 'platform-admin' as const };
    prisma.user.findUnique.mockResolvedValue({ ...row, role: 'admin' } as never);
    (prisma.user as any).count = jest.fn().mockResolvedValue(2);
    await expect(service.setState(actor, 'target', false)).resolves.toMatchObject({ isActive: false });
    await expect(service.deleteUser(actor, 'target')).resolves.toMatchObject({ deleted: true });
    expect(writes).toEqual([{ isActive: false, authzVersion: { increment: 1 } }, 'delete']);
  });
  it('rejects MFA policy writes until enrollment and login verification are available', async () => {
    const { service, prisma } = setup('designated');
    prisma.user.findUnique.mockResolvedValue({ ...row, id: 'designated', role: 'admin' } as never);
    await expect(service.setMfaEnabled({ role: 'user' } as never, 'target', true)).rejects.toBeInstanceOf(ForbiddenException);
    for (const enabled of [true, false]) {
      await expect(service.setMfaEnabled({ id: 'designated', role: 'platform-admin' }, 'target', enabled)).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, 'designated', true, 'admin'],
    ['designated', 'other-admin', true, 'admin'],
    ['designated', undefined, true, 'admin'],
    ['designated', 'designated', false, 'admin'],
    ['designated', 'designated', true, 'user'],
    ['designated', 'designated', true, 'cluster-admin'],
  ])('denies MFA without an explicit active administrator identity (%p, %p, %p, %p)', async (designation, id, isActive, role) => {
    const { service, prisma, writes } = setup(designation);
    prisma.user.findUnique.mockResolvedValue({ ...row, id, isActive, role } as never);
    await expect(service.setMfaEnabled({ id, username: 'admin', role: 'platform-admin' }, 'target', false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
  });
  it('denies a deleted designated administrator', async () => {
    const { service } = setup('designated');
    await expect(service.setMfaEnabled({ id: 'designated', role: 'platform-admin' }, 'target', false)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['admin', 'platform-admin'])('accepts fresh designated role %s but keeps MFA unavailable', async role => {
    const { service, prisma, writes } = setup('designated');
    prisma.user.findUnique.mockResolvedValue({ ...row, id: 'designated', role } as never);
    await expect(service.setMfaEnabled({ id: 'designated', role: 'platform-admin' }, 'target', false)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'designated' }, select: { isActive: true, role: true } });
    expect(writes).toEqual([]);
  });
  it.each(['other-admin', 'designated'])('protects every designated-account mutation from ineligible actor %s', async id => {
    const { service, prisma, writes } = setup('designated');
    prisma.user.findUnique.mockResolvedValue({ ...row, id: 'designated', role: 'user' } as never);
    const actor = { id, username: 'admin', role: 'platform-admin' as const };
    const calls = [
      () => service.updateUser(actor, 'designated', { password: 'password' }),
      () => service.updateUser(actor, 'designated', { username: 'replacement' }),
      () => service.updateUser(actor, 'designated', { name: 'replacement' }),
      () => service.deleteUser(actor, 'designated'),
      () => service.setState(actor, 'designated', true),
      () => service.setState(actor, 'designated', false),
      () => service.setUserState(actor, 'designated', 'disabled'),
      () => service.bindExternalIdentity(actor, 'designated', { issuer: 'https://id.example.test', subject: 'attacker' }),
      () => service.unbindExternalIdentity(actor, 'designated', 'identity'),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
    if (id === 'other-admin') expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('leaves unrelated profile administration available', async () => {
    const { service, prisma } = setup('designated');
    prisma.user.findUnique.mockResolvedValue(row as never);
    await expect(service.updateUser({ id: 'other-admin', role: 'platform-admin' }, 'target', { name: 'Changed' })).resolves.toMatchObject({ name: 'Changed' });
  });
  it('allows the active designated administrator to edit its own profile', async () => {
    const { service, prisma } = setup('target');
    prisma.user.findUnique.mockResolvedValue({ ...row, role: 'admin' } as never);
    await expect(service.updateUser({ id: 'target', role: 'platform-admin' }, 'target', { name: 'Changed' })).resolves.toMatchObject({ name: 'Changed' });
  });
});
