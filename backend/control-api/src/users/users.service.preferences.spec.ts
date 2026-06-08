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

  it('falls back to null preference when preference table is unavailable', async () => {
    const prisma = {
      userPreference: {
        findUnique: jest.fn(async () => {
          const error = new Error(
            'The table `public.UserPreference` does not exist',
          );
          Object.assign(error, { code: 'P2021' });
          throw error;
        }),
        upsert: jest.fn(),
      },
    };
    const service = new UsersService(prisma as never);

    await expect(
      service.getTablePreference(actor, 'workloads'),
    ).resolves.toEqual({
      tableKey: 'workloads',
      value: null,
      updatedAt: null,
    });
  });

  it('accepts writes without failing when preference table is unavailable', async () => {
    const prisma = {
      userPreference: {
        findUnique: jest.fn(),
        upsert: jest.fn(async () => {
          const error = new Error(
            'The table `public.UserPreference` does not exist',
          );
          Object.assign(error, { code: 'P2021' });
          throw error;
        }),
      },
    };
    const service = new UsersService(prisma as never);

    await expect(
      service.saveTablePreference(actor, 'workloads', {
        value: { columnVisibility: { name: true } },
      }),
    ).resolves.toEqual({
      tableKey: 'workloads',
      value: { columnVisibility: { name: true } },
      updatedAt: expect.any(String),
    });
  });

  it('falls back when Prisma client has no preference delegate', async () => {
    const service = new UsersService({} as never);

    await expect(
      service.getTablePreference(actor, 'workloads'),
    ).resolves.toEqual({
      tableKey: 'workloads',
      value: null,
      updatedAt: null,
    });

    await expect(
      service.saveTablePreference(actor, 'workloads', {
        value: { filterRowVisible: true },
      }),
    ).resolves.toEqual({
      tableKey: 'workloads',
      value: { filterRowVisible: true },
      updatedAt: expect.any(String),
    });
  });
});
