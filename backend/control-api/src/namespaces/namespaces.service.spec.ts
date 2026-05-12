jest.mock('@kubernetes/client-node', () => ({}));

import { NamespacesService } from './namespaces.service';
import type { PrismaService } from '../platform/database/prisma.service';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { ClusterSyncService } from '../clusters/cluster-sync.service';
import type { ClustersService } from '../clusters/clusters.service';
import type { K8sClientService } from '../clusters/k8s-client.service';

describe('NamespacesService list online gate', () => {
  function build() {
    const prisma = {
      namespaceRecord: {
        findMany: jest.fn(),
      },
    } as unknown as PrismaService;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    } as unknown as ClusterHealthService;
    const clusterSyncService = {} as ClusterSyncService;
    const clustersService = {} as ClustersService;
    const k8sClientService = {} as K8sClientService;
    const service = new NamespacesService(
      prisma,
      clusterHealthService,
      clusterSyncService,
      clustersService,
      k8sClientService,
    );
    return { service, prisma, clusterHealthService };
  }

  it('returns empty when no readable clusters', async () => {
    const { service, prisma, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue([]);

    const result = await service.list({});

    expect(result).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    expect(prisma.namespaceRecord.findMany).not.toHaveBeenCalled();
  });

  it('filters by readable clusterIds when clusterId is absent', async () => {
    const { service, prisma, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1', 'c-2']);
    (prisma.namespaceRecord.findMany as jest.Mock).mockResolvedValue([]);

    await service.list({ keyword: 'prod' });

    expect(prisma.namespaceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clusterId: { in: ['c-1', 'c-2'] },
        }),
      }),
    );
  });

  it('asserts online for explicit clusterId', async () => {
    const { service, prisma, clusterHealthService } = build();
    (prisma.namespaceRecord.findMany as jest.Mock).mockResolvedValue([]);

    await service.list({ clusterId: ' c-1 ' });

    expect(
      clusterHealthService.assertClusterOnlineForRead,
    ).toHaveBeenCalledWith('c-1');
    expect(prisma.namespaceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clusterId: { in: ['c-1'] } }),
      }),
    );
  });
});
