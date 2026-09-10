jest.mock('@kubernetes/client-node', () => ({}));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClusterHealthController } from './cluster-health.controller';

describe('ClusterHealthController', () => {
  function createController() {
    const clusterHealthService = {
      listClusterHealth: jest.fn(),
      getClusterHealthDetail: jest.fn(),
      probeCluster: jest.fn(),
    } as any;
    const clusterAccessService = {
      listAccessibleClusterIds: jest.fn().mockResolvedValue(null),
      assertCanRead: jest.fn(),
      assertCanMutate: jest.fn(),
    } as any;
    return {
      controller: new ClusterHealthController(
        clusterHealthService,
        clusterAccessService,
      ),
      service: clusterHealthService,
      clusterAccessService,
    };
  }

  it('list returns envelope with list payload', async () => {
    const { controller, service } = createController();
    service.listClusterHealth.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
      timestamp: new Date().toISOString(),
    });

    const req = { headers: {} } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
    } as any;

    const resp = await controller.list(req, res, {} as any);
    expect(resp.data.total).toBe(0);
    expect(resp.meta.action).toBe('list');
  });

  it('filters health list through the current user cluster bindings', async () => {
    const { controller, service, clusterAccessService } = createController();
    clusterAccessService.listAccessibleClusterIds.mockResolvedValue(['c1']);
    service.listClusterHealth.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
      timestamp: new Date().toISOString(),
    });

    await controller.list(
      { headers: {}, user: { user: { id: 'u1', role: 'user' } } } as any,
      { getHeader: jest.fn(), setHeader: jest.fn() } as any,
      {} as any,
    );

    expect(service.listClusterHealth).toHaveBeenCalledWith(
      {},
      { accessibleClusterIds: ['c1'] },
    );
  });

  it('authorizes health detail before loading it', async () => {
    const { controller, service, clusterAccessService } = createController();
    clusterAccessService.assertCanRead.mockRejectedValue(
      new NotFoundException(),
    );
    await expect(
      controller.detail(
        { headers: {}, user: { user: { id: 'u1', role: 'user' } } } as any,
        { getHeader: jest.fn(), setHeader: jest.fn() } as any,
        'c1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(service.getClusterHealthDetail).not.toHaveBeenCalled();
  });

  it('authorizes manual probe mutation before Kubernetes work', async () => {
    const { controller, service, clusterAccessService } = createController();
    clusterAccessService.assertCanMutate.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      controller.manualProbe(
        { headers: {}, user: { user: { id: 'u1', role: 'user' } } } as any,
        { getHeader: jest.fn(), setHeader: jest.fn() } as any,
        'c1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.probeCluster).not.toHaveBeenCalled();
  });

  it('manualProbe forwards source=manual and bypassBackoff=true', async () => {
    const { controller, service } = createController();
    service.probeCluster.mockResolvedValue({
      clusterId: 'c1',
      ok: true,
      status: 'running',
      latencyMs: 8,
      checkedAt: new Date().toISOString(),
      reason: null,
      source: 'manual',
      timeoutMs: 8000,
      failureCount: 0,
      detailJson: null,
      isStale: false,
    });

    const req = {
      headers: {},
      user: { user: { username: 'u1', role: 'admin' } },
    } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
    } as any;

    const resp = await controller.manualProbe(req, res, 'c1');
    expect(service.probeCluster).toHaveBeenCalledWith('c1', {
      source: 'manual',
      bypassBackoff: true,
    });
    expect(resp.meta.action).toBe('probe');
  });
});
