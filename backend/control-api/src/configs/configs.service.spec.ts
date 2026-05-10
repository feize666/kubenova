jest.mock('@kubernetes/client-node', () => ({}));

import { ConfigsService } from './configs.service';
import type { ConfigsRepository } from './configs.repository';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { ClusterEventSyncService } from '../clusters/cluster-event-sync.service';
import type { ClusterSyncService } from '../clusters/cluster-sync.service';
import type { ClustersService } from '../clusters/clusters.service';
import type { K8sClientService } from '../clusters/k8s-client.service';

describe('ConfigsService list online gate', () => {
  function build() {
    const configsRepository = {
      list: jest.fn(),
    } as unknown as ConfigsRepository;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    } as unknown as ClusterHealthService;
    const clustersService = {
      getKubeconfig: jest.fn(),
    } as unknown as ClustersService;
    const clusterSyncService = {
      syncCluster: jest.fn(),
    } as unknown as ClusterSyncService;
    const clusterEventSyncService = {
      consumeClusterDirty: jest.fn().mockReturnValue(false),
    } as unknown as ClusterEventSyncService;
    const k8sClientService = {} as K8sClientService;
    const service = new ConfigsService(
      configsRepository,
      clusterHealthService,
      clustersService,
      clusterSyncService,
      clusterEventSyncService,
      k8sClientService,
    );
    return { service, configsRepository, clusterHealthService };
  }

  it('returns empty when no readable clusters', async () => {
    const { service, configsRepository, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue([]);

    const result = await service.list({ page: '3', pageSize: '7' });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(7);
    expect(configsRepository.list).not.toHaveBeenCalled();
  });

  it('passes clusterIds when clusterId is absent', async () => {
    const { service, configsRepository, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1', 'c-2']);
    (configsRepository.list as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    await service.list({ keyword: 'cfg' });

    expect(configsRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: undefined,
        clusterIds: ['c-1', 'c-2'],
      }),
    );
  });

  it('asserts online for explicit clusterId', async () => {
    const { service, configsRepository, clusterHealthService } = build();
    (configsRepository.list as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    await service.list({ clusterId: ' c-1 ' });

    expect(
      clusterHealthService.assertClusterOnlineForRead,
    ).toHaveBeenCalledWith('c-1');
    expect(configsRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c-1', clusterIds: undefined }),
    );
  });
});
