jest.mock('@kubernetes/client-node', () => ({}));

import { ClusterHealthService } from './cluster-health.service';

describe('ClusterHealthService', () => {
  function createService() {
    const prisma = {
      clusterHealthSnapshot: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    } as any;
    const clustersService = {
      findById: jest.fn(),
      getKubeconfig: jest.fn(),
    } as any;
    const k8sClientService = {
      createClient: jest.fn(),
    } as any;
    return new ClusterHealthService(prisma, clustersService, k8sClientService);
  }

  it('resolveRuntimeStatus returns expected states', () => {
    const service = createService();
    const now = new Date();

    expect(
      service.resolveRuntimeStatus({
        state: 'disabled',
        hasKubeconfig: true,
        snapshot: { ok: true, checkedAt: now },
      }),
    ).toBe('disabled');

    expect(
      service.resolveRuntimeStatus({
        state: 'active',
        hasKubeconfig: false,
        snapshot: null,
      }),
    ).toBe('offline-mode');

    expect(
      service.resolveRuntimeStatus({
        state: 'active',
        hasKubeconfig: true,
        snapshot: null,
      }),
    ).toBe('checking');

    expect(
      service.resolveRuntimeStatus({
        state: 'active',
        hasKubeconfig: true,
        snapshot: { ok: true, checkedAt: now },
      }),
    ).toBe('running');

    expect(
      service.resolveRuntimeStatus({
        state: 'active',
        hasKubeconfig: true,
        snapshot: { ok: false, checkedAt: now },
      }),
    ).toBe('offline');
  });

  it('probeCluster de-duplicates in-flight probe for same cluster', async () => {
    const service = createService() as any;
    let runCount = 0;

    service.runProbe = jest.fn(async () => {
      runCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        clusterId: 'c1',
        ok: true,
        status: 'running',
        latencyMs: 10,
        checkedAt: new Date().toISOString(),
        reason: null,
        source: 'manual',
        timeoutMs: 8000,
        failureCount: 0,
        detailJson: null,
        isStale: false,
      };
    });

    const [a, b] = await Promise.all([
      service.probeCluster('c1', { source: 'manual' }),
      service.probeCluster('c1', { source: 'manual' }),
    ]);

    expect(runCount).toBe(1);
    expect(a.clusterId).toBe('c1');
    expect(b.clusterId).toBe('c1');
  });

  it('assertClusterOnlineForRead accepts stale running snapshot and probes in background', async () => {
    const service = createService() as any;
    service.requireCluster = jest.fn().mockResolvedValue({
      id: 'c1',
      state: 'active',
      hasKubeconfig: true,
    });
    service.getLatestSnapshot = jest.fn().mockResolvedValue({
      clusterId: 'c1',
      ok: true,
      status: 'running',
      latencyMs: 5,
      checkedAt: new Date(Date.now() - 120_000).toISOString(),
      reason: null,
      source: 'auto',
      timeoutMs: 8000,
      failureCount: 0,
      detailJson: null,
      isStale: true,
    });
    service.probeCluster = jest.fn().mockResolvedValue({
      clusterId: 'c1',
      ok: true,
      status: 'running',
      latencyMs: 20,
      checkedAt: new Date().toISOString(),
      reason: null,
      source: 'auto',
      timeoutMs: 5000,
      failureCount: 0,
      detailJson: null,
      isStale: false,
    });

    await expect(
      service.assertClusterOnlineForRead('c1'),
    ).resolves.toBeUndefined();
    expect(service.probeCluster).toHaveBeenCalledWith('c1', {
      source: 'auto',
      timeoutMs: 5000,
    });
  });

  it('getLegacyHealthResult uses fresh snapshot without probing', async () => {
    const service = createService() as any;
    service.requireCluster = jest.fn().mockResolvedValue({
      id: 'c1',
      kubernetesVersion: 'v1.29.0',
    });
    service.getLatestSnapshot = jest.fn().mockResolvedValue({
      clusterId: 'c1',
      ok: true,
      status: 'running',
      latencyMs: 23,
      checkedAt: new Date().toISOString(),
      reason: null,
      source: 'auto',
      timeoutMs: 8000,
      failureCount: 0,
      detailJson: { version: 'v1.30.0', nodeCount: 6 },
      isStale: false,
    });
    service.probeCluster = jest.fn();

    const result = await service.getLegacyHealthResult('c1');

    expect(service.probeCluster).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      latencyMs: 23,
      version: 'v1.30.0',
      nodeCount: 6,
      message: '集群连接正常',
    });
  });

  it('getLegacyHealthResult probes when snapshot is stale', async () => {
    const service = createService() as any;
    service.requireCluster = jest.fn().mockResolvedValue({
      id: 'c1',
      kubernetesVersion: 'v1.29.0',
    });
    service.getLatestSnapshot = jest.fn().mockResolvedValue({
      clusterId: 'c1',
      ok: true,
      status: 'running',
      latencyMs: 10,
      checkedAt: new Date(Date.now() - 180_000).toISOString(),
      reason: null,
      source: 'auto',
      timeoutMs: 8000,
      failureCount: 0,
      detailJson: { version: 'v1.28.0', nodeCount: 3 },
      isStale: true,
    });
    service.probeCluster = jest.fn().mockResolvedValue({
      clusterId: 'c1',
      ok: false,
      status: 'offline',
      latencyMs: 91,
      checkedAt: new Date().toISOString(),
      reason: 'dial timeout',
      source: 'auto',
      timeoutMs: 8000,
      failureCount: 2,
      detailJson: { nodeCount: 3 },
      isStale: false,
    });

    const result = await service.getLegacyHealthResult('c1');

    expect(service.probeCluster).toHaveBeenCalledWith('c1', { source: 'auto' });
    expect(result).toEqual({
      ok: false,
      latencyMs: 91,
      version: null,
      nodeCount: 3,
      message: '集群连接异常: dial timeout',
    });
  });
});
