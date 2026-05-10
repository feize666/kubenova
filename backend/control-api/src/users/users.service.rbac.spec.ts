import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService RBAC subject contract', () => {
  const actor = { username: 'tester', role: 'platform-admin' as const };

  function createService(): UsersService {
    let seq = 0;
    const prisma = {
      rbacBinding: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
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
});
