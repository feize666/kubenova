import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService RBAC subject contract', () => {
  const actor = { username: 'tester', role: 'platform-admin' as const };

  function createService(options?: {
    createError?: Error & { code?: string; clientVersion?: string };
  }): UsersService {
    let seq = 0;
    const prisma = {
      rbacBinding: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (options?.createError) {
            throw options.createError;
          }
          seq += 1;
          return {
            id: `rbac-${seq}`,
            name: String(data.name),
            kind: String(data.kind),
            namespace: String(data.namespace ?? ''),
            subject: String(data.subject),
            subjectKind: String(data.subjectKind),
            subjectNamespace: String(data.subjectNamespace ?? ''),
            state: String(data.state ?? 'active'),
            version: 1,
            updatedAt: new Date(),
          };
        }),
      },
    };

    return new UsersService(prisma as never);
  }

  it('keeps backward compatibility when subjectKind is omitted', async () => {
    const service = createService();
    const created = await service.createRbac(actor, {
      name: 'legacy-role',
      kind: 'RoleBinding',
      namespace: 'default',
      subject: 'legacy-user',
    });

    expect(created.subject).toBe('legacy-user');
    expect(created.subjectKind).toBe('User');
    expect(created.subjectNamespace).toBe('');
    expect(created.subjectRef).toEqual({
      kind: 'User',
      name: 'legacy-user',
      namespace: '',
    });
  });

  it('accepts subjectRef(kind/name/namespace) for ServiceAccount', async () => {
    const service = createService();
    const created = await service.createRbac(actor, {
      name: 'sa-role',
      kind: 'RoleBinding',
      namespace: 'apps',
      subjectRef: {
        kind: 'ServiceAccount',
        name: 'deployer',
        namespace: 'apps',
      },
    });

    expect(created.subject).toBe('deployer');
    expect(created.subjectKind).toBe('ServiceAccount');
    expect(created.subjectNamespace).toBe('apps');
  });

  it('accepts /users/rbac payload from UI for User subjectRef', async () => {
    const service = createService();
    const created = await service.createRbac(actor, {
      name: 'admin',
      kind: 'RoleBinding',
      namespace: 'study',
      subject: 'test',
      subjectKind: 'User',
      subjectNamespace: '',
      subjectRef: {
        kind: 'User',
        name: 'test',
        namespace: '',
      },
    });

    expect(created).toMatchObject({
      name: 'admin',
      kind: 'RoleBinding',
      namespace: 'study',
      subject: 'test',
      subjectKind: 'User',
      subjectNamespace: '',
      subjectRef: {
        kind: 'User',
        name: 'test',
        namespace: '',
      },
      state: 'active',
    });
  });

  it('rejects RoleBinding with Group subject', async () => {
    const service = createService();
    await expect(
      service.createRbac(actor, {
        name: 'invalid-group',
        kind: 'RoleBinding',
        namespace: 'default',
        subjectRef: {
          kind: 'Group',
          name: 'ops-team',
        },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-string role names as BadRequestException', async () => {
    const service = createService();
    await expect(
      service.createRbac(actor, {
        name: ['admin'] as unknown as string,
        kind: 'RoleBinding',
        namespace: 'study',
        subjectRef: {
          kind: 'User',
          name: 'test',
          namespace: '',
        },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('maps RBAC persistence validation failures to BadRequestException', async () => {
    const prismaError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      clientVersion: 'test',
    });
    const service = createService({ createError: prismaError });

    await expect(
      service.createRbac(actor, {
        name: 'admin',
        kind: 'RoleBinding',
        namespace: 'study',
        subjectRef: {
          kind: 'User',
          name: 'test',
          namespace: '',
        },
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
