jest.mock('@kubernetes/client-node', () => ({}));

import { NotFoundException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';

describe('DashboardController cluster access', () => {
  function build() {
    const dashboardService = { getStats: jest.fn().mockResolvedValue({}) };
    const clusterAccessService = {
      assertCanRead: jest.fn().mockResolvedValue({ clusterId: 'canonical-c1' }),
      listAccessibleClusterIds: jest.fn(),
    };
    return {
      controller: new DashboardController(
        dashboardService as never,
        clusterAccessService as never,
      ),
      dashboardService,
      clusterAccessService,
    };
  }

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

    await expect(
      controller.getStats(
        { user: { user: { id: 'viewer', role: 'user' } } } as never,
        'forbidden',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(dashboardService.getStats).not.toHaveBeenCalled();
  });
});
