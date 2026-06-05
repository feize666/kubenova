jest.mock('@kubernetes/client-node', () => ({}));

import { TopologySummaryService } from './topology-summary.service';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { PrismaService } from '../platform/database/prisma.service';

describe('TopologySummaryService', () => {
  function build() {
    const prisma = {
      namespaceRecord: { findMany: jest.fn() },
      workloadRecord: { findMany: jest.fn() },
      networkResource: { findMany: jest.fn() },
      storageResource: { findMany: jest.fn() },
      configResource: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    } as unknown as ClusterHealthService;
    const service = new TopologySummaryService(prisma, clusterHealthService);
    return { service, prisma, clusterHealthService };
  }

  function mockEmptyTables(prisma: PrismaService) {
    (prisma.namespaceRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.workloadRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.networkResource.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.storageResource.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.configResource.findMany as jest.Mock).mockResolvedValue([]);
  }

  it('returns empty summary when no readable clusters', async () => {
    const { service, prisma, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue([]);

    const result = await service.listNamespaceSummaries();

    expect(result.items).toEqual([]);
    expect(result.timestamp).toEqual(expect.any(String));
    expect(prisma.namespaceRecord.findMany).not.toHaveBeenCalled();
  });

  it('asserts explicit cluster and returns empty shape', async () => {
    const { service, prisma, clusterHealthService } = build();
    mockEmptyTables(prisma);

    const result = await service.listNamespaceSummaries({ clusterId: ' c-1 ' });

    expect(
      clusterHealthService.assertClusterOnlineForRead,
    ).toHaveBeenCalledWith('c-1');
    expect(result.items).toEqual([]);
    expect(prisma.workloadRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clusterId: { in: ['c-1'] } }),
      }),
    );
  });

  it('aggregates namespace resource counts and abnormal count', async () => {
    const { service, prisma, clusterHealthService } = build();
    const older = new Date('2026-01-01T00:00:00.000Z');
    const newer = new Date('2026-01-02T00:00:00.000Z');
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1']);
    (prisma.namespaceRecord.findMany as jest.Mock).mockResolvedValue([
      { clusterId: 'c-1', name: 'default', state: 'active', updatedAt: older },
    ]);
    (prisma.workloadRecord.findMany as jest.Mock).mockResolvedValue([
      {
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Deployment',
        state: 'active',
        statusJson: { phase: 'Running' },
        replicas: 3,
        readyReplicas: 2,
        updatedAt: newer,
      },
      {
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Pod',
        state: 'active',
        statusJson: { phase: 'Running' },
        replicas: null,
        readyReplicas: null,
        updatedAt: older,
      },
    ]);
    (prisma.networkResource.findMany as jest.Mock).mockResolvedValue([
      {
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Service',
        state: 'active',
        statusJson: {},
        updatedAt: older,
      },
    ]);
    (prisma.storageResource.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.configResource.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listNamespaceSummaries();

    expect(result.items).toEqual([
      {
        clusterId: null,
        namespace: 'default',
        resourceCounts: {
          Deployment: 1,
          Pod: 1,
          Service: 1,
        },
        statusCounts: {
          active: 2,
          Running: 2,
        },
        gatewayCount: 0,
        networkCount: 1,
        workloadCount: 1,
        podCount: 1,
        abnormalCount: 1,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });
});
