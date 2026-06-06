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
    },
  };
  const clustersService = {
    getKubeconfig: jest.fn(async (clusterId: string) => `kube-${clusterId}`),
  };
  const liveMetricsService = {
    getClusterSnapshot: jest.fn(async (clusterId: string) =>
      buildSnapshot(clusterId),
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
    expect(prisma.monitoringAlert.findMany).toHaveBeenCalledTimes(1);
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
});
