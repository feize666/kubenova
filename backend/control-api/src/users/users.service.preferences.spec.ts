import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService table preferences', () => {
  const actor = {
    id: 'user-1',
    username: 'tester',
    role: 'platform-admin' as const,
  };

  function createService(existing?: { value: unknown; updatedAt: Date }) {
    const prisma = {
      userPreference: {
        findUnique: jest.fn(async () =>
          existing
            ? {
                id: 'pref-1',
                userId: 'user-1',
                key: 'table:workloads',
                value: existing.value,
                updatedAt: existing.updatedAt,
              }
            : null,
        ),
        upsert: jest.fn(
          async ({
            create,
            update,
          }: {
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          }) => ({
            id: 'pref-1',
            userId: String(create.userId),
            key: String(create.key),
            value: update.value,
            updatedAt: new Date('2026-05-24T12:00:00.000Z'),
          }),
        ),
      },
    };

    return {
      service: new UsersService(prisma as never),
      prisma,
    };
  }

  it('returns null value when current user has no saved preference', async () => {
    const { service, prisma } = createService();

    await expect(
      service.getTablePreference(actor, 'workloads'),
    ).resolves.toEqual({
      tableKey: 'workloads',
      value: null,
      updatedAt: null,
    });
    expect(prisma.userPreference.findUnique).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'user-1', key: 'table:workloads' } },
    });
  });

  it('upserts preference using current user and table key', async () => {
    const { service, prisma } = createService();

    await expect(
      service.saveTablePreference(actor, 'workloads', {
        value: { columns: ['name', 'status'], filtersExpanded: true },
      }),
    ).resolves.toEqual({
      tableKey: 'workloads',
      value: { columns: ['name', 'status'], filtersExpanded: true },
      updatedAt: '2026-05-24T12:00:00.000Z',
    });
    expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'user-1', key: 'table:workloads' } },
      create: {
        userId: 'user-1',
        key: 'table:workloads',
        value: { columns: ['name', 'status'], filtersExpanded: true },
      },
      update: {
        value: { columns: ['name', 'status'], filtersExpanded: true },
      },
    });
  });

  it('rejects missing actor user id', async () => {
    const { service } = createService();

    await expect(
      service.saveTablePreference({ username: 'tester' }, 'workloads', {
        value: {},
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects empty value body', async () => {
    const { service } = createService();

    await expect(
      service.saveTablePreference(actor, 'workloads', {}),
    ).rejects.toThrow(BadRequestException);
  });
});
