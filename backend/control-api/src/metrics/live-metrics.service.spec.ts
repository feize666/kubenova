const mockGetPodMetrics = jest.fn();

jest.mock('@kubernetes/client-node', () => ({
  Metrics: jest.fn().mockImplementation(() => ({
    getPodMetrics: mockGetPodMetrics,
  })),
}));

import { LiveMetricsService } from './live-metrics.service';
import type { K8sClientService } from '../clusters/k8s-client.service';

type MetricsHarness = {
  snapshotCache: Map<
    string,
    {
      capturedAt: string;
      source: 'metrics-server' | 'cluster-metrics-cache' | 'none';
      available: boolean;
      freshnessWindowMs: number;
      cpuUsage: number | null;
      memoryUsage: number | null;
      pods: unknown[];
      history: unknown[];
    }
  >;
};

describe('LiveMetricsService cache bounds', () => {
  function createService() {
    const k8sClient = {
      createClient: jest.fn().mockReturnValue({}),
    } as unknown as K8sClientService;

    const service = new LiveMetricsService(k8sClient);

    return {
      service,
      harness: service as unknown as MetricsHarness,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPodMetrics.mockResolvedValue({
      items: [
        {
          metadata: { namespace: 'default', name: 'pod-1' },
          timestamp: new Date().toISOString(),
          containers: [
            {
              usage: {
                cpu: '10m',
                memory: '16Mi',
              },
            },
          ],
        },
      ],
    });
  });

  it('prunes expired cache entries before taking a new snapshot', async () => {
    const { service, harness } = createService();
    harness.snapshotCache.set('old::*', {
      capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      source: 'metrics-server',
      available: true,
      freshnessWindowMs: 60_000,
      cpuUsage: 0.01,
      memoryUsage: 1024,
      pods: [],
      history: [],
    });

    await service.getClusterSnapshot('new', 'apiVersion: v1');

    expect(harness.snapshotCache.has('old::*')).toBe(false);
    expect(harness.snapshotCache.has('new::*')).toBe(true);
  });

  it('keeps snapshot cache under the entry limit', async () => {
    const { service, harness } = createService();

    for (let index = 0; index < 205; index += 1) {
      await service.getClusterSnapshot(
        `cluster-${index}`,
        'apiVersion: v1',
        `ns-${index}`,
      );
    }

    expect(harness.snapshotCache.size).toBeLessThanOrEqual(200);
  });
});
