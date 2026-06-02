jest.mock('@kubernetes/client-node', () => ({}));

import { ClustersController } from './clusters.controller';

describe('ClustersController', () => {
  function createController() {
    const clustersService = {
      list: jest.fn(),
      listNodes: jest.fn(),
      getKubeconfig: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateProfile: jest.fn(),
      remove: jest.fn(),
      disable: jest.fn(),
      enable: jest.fn(),
      applyBatchState: jest.fn(),
      getDetail: jest.fn(),
      getKubeconfigById: jest.fn(),
    } as any;
    const clusterSyncService = {
      syncCluster: jest.fn(),
    } as any;
    const clusterHealthService = {
      probeCluster: jest.fn(),
      getLegacyHealthResult: jest.fn(),
      listSelectableClusterIdsForResourceRead: jest.fn(),
    } as any;
    const clusterEventSyncService = {
      ensureClusterWatching: jest.fn(),
      subscribe: jest.fn(),
    } as any;

    return {
      controller: new ClustersController(
        clustersService,
        clusterSyncService,
        clusterHealthService,
        clusterEventSyncService,
      ),
      clustersService,
      clusterHealthService,
    };
  }

  it('list filters selectable clusters when selectableOnly is enabled', async () => {
    const { controller, clustersService, clusterHealthService } =
      createController();
    clustersService.list.mockResolvedValue({
      items: [
        { id: 'c-1', state: 'active', hasKubeconfig: true, status: 'normal' },
        { id: 'c-2', state: 'active', hasKubeconfig: true, status: 'offline' },
        { id: 'c-3', state: 'disabled', hasKubeconfig: true },
      ],
      page: 1,
      pageSize: 10,
      total: 3,
      timestamp: new Date().toISOString(),
    });

    const req = { headers: {} } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
    } as any;

    const resp = await controller.list(req, res, {
      selectableOnly: 'true',
    } as any);

    expect(clustersService.list).toHaveBeenCalled();
    expect(resp.data.items).toHaveLength(1);
    expect(resp.data.items[0].id).toBe('c-1');
    expect(resp.data.total).toBe(1);
    expect(resp.meta.selectableOnly).toBe(true);
  });

  it('healthCheck returns legacy runtime status from health service', async () => {
    const { controller, clusterHealthService } = createController();
    clusterHealthService.getLegacyHealthResult.mockResolvedValue({
      ok: false,
      runtimeStatus: 'offline-mode',
      latencyMs: 0,
      version: 'v1.29.0',
      nodeCount: null,
      message: '离线模式，无法验证真实连接状态',
    });

    const req = { headers: {} } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
    } as any;

    const resp = await controller.healthCheck(req, res, 'c-1');

    expect(clusterHealthService.getLegacyHealthResult).toHaveBeenCalledWith(
      'c-1',
    );
    expect(resp.data).toEqual({
      ok: false,
      runtimeStatus: 'offline-mode',
      latencyMs: 0,
      version: 'v1.29.0',
      nodeCount: null,
      message: '离线模式，无法验证真实连接状态',
    });
    expect(resp.meta.action).toBe('health');
  });

  it('nodes returns worker node inventory envelope', async () => {
    const { controller, clustersService } = createController();
    clustersService.listNodes.mockResolvedValue({
      items: [
        {
          id: 'c-1:node-a',
          name: 'node-a',
          role: 'worker',
          roles: ['worker'],
          ready: true,
          internalIP: '10.0.0.1',
          externalIP: null,
          osImage: 'Ubuntu',
          kernelVersion: '6.8.0',
          containerRuntimeVersion: 'containerd://1.7',
          cpuCapacity: '8',
          memoryCapacity: '32Gi',
          cpuUsagePercent: null,
          memoryUsagePercent: null,
          taints: [],
          age: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
      clusterId: 'c-1',
      degraded: false,
      degradationReason: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const req = { headers: {} } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
    } as any;

    const resp = await controller.nodes(req, res, 'c-1');

    expect(clustersService.listNodes).toHaveBeenCalledWith('c-1');
    expect(resp.data.total).toBe(1);
    expect(resp.data.items[0].cpuUsagePercent).toBeNull();
    expect(resp.meta.action).toBe('nodes');
  });
});
