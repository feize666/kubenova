import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClusterAccessService } from './cluster-access.service';

describe('ClusterAccessService', () => {
  const cluster = { id: 'cluster-a' };

  function createService() {
    const prisma = {
      clusterRegistry: { findFirst: jest.fn().mockResolvedValue(cluster) },
      clusterRoleBinding: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    } as any;
    return { service: new ClusterAccessService(prisma), prisma };
  }

  it('grants platform admins implicit cluster-admin access', async () => {
    const { service, prisma } = createService();

    await expect(
      service.assertCanAccess(
        { id: 'admin-1', role: 'platform-admin' },
        'cluster-a',
      ),
    ).resolves.toEqual({
      clusterId: 'cluster-a',
      accessRole: 'cluster-admin',
      source: 'platform-admin',
    });
    expect(prisma.clusterRoleBinding.findFirst).not.toHaveBeenCalled();
  });

  it('grants non-admin users their active bound role', async () => {
    const { service, prisma } = createService();
    prisma.clusterRoleBinding.findFirst.mockResolvedValue({ role: 'operator' });

    await expect(
      service.assertCanAccess({ id: 'user-1', role: 'read-only' }, 'cluster-a'),
    ).resolves.toMatchObject({
      accessRole: 'operator',
      source: 'role-binding',
    });
  });

  it('rejects non-admin users without an active binding', async () => {
    const { service, prisma } = createService();
    prisma.clusterRoleBinding.findFirst.mockResolvedValue(null);

    await expect(
      service.assertCanAccess({ id: 'user-1' }, 'cluster-a'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns not found before evaluating authorization for absent clusters', async () => {
    const { service, prisma } = createService();
    prisma.clusterRegistry.findFirst.mockResolvedValue(null);

    await expect(
      service.assertCanAccess({ id: 'user-1' }, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires a user identity for non-admin access', async () => {
    const { service } = createService();

    await expect(
      service.assertCanAccess(undefined, 'cluster-a'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns null for unrestricted administrators and binding IDs for users', async () => {
    const { service, prisma } = createService();
    prisma.clusterRoleBinding.findMany.mockResolvedValue([
      { clusterId: 'cluster-a' },
      { clusterId: 'cluster-b' },
    ]);

    await expect(
      service.listAccessibleClusterIds({ id: 'admin-1', role: 'admin' }),
    ).resolves.toBeNull();
    await expect(
      service.listAccessibleClusterIds({ id: 'user-1' }),
    ).resolves.toEqual(['cluster-a', 'cluster-b']);
  });
});
