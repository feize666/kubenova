jest.mock('@kubernetes/client-node', () => ({}));

import { NetworkService } from './network.service';
import type { NetworkRepository } from './network.repository';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { ClusterEventSyncService } from '../clusters/cluster-event-sync.service';
import type { ClusterSyncService } from '../clusters/cluster-sync.service';
import type { ClustersService } from '../clusters/clusters.service';
import type { K8sClientService } from '../clusters/k8s-client.service';

describe('NetworkService list online gate', () => {
  function build() {
    const networkRepository = {
      list: jest.fn(),
    } as unknown as NetworkRepository;
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
    const k8sClientService = {
      getCoreApi: jest.fn(),
      getDiscoveryApi: jest.fn(),
      getNetworkingApi: jest.fn(),
      getCustomObjectsApi: jest.fn(),
    } as unknown as K8sClientService;
    const service = new NetworkService(
      networkRepository,
      clusterHealthService,
      clustersService,
      clusterSyncService,
      clusterEventSyncService,
      k8sClientService,
    );
    return {
      service,
      networkRepository,
      clusterHealthService,
      clustersService,
      k8sClientService,
    };
  }

  it('returns empty when no readable clusters', async () => {
    const { service, networkRepository, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue([]);

    const result = await service.list({ page: '2', pageSize: '5' });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(5);
    expect(networkRepository.list).not.toHaveBeenCalled();
  });

  it('passes clusterIds when clusterId is absent', async () => {
    const { service, networkRepository, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1', 'c-2']);
    (networkRepository.list as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    await service.list({ keyword: 'pod' });

    expect(networkRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: undefined,
        clusterIds: ['c-1', 'c-2'],
      }),
    );
  });

  it('asserts online for explicit clusterId', async () => {
    const { service, networkRepository, clusterHealthService } = build();
    (networkRepository.list as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    await service.list({ clusterId: ' c-1 ' });

    expect(
      clusterHealthService.assertClusterOnlineForRead,
    ).toHaveBeenCalledWith('c-1');
    expect(networkRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c-1', clusterIds: undefined }),
    );
  });

  it('lists NetworkPolicy from live cluster inventory', async () => {
    const {
      service,
      networkRepository,
      clusterHealthService,
      clustersService,
      k8sClientService,
    } = build();
    (clusterHealthService.assertClusterOnlineForRead as jest.Mock).mockResolvedValue(
      undefined,
    );
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue('kubeconfig');
    (k8sClientService.getNetworkingApi as jest.Mock).mockReturnValue({
      listNetworkPolicyForAllNamespaces: jest.fn().mockResolvedValue({
        items: [
          {
            metadata: {
              name: 'allow-web',
              namespace: 'default',
              labels: { app: 'web' },
              creationTimestamp: new Date('2026-01-02T03:04:05.000Z'),
            },
            spec: {
              podSelector: { matchLabels: { app: 'web' } },
              policyTypes: ['Ingress'],
            },
          },
        ],
      }),
    });

    const result = await service.list({
      clusterId: 'c-1',
      kind: 'NetworkPolicy',
      page: '1',
      pageSize: '20',
    });

    expect(networkRepository.list).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'live:c-1:NetworkPolicy:default:allow-web',
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'NetworkPolicy',
        name: 'allow-web',
        state: 'active',
      }),
    );
    expect(result.items[0].spec).toEqual(
      expect.objectContaining({
        podSelector: { matchLabels: { app: 'web' } },
        policyTypes: ['Ingress'],
      }),
    );
  });

  it('deletes live NetworkPolicy without requiring repository row', async () => {
    const {
      service,
      networkRepository,
      clusterHealthService,
      clustersService,
      k8sClientService,
    } = build();
    (clusterHealthService.assertClusterOnlineForRead as jest.Mock).mockResolvedValue(
      undefined,
    );
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue('kubeconfig');
    const deleteNamespacedNetworkPolicy = jest.fn().mockResolvedValue({});
    (k8sClientService.getNetworkingApi as jest.Mock).mockReturnValue({
      listNamespacedNetworkPolicy: jest.fn().mockResolvedValue({
        items: [
          {
            metadata: {
              name: 'allow-web',
              namespace: 'default',
              creationTimestamp: new Date('2026-01-02T03:04:05.000Z'),
            },
            spec: { podSelector: {}, policyTypes: ['Ingress'] },
          },
        ],
      }),
      deleteNamespacedNetworkPolicy,
    });
    (networkRepository as unknown as { setState?: jest.Mock }).setState =
      jest.fn();

    const result = await service.applyAction(
      'live:c-1:NetworkPolicy:default:allow-web',
      { action: 'delete' },
    );

    expect(deleteNamespacedNetworkPolicy).toHaveBeenCalledWith({
      name: 'allow-web',
      namespace: 'default',
    });
    expect((networkRepository as unknown as { setState: jest.Mock }).setState).not.toHaveBeenCalled();
    expect(result.item).toEqual(
      expect.objectContaining({
        id: 'live:c-1:NetworkPolicy:default:allow-web',
        state: 'deleted',
      }),
    );
  });

  it('creates NetworkPolicy through networking api', async () => {
    const networkRepository = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      create: jest
        .fn()
        .mockImplementation(async (data) => ({ id: 'np-1', ...data })),
    } as unknown as NetworkRepository;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    } as unknown as ClusterHealthService;
    const clustersService = {
      getKubeconfig: jest.fn().mockResolvedValue('kubeconfig'),
    } as unknown as ClustersService;
    const networkingApi = {
      createNamespacedNetworkPolicy: jest.fn().mockResolvedValue({}),
    };
    const k8sClientService = {
      getCoreApi: jest.fn(),
      getDiscoveryApi: jest.fn(),
      getNetworkingApi: jest.fn().mockReturnValue(networkingApi),
      getCustomObjectsApi: jest.fn(),
    } as unknown as K8sClientService;
    const clusterSyncService = {
      syncCluster: jest.fn(),
    } as unknown as ClusterSyncService;
    const clusterEventSyncService = {
      consumeClusterDirty: jest.fn().mockReturnValue(false),
    } as unknown as ClusterEventSyncService;
    const service = new NetworkService(
      networkRepository,
      clusterHealthService,
      clustersService,
      clusterSyncService,
      clusterEventSyncService,
      k8sClientService,
    );

    await service.create({
      clusterId: 'c-1',
      namespace: 'ns-1',
      kind: 'NetworkPolicy',
      name: 'np-1',
      spec: {},
    });

    expect(networkingApi.createNamespacedNetworkPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'ns-1',
        body: expect.objectContaining({
          kind: 'NetworkPolicy',
          metadata: expect.objectContaining({
            name: 'np-1',
            namespace: 'ns-1',
          }),
        }),
      }),
    );
    expect(networkRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'c-1',
        namespace: 'ns-1',
        kind: 'NetworkPolicy',
        name: 'np-1',
      }),
    );
  });
});
