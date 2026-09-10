jest.mock('@kubernetes/client-node', () => ({}));

import { MonitoringService } from './monitoring.service';
import type { PrismaService } from '../platform/database/prisma.service';
import type { ClustersService } from '../clusters/clusters.service';
import type { LiveMetricsService } from '../metrics/live-metrics.service';

const timeFilter = {
  range: '1h' as const,
  from: new Date('2026-06-06T00:00:00.000Z'),
  to: new Date('2026-06-06T01:00:00.000Z'),
};

function createService() {
  const alertRow = {
    id: 'alert-1',
    clusterId: null,
    namespace: 'default',
    severity: 'critical',
    title: 'API unavailable',
    message: 'api unavailable',
    source: 'prometheus',
    resourceType: 'Deployment',
    resourceName: 'api',
    status: 'firing',
    firedAt: new Date('2026-06-06T00:30:00.000Z'),
    resolvedAt: null,
  };
  const prisma = {
    clusterRegistry: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn((args: { select?: Record<string, unknown> }) => {
        if (args.select?.status) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      }),
    },
    namespaceRecord: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    workloadRecord: {
      count: jest.fn().mockResolvedValue(3),
      findMany: jest.fn().mockResolvedValue([]),
    },
    networkResource: {
      count: jest.fn().mockResolvedValue(4),
      findMany: jest.fn().mockResolvedValue([]),
    },
    storageResource: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    configResource: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    monitoringAlert: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn((args: { take?: number; skip?: number }) =>
        Promise.resolve(args.take === 300 ? [] : [alertRow]),
      ),
    },
  };
  const clustersService = {
    getKubeconfig: jest.fn(),
  };
  const liveMetricsService = {
    getClusterSnapshot: jest.fn(),
  };

  return {
    prisma,
    service: new MonitoringService(
      prisma as unknown as PrismaService,
      clustersService as unknown as ClustersService,
      liveMetricsService as unknown as LiveMetricsService,
    ),
  };
}

describe('MonitoringService observability summary cache', () => {
  it('reuses cached summary and returns clones', async () => {
    const { service, prisma } = createService();

    const first = await service.getObservabilitySummary(timeFilter);
    first.sourceStatus[0].note = 'mutated';
    first.entities[0].deepLinks[0].label = 'mutated';
    const second = await service.getObservabilitySummary(timeFilter);

    expect(second.sourceStatus[0].note).toBe(
      '未检测到 metrics-server live metrics，指标面板降级。',
    );
    expect(second.entities[0].deepLinks[0].label).toBe('Grafana');
    expect(second).not.toBe(first);
    expect(second.entities[0]).not.toBe(first.entities[0]);
    expect(prisma.monitoringAlert.count).toHaveBeenCalledTimes(3);
    expect(prisma.monitoringAlert.findMany).toHaveBeenCalledTimes(3);
  });

  it('deduplicates in-flight summary work for the same time filter', async () => {
    const { service, prisma } = createService();

    await Promise.all([
      service.getObservabilitySummary(timeFilter),
      service.getObservabilitySummary(timeFilter),
    ]);

    expect(prisma.monitoringAlert.count).toHaveBeenCalledTimes(3);
    expect(prisma.monitoringAlert.findMany).toHaveBeenCalledTimes(3);
  });

  it('partitions summaries and every backing query by cluster', async () => {
    const { service, prisma } = createService();
    prisma.namespaceRecord.count.mockImplementation(
      (args: { where?: { clusterId?: string } }) =>
        Promise.resolve(args.where?.clusterId === 'cluster-a' ? 2 : 7),
    );

    const first = await service.getObservabilitySummary({
      ...timeFilter,
      clusterId: 'cluster-a',
    });
    const second = await service.getObservabilitySummary({
      ...timeFilter,
      clusterId: 'cluster-b',
    });

    expect(
      first.entities.find((item) => item.scope === 'namespace')?.total,
    ).toBe(2);
    expect(
      second.entities.find((item) => item.scope === 'namespace')?.total,
    ).toBe(7);
    const namespaceCountCalls = prisma.namespaceRecord.count.mock
      .calls as unknown as Array<[{ where: { clusterId?: string } }]>;
    expect(namespaceCountCalls.map(([args]) => args.where.clusterId)).toEqual([
      'cluster-a',
      'cluster-b',
    ]);
    const alertCountCalls = prisma.monitoringAlert.count.mock
      .calls as unknown as Array<[{ where: { clusterId?: string } }]>;
    expect(
      alertCountCalls
        .map(([args]) => args.where.clusterId)
        .filter((clusterId): clusterId is string => Boolean(clusterId)),
    ).toEqual([
      'cluster-a',
      'cluster-a',
      'cluster-a',
      'cluster-b',
      'cluster-b',
      'cluster-b',
    ]);
  });

  it('keeps an empty target cluster inspection from querying alerts in other clusters', async () => {
    const { service, prisma } = createService();
    prisma.clusterRegistry.findMany.mockResolvedValue([]);

    const report = await service.getClusterInspection(
      'missing-cluster',
      undefined,
      timeFilter,
    );

    expect(report.clusterId).toBe('missing-cluster');
    const inspectionAlertCalls = prisma.monitoringAlert.findMany.mock
      .calls as unknown as Array<
      [{ where: { clusterId?: { in: string[] } }; take?: number }]
    >;
    expect(
      inspectionAlertCalls.find(([args]) => args.take === 300)?.[0].where
        .clusterId,
    ).toEqual({ in: [] });
  });

  it('keeps observability resource links inside the target workspace', async () => {
    const { service } = createService();

    const summary = await service.getObservabilitySummary({
      ...timeFilter,
      clusterId: 'cluster-a',
    });

    expect(summary.entities.map((item) => item.detailPath)).toEqual([
      '/clusters/cluster-a/overview',
      '/clusters/cluster-a/namespaces',
      '/clusters/cluster-a/workloads/pods',
      '/clusters/cluster-a/network/services',
      '/clusters/cluster-a/workloads/pods',
      '/clusters/cluster-a/nodes',
      '/clusters/cluster-a/network/services',
    ]);
  });
});
