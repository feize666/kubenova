jest.mock('@kubernetes/client-node', () => ({}));

import { StorageService } from './storage.service';
import type { StorageRepository } from './storage.repository';
import type { ClustersService } from '../clusters/clusters.service';
import type { ClusterSyncService } from '../clusters/cluster-sync.service';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { ClusterEventSyncService } from '../clusters/cluster-event-sync.service';
import type { K8sClientService } from '../clusters/k8s-client.service';

describe('StorageService list online gate', () => {
  function build() {
    const storageRepository = {
      list: jest.fn(),
    } as unknown as StorageRepository;
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
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    } as unknown as ClusterHealthService;
    const service = new StorageService(
      storageRepository,
      clustersService,
      k8sClientService,
      clusterSyncService,
      clusterHealthService,
      clusterEventSyncService,
    );
    return {
      service,
      storageRepository,
      clustersService,
      clusterSyncService,
      clusterHealthService,
    };
  }

  it('returns empty when no readable clusters', async () => {
    const { service, storageRepository, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue([]);

    const result = await service.list({ page: '2', pageSize: '8' });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(8);
    expect(storageRepository.list).not.toHaveBeenCalled();
  });

  it('passes clusterIds when clusterId is absent', async () => {
    const { service, storageRepository, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1']);
    (storageRepository.list as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    await service.list({ keyword: 'pvc', sync: 'false' });

    expect(storageRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: undefined, clusterIds: ['c-1'] }),
    );
  });

  it('triggers storage sync for all readable clusters when clusterId is absent', async () => {
    const {
      service,
      storageRepository,
      clustersService,
      clusterHealthService,
      clusterSyncService,
    } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1', 'c-2']);
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue('kubeconfig');
    (clusterSyncService.syncCluster as jest.Mock).mockResolvedValue({
      errors: [],
    });
    (storageRepository.list as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    await service.list({ keyword: 'pvc' });
    await Promise.resolve();

    expect(clusterSyncService.syncCluster).toHaveBeenCalledTimes(2);
    expect(clusterSyncService.syncCluster).toHaveBeenCalledWith(
      'c-1',
      'kubeconfig',
    );
    expect(clusterSyncService.syncCluster).toHaveBeenCalledWith(
      'c-2',
      'kubeconfig',
    );
  });

  it('waits for foreground storage sync before reading repository data', async () => {
    const {
      service,
      storageRepository,
      clustersService,
      clusterHealthService,
      clusterSyncService,
    } = build();
    const calls: string[] = [];
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1']);
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue('kubeconfig');
    (clusterSyncService.syncCluster as jest.Mock).mockImplementation(async () => {
      calls.push('sync');
      return { errors: [] };
    });
    (storageRepository.list as jest.Mock).mockImplementation(async () => {
      calls.push('list');
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      };
    });

    await service.list({ sync: 'foreground' });

    expect(calls).toEqual(['sync', 'list']);
  });

  it('asserts online for explicit clusterId and can skip sync', async () => {
    const {
      service,
      storageRepository,
      clusterSyncService,
      clusterHealthService,
    } = build();
    (storageRepository.list as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    await service.list({ clusterId: ' c-1 ', sync: 'false' });

    expect(
      clusterHealthService.assertClusterOnlineForRead,
    ).toHaveBeenCalledWith('c-1');
    expect(storageRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c-1', clusterIds: undefined }),
    );
    expect(clusterSyncService.syncCluster).not.toHaveBeenCalled();
  });
});
