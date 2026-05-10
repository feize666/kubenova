jest.mock('@kubernetes/client-node', () => ({}));

import { ClusterHealthController } from './cluster-health.controller';

describe('ClusterHealthController', () => {
  function createController() {
    const clusterHealthService = {
      listClusterHealth: jest.fn(),
      getClusterHealthDetail: jest.fn(),
      probeCluster: jest.fn(),
    } as any;
    return {
      controller: new ClusterHealthController(clusterHealthService),
      service: clusterHealthService,
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
