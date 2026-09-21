import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClusterAccessService } from './cluster-access.service';

describe('ClusterAccessService', () => {
  it('discovers grant-authorized clusters without treating them as cluster-wide resource bindings', async () => {
    const { prisma } = harness();
    const grants = { listEffectiveGrants: async () => [{ clusterId: 'cluster-a' }] };
    const service = Reflect.construct(ClusterAccessService, [prisma, grants]) as ClusterAccessService;
    await expect((service as any).listDiscoverableClusterIds({ id: 'u', role: 'user' })).resolves.toEqual(['cluster-a']);
    await expect((service as any).assertCanDiscover({ id: 'u', role: 'user' }, 'cluster-a')).resolves.toBeUndefined();
    await expect((service as any).assertCanDiscover({ id: 'u', role: 'user' }, 'other')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.assertCanRead({ id: 'u', role: 'user' }, 'cluster-a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('opens a discovered namespace grant when no legacy role binding exists', async () => {
    const prisma = {
      clusterRegistry: { findFirst: jest.fn() },
      clusterRoleBinding: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
    const authorization = {
      listEffectiveGrants: jest.fn().mockResolvedValue([
        { clusterId: 'cluster-a', role: 'viewer', namespaces: [{ namespaceUid: 'ns-a' }] },
      ]),
    } as any;
    const service = Reflect.construct(ClusterAccessService, [prisma, authorization]) as ClusterAccessService;
    await expect(service.assertCanRead({ id: 'user-a', role: 'user' }, 'cluster-a'))
      .resolves.toMatchObject({ clusterId: 'cluster-a', accessRole: 'viewer', source: 'access-grant' });
  });

  it('keeps grant discovery working when an older deployment is missing the legacy binding table', async () => {
    const { prisma } = harness();
    const missingTable = Object.assign(new Error('The table `public.ClusterRoleBinding` does not exist'), { code: 'P2021' });
    prisma.clusterRoleBinding.findMany.mockRejectedValue(missingTable);
    prisma.clusterRoleBinding.findFirst.mockRejectedValue(missingTable);
    const grants = { listEffectiveGrants: async () => [{ clusterId: 'cluster-a' }] };
    const service = Reflect.construct(ClusterAccessService, [prisma, grants]) as ClusterAccessService;

    await expect(service.listDiscoverableClusterIds({ id: 'u', role: 'user' })).resolves.toEqual(['cluster-a']);
    await expect(service.assertCanDiscover({ id: 'u', role: 'user' }, 'cluster-a')).resolves.toBeUndefined();
    await expect(service.assertCanRead({ id: 'u', role: 'user' }, 'cluster-a')).rejects.toBeInstanceOf(NotFoundException);
  });
  function harness(binding: { role: string; clusterId: string } | null = null) {
    const prisma = {
      clusterRegistry: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cluster-a' }),
      },
      clusterRoleBinding: {
        findFirst: jest.fn().mockResolvedValue(binding),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    return {
      prisma,
      service: new ClusterAccessService(prisma as never),
    };
  }

  it('grants platform admins cluster-admin access while preserving explicit missing-cluster 404', async () => {
    const { service, prisma } = harness();
    await expect(
      service.assertCanRead({ id: 'admin', role: 'admin' }, 'cluster-a'),
    ).resolves.toEqual({
      clusterId: 'cluster-a',
      accessRole: 'cluster-admin',
      source: 'platform-admin',
    });
    prisma.clusterRegistry.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.assertCanRead({ id: 'admin', role: 'platform-admin' }, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    null,
    { role: 'viewer', clusterId: 'cluster-a', state: 'disabled' },
  ])(
    'returns the same 404 for an inaccessible or missing non-admin cluster',
    async (binding) => {
      const { service, prisma } = harness(binding);
      prisma.clusterRoleBinding.findFirst.mockResolvedValue(null);
      await expect(
        service.assertCanRead({ id: 'user-a', role: 'read-only' }, 'cluster-a'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'CLUSTER_NOT_FOUND_OR_INACCESSIBLE',
        }),
      });
      expect(prisma.clusterRegistry.findFirst).not.toHaveBeenCalled();
    },
  );

  it('allows active viewer reads but denies viewer mutations', async () => {
    const { service } = harness({ role: 'viewer', clusterId: 'cluster-a' });
    await expect(
      service.assertCanRead({ id: 'viewer', role: 'read-only' }, 'cluster-a'),
    ).resolves.toMatchObject({ accessRole: 'viewer' });
    await expect(
      service.assertCanMutate(
        { id: 'viewer', role: 'cluster-operator' },
        'cluster-a',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows operator mutation unless the platform role is read-only', async () => {
    const { service } = harness({ role: 'operator', clusterId: 'cluster-a' });
    await expect(
      service.assertCanMutate(
        { id: 'operator', role: 'cluster-operator' },
        'cluster-a',
      ),
    ).resolves.toMatchObject({ accessRole: 'operator' });
    await expect(
      service.assertCanMutate(
        { id: 'operator', role: 'read-only' },
        'cluster-a',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('treats the default user role as a known read-only platform role', async () => {
    const { service } = harness({ role: 'operator', clusterId: 'cluster-a' });
    await expect(
      service.assertCanRead({ id: 'user-a', role: 'user' }, 'cluster-a'),
    ).resolves.toMatchObject({ accessRole: 'operator' });
    await expect(
      service.assertCanMutate({ id: 'user-a', role: 'user' }, 'cluster-a'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts operator as a cluster-operator platform role alias', async () => {
    const { service } = harness({ role: 'operator', clusterId: 'cluster-a' });
    await expect(
      service.assertCanMutate(
        { id: 'operator', role: 'operator' },
        'cluster-a',
      ),
    ).resolves.toMatchObject({ accessRole: 'operator' });
  });

  it('reserves registry lifecycle operations for platform admins', () => {
    const { service } = harness();
    expect(() =>
      service.assertPlatformAdmin({ id: 'admin', role: 'admin' }),
    ).not.toThrow();
    expect(() =>
      service.assertPlatformAdmin({
        id: 'operator',
        role: 'cluster-operator',
      }),
    ).toThrow(ForbiddenException);
  });

  it('requires cluster-admin access and a writable platform role for kubeconfig export', async () => {
    const operator = harness({
      role: 'operator',
      clusterId: 'cluster-a',
    });
    await expect(
      operator.service.assertClusterAdmin(
        { id: 'operator', role: 'cluster-operator' },
        'cluster-a',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const clusterAdmin = harness({
      role: 'cluster-admin',
      clusterId: 'cluster-a',
    });
    await expect(
      clusterAdmin.service.assertClusterAdmin(
        { id: 'cluster-admin', role: 'cluster-operator' },
        'cluster-a',
      ),
    ).resolves.toMatchObject({ accessRole: 'cluster-admin' });
    await expect(
      clusterAdmin.service.assertClusterAdmin(
        { id: 'cluster-admin', role: 'user' },
        'cluster-a',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed for unknown binding and platform roles', async () => {
    const unknownBinding = harness({
      role: 'owner',
      clusterId: 'cluster-a',
    });
    await expect(
      unknownBinding.service.assertCanRead(
        { id: 'user-a', role: 'user' },
        'cluster-a',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const unknownPlatform = harness({
      role: 'viewer',
      clusterId: 'cluster-a',
    });
    await expect(
      unknownPlatform.service.assertCanRead(
        { id: 'user-a', role: 'owner' },
        'cluster-a',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only active, valid-role bindings and requires a user identity', async () => {
    const { service, prisma } = harness();
    prisma.clusterRoleBinding.findMany.mockResolvedValue([
      { clusterId: 'cluster-a' },
    ]);
    await expect(
      service.listAccessibleClusterIds({ id: 'user-a', role: 'read-only' }),
    ).resolves.toEqual(['cluster-a']);
    expect(prisma.clusterRoleBinding.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'user-a',
        state: 'active',
        role: { in: ['viewer', 'operator', 'cluster-admin'] },
      }),
      select: { clusterId: true },
    });
    await expect(
      service.listAccessibleClusterIds({ role: 'read-only' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
