import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('user administration authority', () => {
  const row = {
    id: 'target',
    email: 'target@example.test',
    name: 'Target',
    role: 'user',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  function setup() {
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
    return { service: new UsersService(prisma as never), prisma, writes };
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
});
