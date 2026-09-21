jest.mock('@kubernetes/client-node', () => ({}));

import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { AuthorizationService } from '../common/authorization.service';

describe('DashboardController cluster access', () => {
  function build() {
    const dashboardService = { getStats: jest.fn().mockResolvedValue({}) };
    const clusterAccessService = {
      assertCanRead: jest.fn().mockResolvedValue({ clusterId: 'canonical-c1' }),
      listAccessibleClusterIds: jest.fn().mockResolvedValue(['c1']),
      isKnownPlatformRole: jest.fn().mockReturnValue(true),
    };
    const authorization = {
      listEffectiveGrants: jest.fn().mockResolvedValue([]),
    };
    const namespaceIdentity = {
      resolve: jest.fn().mockResolvedValue('uid-ai'),
    };
    return {
      controller: new DashboardController(
        dashboardService as never,
        clusterAccessService as never,
        authorization as never,
        namespaceIdentity as never,
      ),
      dashboardService,
      clusterAccessService,
      authorization,
      namespaceIdentity,
    };
  }

  it('includes only live namespace identities and refreshes grants before every request', async () => {
    const {
      controller,
      dashboardService,
      clusterAccessService,
      authorization,
      namespaceIdentity,
    } = build();
    clusterAccessService.listAccessibleClusterIds.mockResolvedValue([]);
    authorization.listEffectiveGrants.mockResolvedValue([
      {
        clusterId: 'c1',
        namespaces: [
          { namespaceName: 'ai', namespaceUid: 'uid-ai' },
          { namespaceName: 'old', namespaceUid: 'uid-old' },
        ],
      },
      {
        clusterId: 'c2',
        namespaces: [{ namespaceName: 'private', namespaceUid: 'uid-private' }],
      },
    ]);
    namespaceIdentity.resolve.mockImplementation(
      async (clusterId, namespace) =>
        namespace === 'ai' ? 'uid-ai' : 'recreated',
    );
    const req = { user: { user: { id: 'u1', role: 'read-only' } } };
    await controller.getStats(req);
    expect(dashboardService.getStats).toHaveBeenLastCalledWith({
      accessibleClusterIds: [],
      namespaceScopes: [
        { clusterId: 'c1', namespace: 'ai', namespaceUid: 'uid-ai' },
      ],
    });
    await controller.getStats(req, 'c1');
    expect(dashboardService.getStats).toHaveBeenLastCalledWith({
      clusterId: 'c1',
      accessibleClusterIds: [],
      namespaceScopes: [
        { clusterId: 'c1', namespace: 'ai', namespaceUid: 'uid-ai' },
      ],
    });
    authorization.listEffectiveGrants.mockResolvedValue([]);
    await expect(controller.getStats(req, 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await controller.getStats(req);
    expect(dashboardService.getStats).toHaveBeenLastCalledWith({
      accessibleClusterIds: [],
    });
  });

  it('fails closed on missing identity, unknown role and failed live namespace resolution', async () => {
    const {
      controller,
      dashboardService,
      clusterAccessService,
      authorization,
      namespaceIdentity,
    } = build();
    await expect(controller.getStats({})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    clusterAccessService.isKnownPlatformRole.mockReturnValue(false);
    await expect(
      controller.getStats({ user: { user: { id: 'u1', role: 'unknown' } } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    clusterAccessService.isKnownPlatformRole.mockReturnValue(true);
    clusterAccessService.listAccessibleClusterIds.mockResolvedValue([]);
    authorization.listEffectiveGrants.mockResolvedValue([
      {
        clusterId: 'c1',
        namespaces: [{ namespaceName: 'ai', namespaceUid: 'uid-ai' }],
      },
    ]);
    namespaceIdentity.resolve.mockRejectedValue(new Error('offline'));
    await expect(
      controller.getStats(
        { user: { user: { id: 'u1', role: 'read-only' } } },
        'c1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(dashboardService.getStats).not.toHaveBeenCalled();
  });

  it('uses effective direct and group grants and excludes revoked, expired and foreign grants', async () => {
    const { dashboardService, clusterAccessService, namespaceIdentity } =
      build();
    clusterAccessService.listAccessibleClusterIds.mockResolvedValue([]);
    const base = {
      role: 'viewer',
      state: 'active',
      validFrom: new Date(0),
      expiresAt: null,
      revokedAt: null,
      capabilities: [],
      namespaces: [{ namespaceName: 'ai', namespaceUid: 'uid-ai' }],
    };
    const prisma = {
      groupMembership: {
        findMany: jest.fn().mockResolvedValue([{ groupId: 'team' }]),
      },
      accessGrant: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...base,
            id: 'direct',
            userId: 'u1',
            groupId: null,
            clusterId: 'c1',
          },
          {
            ...base,
            id: 'group',
            userId: null,
            groupId: 'team',
            clusterId: 'c2',
          },
          {
            ...base,
            id: 'expired',
            userId: 'u1',
            groupId: null,
            clusterId: 'c3',
            expiresAt: new Date(1),
          },
          {
            ...base,
            id: 'revoked',
            userId: 'u1',
            groupId: null,
            clusterId: 'c4',
            revokedAt: new Date(),
          },
          {
            ...base,
            id: 'foreign',
            userId: 'other',
            groupId: null,
            clusterId: 'c5',
          },
        ]),
      },
    };
    const controller = new DashboardController(
      dashboardService as never,
      clusterAccessService as never,
      new AuthorizationService(prisma as never),
      namespaceIdentity as never,
    );
    const req = { user: { user: { id: 'u1', role: 'read-only' } } };
    await controller.getStats(req);
    expect(dashboardService.getStats).toHaveBeenLastCalledWith({
      accessibleClusterIds: [],
      namespaceScopes: [
        { clusterId: 'c1', namespace: 'ai', namespaceUid: 'uid-ai' },
        { clusterId: 'c2', namespace: 'ai', namespaceUid: 'uid-ai' },
      ],
    });
    prisma.groupMembership.findMany.mockResolvedValue([]);
    await controller.getStats(req);
    expect(dashboardService.getStats).toHaveBeenLastCalledWith({
      accessibleClusterIds: [],
      namespaceScopes: [
        { clusterId: 'c1', namespace: 'ai', namespaceUid: 'uid-ai' },
      ],
    });
  });

  it('authorizes an explicit cluster before using its canonical id', async () => {
    const { controller, dashboardService, clusterAccessService } = build();
    const order: string[] = [];
    clusterAccessService.assertCanRead.mockImplementation(async () => {
      order.push('access');
      return { clusterId: 'canonical-c1' };
    });
    dashboardService.getStats.mockImplementation(async () => {
      order.push('service');
      return {};
    });

    await controller.getStats(
      { user: { user: { id: 'u1', role: 'user' } } } as never,
      ' c1 ',
    );

    expect(clusterAccessService.assertCanRead).toHaveBeenCalledWith(
      { id: 'u1', role: 'user' },
      'c1',
    );
    expect(dashboardService.getStats).toHaveBeenCalledWith({
      clusterId: 'canonical-c1',
    });
    expect(order).toEqual(['access', 'service']);
  });

  it('passes accessible ids for a non-admin aggregate request', async () => {
    const { controller, dashboardService, clusterAccessService } = build();
    clusterAccessService.listAccessibleClusterIds.mockResolvedValue([
      'c1',
      'c2',
    ]);

    await controller.getStats(
      { user: { user: { id: 'u1', role: 'user' } } } as never,
      undefined,
    );

    expect(dashboardService.getStats).toHaveBeenCalledWith({
      accessibleClusterIds: ['c1', 'c2'],
    });
  });

  it('preserves platform-admin global scope', async () => {
    const { controller, dashboardService, clusterAccessService } = build();
    clusterAccessService.listAccessibleClusterIds.mockResolvedValue(null);

    await controller.getStats(
      { user: { user: { id: 'admin', role: 'platform-admin' } } } as never,
      undefined,
    );

    expect(dashboardService.getStats).toHaveBeenCalledWith({
      accessibleClusterIds: null,
    });
  });

  it('does not call dashboard data sources after explicit access denial', async () => {
    const { controller, dashboardService, clusterAccessService } = build();
    clusterAccessService.assertCanRead.mockRejectedValue(
      new NotFoundException(),
    );
    clusterAccessService.listAccessibleClusterIds.mockResolvedValue([
      'forbidden',
    ]);

    await expect(
      controller.getStats(
        { user: { user: { id: 'viewer', role: 'user' } } } as never,
        'forbidden',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(dashboardService.getStats).not.toHaveBeenCalled();
  });
});
