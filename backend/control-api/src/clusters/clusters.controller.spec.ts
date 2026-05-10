jest.mock('@kubernetes/client-node', () => ({}));

import { ClustersController } from './clusters.controller';

describe('ClustersController', () => {
  function createController() {
    const clustersService = {
      list: jest.fn(),
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
        { id: 'c-1', state: 'active', hasKubeconfig: true },
        { id: 'c-2', state: 'active', hasKubeconfig: true },
        { id: 'c-3', state: 'disabled', hasKubeconfig: true },
      ],
      page: 1,
      pageSize: 10,
      total: 3,
      timestamp: new Date().toISOString(),
    });
    clusterHealthService.listSelectableClusterIdsForResourceRead.mockResolvedValue(
      ['c-1'],
    );

    const req = { headers: {} } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
    } as any;

    const resp = await controller.list(req, res, {
      selectableOnly: 'true',
    } as any);

    expect(
      clusterHealthService.listSelectableClusterIdsForResourceRead,
    ).toHaveBeenCalled();
    expect(resp.data.items).toHaveLength(1);
    expect(resp.data.items[0].id).toBe('c-1');
    expect(resp.data.total).toBe(1);
    expect(resp.meta.selectableOnly).toBe(true);
  });
});
