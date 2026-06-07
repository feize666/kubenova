jest.mock('../clusters/clusters.service', () => ({
  ClustersService: class ClustersService {},
}));

jest.mock('../metrics/live-metrics.service', () => ({
  LiveMetricsService: class LiveMetricsService {},
}));

import { DashboardService } from './dashboard.service';
import type { PrismaService } from '../platform/database/prisma.service';
import type { ClustersService } from '../clusters/clusters.service';
import type {
  ClusterLiveUsageSnapshot,
  LiveMetricsService,
} from '../metrics/live-metrics.service';

const buildSnapshot = (clusterId: string): ClusterLiveUsageSnapshot => ({
  capturedAt: '2026-06-06T00:00:00.000Z',
  source: 'metrics-server',
  available: true,
  freshnessWindowMs: 60_000,
  cpuUsage: 1,
  memoryUsage: 1024,
  pods: [],
  history: [
    {
      timestamp: '2026-06-06T00:00:00.000Z',
      cpuUsage: 1,
      memoryUsage: 1024,
    },
  ],
  note: `snapshot ${clusterId}`,
});

const buildClusterRows = (clusterIds: string[]) =>
  clusterIds.map((id) => ({
    id,
    name: id,
    metadata: {
      usageMetrics: {
        cpu: { usagePercent: 35 },
        memory: { usagePercent: 45 },
      },
    },
  }));

function createService(clusterIds: string[]) {
  const prisma = {
    clusterRegistry: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue(buildClusterRows(clusterIds)),
    },
    workloadRecord: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    monitoringAlert: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    namespaceRecord: {
      count: jest.fn().mockResolvedValue(0),
    },
    networkResource: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const clustersService = {
    getKubeconfig: jest.fn((clusterId: string) =>
      Promise.resolve(`kube-${clusterId}`),
    ),
  };
  const liveMetricsService = {
    getClusterSnapshot: jest.fn((clusterId: string) =>
      Promise.resolve(buildSnapshot(clusterId)),
    ),
  };

  return {
    prisma,
    clustersService,
    liveMetricsService,
    service: new DashboardService(
      prisma as unknown as PrismaService,
      clustersService as unknown as ClustersService,
      liveMetricsService as unknown as LiveMetricsService,
    ),
  };
}

describe('DashboardService', () => {
  it('reuses short cached stats for repeated dashboard hits', async () => {
    const { service, prisma, clustersService, liveMetricsService } =
      createService(['cluster-a']);

    const first = await service.getStats();
    const second = await service.getStats();

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(prisma.clusterRegistry.count).toHaveBeenCalledTimes(2);
    expect(prisma.clusterRegistry.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.workloadRecord.count).toHaveBeenCalledTimes(6);
    expect(prisma.monitoringAlert.count).toHaveBeenCalledTimes(2);
    expect(prisma.monitoringAlert.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.networkResource.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.workloadRecord.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(clustersService.getKubeconfig).toHaveBeenCalledTimes(1);
    expect(liveMetricsService.getClusterSnapshot).toHaveBeenCalledTimes(1);
  });

  it('limits live metrics fanout while collecting cluster snapshots', async () => {
    const clusterIds = Array.from(
      { length: 9 },
      (_, index) => `cluster-${index}`,
    );
    const { service, liveMetricsService } = createService(clusterIds);
    let active = 0;
    let maxActive = 0;
    let started = 0;
    const pendingResolvers: Array<() => void> = [];

    const flushPending = () => {
      const resolvers = pendingResolvers.splice(0);
      resolvers.forEach((resolve) => resolve());
    };

    liveMetricsService.getClusterSnapshot.mockImplementation(
      async (clusterId: string) => {
        active += 1;
        started += 1;
        maxActive = Math.max(maxActive, active);

        await new Promise<void>((resolve) => {
          pendingResolvers.push(resolve);
          if (active === 4 || started === clusterIds.length) {
            setImmediate(flushPending);
          }
        });

        active -= 1;
        return buildSnapshot(clusterId);
      },
    );

    await service.getStats();

    expect(maxActive).toBeLessThanOrEqual(4);
    expect(liveMetricsService.getClusterSnapshot).toHaveBeenCalledTimes(
      clusterIds.length,
    );
  });

  it('keeps live snapshot cache under the entry limit', async () => {
    const clusterIds = Array.from(
      { length: 205 },
      (_, index) => `cluster-${index}`,
    );
    const { service } = createService(clusterIds);

    await service.getStats();

    const harness = service as unknown as {
      liveSnapshotCache: Map<string, unknown>;
    };
    expect(harness.liveSnapshotCache.size).toBeLessThanOrEqual(200);
  });

  it('filters dashboard stats by selected cluster scope', async () => {
    const { service, prisma } = createService(['cluster-a']);

    const stats = await service.getStats({ clusterId: ' cluster-a ' });

    expect(stats.scope).toMatchObject({
      mode: 'cluster',
      clusterId: 'cluster-a',
      clusterName: 'cluster-a',
    });
    expect(stats.scope?.generatedAt).toEqual(expect.any(String));
    expect(prisma.clusterRegistry.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        status: { not: 'deleted' },
        id: 'cluster-a',
      },
      select: { id: true, name: true, metadata: true },
    });
    expect(prisma.workloadRecord.count).toHaveBeenCalledWith({
      where: {
        state: 'active',
        clusterId: 'cluster-a',
        cluster: {
          deletedAt: null,
          status: { not: 'deleted' },
          id: 'cluster-a',
        },
      },
    });
    expect(prisma.namespaceRecord.count).toHaveBeenCalledWith({
      where: {
        state: 'active',
        clusterId: 'cluster-a',
        cluster: {
          deletedAt: null,
          status: { not: 'deleted' },
          id: 'cluster-a',
        },
      },
    });
    expect(prisma.networkResource.count).toHaveBeenCalledWith({
      where: {
        state: 'active',
        clusterId: 'cluster-a',
        cluster: {
          deletedAt: null,
          status: { not: 'deleted' },
          id: 'cluster-a',
        },
        kind: 'Service',
      },
    });
    expect(prisma.monitoringAlert.count).toHaveBeenCalledWith({
      where: {
        clusterId: 'cluster-a',
        severity: 'critical',
        status: 'firing',
        OR: [
          { clusterId: null },
          {
            cluster: {
              is: { deletedAt: null, status: { not: 'deleted' } },
            },
          },
        ],
      },
    });
  });

  it('keeps all-cluster and selected-cluster stats cache entries separate', async () => {
    const { service, prisma } = createService(['cluster-a']);

    await service.getStats();
    await service.getStats({ clusterId: 'cluster-a' });
    await service.getStats({ clusterId: 'cluster-a' });

    expect(prisma.clusterRegistry.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.clusterRegistry.findMany).toHaveBeenNthCalledWith(1, {
      where: { deletedAt: null, status: { not: 'deleted' } },
      select: { id: true, name: true, metadata: true },
    });
    expect(prisma.clusterRegistry.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        deletedAt: null,
        status: { not: 'deleted' },
        id: 'cluster-a',
      },
      select: { id: true, name: true, metadata: true },
    });
  });

  it('marks selected-cluster scope degraded when cluster cannot be scoped', async () => {
    const { service } = createService([]);

    const stats = await service.getStats({ clusterId: 'missing-cluster' });

    expect(stats.scope).toMatchObject({
      mode: 'cluster',
      clusterId: 'missing-cluster',
      degraded: true,
      degradedReason: 'Selected cluster not found or deleted.',
    });
    expect(stats.clusters).toBeDefined();
    expect(stats.workloads).toBeDefined();
    expect(stats.resourceUsage).toBeDefined();
  });

  it('builds service impact and recent operations from live records', async () => {
    const { service, prisma } = createService(['cluster-a']);

    prisma.networkResource.findMany
      .mockResolvedValueOnce([
        {
          id: 'svc-1',
          clusterId: 'cluster-a',
          namespace: 'checkout',
          name: 'checkout-api',
          labels: {},
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'ing-1',
          clusterId: 'cluster-a',
          namespace: 'checkout',
          name: 'checkout-ingress',
        },
      ]);
    prisma.workloadRecord.findMany.mockResolvedValueOnce([
      {
        id: 'workload-1',
        clusterId: 'cluster-a',
        namespace: 'checkout',
        kind: 'Deployment',
        name: 'checkout-api',
        readyReplicas: 1,
        replicas: 3,
        labels: {},
      },
    ]);
    prisma.monitoringAlert.findMany
      .mockResolvedValueOnce([
        {
          id: 'alert-recent',
          severity: 'critical',
          title: 'Checkout latency',
          source: 'prometheus',
          firedAt: new Date('2026-06-06T01:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'alert-impact',
          clusterId: 'cluster-a',
          namespace: 'checkout',
          severity: 'critical',
          resourceType: 'Service',
          resourceName: 'checkout-api',
        },
      ]);
    prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-1',
        action: 'restart',
        resourceType: 'Deployment',
        resourceId: 'checkout/checkout-api',
        message: 'manual rollout restart',
        clusterId: 'cluster-a',
        createdAt: new Date('2026-06-06T02:00:00.000Z'),
        actorUser: { email: 'ops@example.com', name: 'Ops User' },
      },
    ]);

    const stats = await service.getStats({ clusterId: 'cluster-a' });

    expect(stats.recentEvents).toEqual([
      {
        id: 'alert-recent',
        level: 'critical',
        event: 'Checkout latency',
        source: 'prometheus',
        timestamp: '2026-06-06T01:00:00.000Z',
      },
    ]);
    expect(stats.serviceImpact.degraded).toBe(false);
    expect(stats.serviceImpact.impactedServices[0]).toMatchObject({
      name: 'checkout-api',
      namespace: 'checkout',
      clusterId: 'cluster-a',
      severity: 'critical',
      alertCount: 1,
      workloadCount: 1,
    });
    expect(stats.serviceImpact.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ingress',
          label: 'checkout-ingress',
          status: 'healthy',
        }),
        expect.objectContaining({
          id: 'service-0',
          label: 'checkout-api',
          status: 'critical',
        }),
      ]),
    );
    expect(stats.recentOperations[0]).toEqual({
      id: 'audit-1',
      action: 'restart',
      resourceType: 'Deployment',
      resourceId: 'checkout/checkout-api',
      actor: 'Ops User',
      result: 'success',
      timestamp: '2026-06-06T02:00:00.000Z',
      reason: 'manual rollout restart',
    });
  });

  it('does not synthesize impact score when services have no risk signal', async () => {
    const { service, prisma } = createService(['cluster-a']);

    prisma.networkResource.findMany
      .mockResolvedValueOnce([
        {
          id: 'svc-1',
          clusterId: 'cluster-a',
          namespace: 'stable',
          name: 'stable-api',
          labels: {},
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.workloadRecord.findMany.mockResolvedValueOnce([
      {
        id: 'workload-1',
        clusterId: 'cluster-a',
        namespace: 'stable',
        kind: 'Deployment',
        name: 'stable-api',
        readyReplicas: 3,
        replicas: 3,
        labels: {},
      },
    ]);

    const stats = await service.getStats({ clusterId: 'cluster-a' });

    expect(stats.serviceImpact.impactedServices[0]).toMatchObject({
      name: 'stable-api',
      severity: 'healthy',
      impactScore: 0,
      alertCount: 0,
      workloadCount: 1,
    });
    expect(stats.serviceImpact.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'service-0',
          label: 'stable-api',
          status: 'healthy',
        }),
      ]),
    );
  });
});
