jest.mock('@kubernetes/client-node', () => ({}));

import { AiContextAggregatorService } from './ai-context-aggregator.service';

describe('AiContextAggregatorService', () => {
  const updatedAt = new Date('2026-09-11T01:02:03.000Z');

  function build() {
    const prisma = {
      workloadRecord: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { kind: 'Deployment', _count: { _all: 2 }, _max: { updatedAt } },
          ]),
      },
      networkResource: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { kind: 'Service', _count: { _all: 3 }, _max: { updatedAt } },
          ]),
      },
      storageResource: {
        groupBy: jest.fn().mockResolvedValue([
          {
            kind: 'PersistentVolumeClaim',
            _count: { _all: 1 },
            _max: { updatedAt: null },
          },
        ]),
      },
      configResource: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { kind: 'ConfigMap', _count: { _all: 4 }, _max: { updatedAt } },
          ]),
      },
      namespaceRecord: { count: jest.fn().mockResolvedValue(2) },
    };
    const clustersService = {
      findById: jest.fn().mockResolvedValue({
        id: 'cluster-1',
        name: 'production',
        state: 'active',
        provider: '阿里云 ACK',
        environment: 'production',
        kubernetesVersion: 'v1.30.4',
      }),
    };
    const healthService = {
      getClusterHealthDetail: jest.fn().mockResolvedValue({
        summary: {
          ok: true,
          runtimeStatus: 'running',
          latencyMs: 42,
          checkedAt: updatedAt.toISOString(),
          reason: null,
          isStale: false,
        },
        detail: {
          failureCount: 0,
          payload: {
            version: 'v1.30.4',
            nodeCount: 3,
            apiServer: 'https://private.example',
          },
        },
      }),
    };
    const monitoringService = {
      getAlerts: jest.fn().mockResolvedValue({
        total: 2,
        degraded: false,
        items: [
          {
            severity: 'critical',
            title: 'Pod restart',
            message: 'restart count 10',
            namespace: 'default',
            resourceType: 'Pod',
            resourceName: 'api',
            firedAt: updatedAt.toISOString(),
          },
          {
            severity: 'warning',
            title: 'CPU high',
            message: 'token=do-not-leak',
            namespace: null,
            resourceType: null,
            resourceName: null,
            firedAt: updatedAt.toISOString(),
          },
        ],
      }),
      getEvents: jest.fn().mockResolvedValue({
        total: 1,
        degraded: false,
        items: [
          {
            level: 'WARN',
            source: 'kubelet',
            message: 'Authorization: Bearer secret-value',
            timestamp: updatedAt.toISOString(),
          },
        ],
      }),
    };
    const topologyGraphService = {
      getGraphV2: jest.fn().mockResolvedValue({
        resources: [{ kind: 'Deployment' }, { kind: 'Service' }],
        relations: [{ type: 'SELECTS' }, { type: 'ROUTES_TO' }],
        coverage: {
          sources: {
            workloads: {
              records: 1,
              status: 'complete',
              dataAsOf: updatedAt.toISOString(),
            },
            network: {
              records: 1,
              status: 'complete',
              dataAsOf: updatedAt.toISOString(),
            },
          },
          warningRecords: 0,
        },
        dataAsOf: updatedAt.toISOString(),
        freshness: { status: 'fresh' },
      }),
    };
    return {
      service: new AiContextAggregatorService(
        prisma as never,
        clustersService as never,
        healthService as never,
        monitoringService as never,
        topologyGraphService as never,
      ),
      prisma,
      monitoringService,
      topologyGraphService,
    };
  }

  it('aggregates safe health, inventory, alerts, events and topology summaries', async () => {
    const { service, prisma, monitoringService, topologyGraphService } =
      build();
    const context = await service.collect(' cluster-1 ', {
      evidence: {
        symptom: 'slow',
        apiKey: 'must-not-appear',
        nested: { token: 'also-secret' },
      },
    });

    expect(prisma.workloadRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['kind'] }),
    );
    expect(monitoringService.getAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'cluster-1', status: 'firing' }),
    );
    expect(topologyGraphService.getGraphV2).toHaveBeenCalledWith({
      clusterId: 'cluster-1',
    });
    expect(context.cluster).toEqual(
      expect.objectContaining({ id: 'cluster-1', provider: '阿里云 ACK' }),
    );
    expect(context.health).toEqual(
      expect.objectContaining({ ok: true, nodeCount: 3, version: 'v1.30.4' }),
    );
    expect(context.resources).toEqual(
      expect.objectContaining({
        total: 10,
        namespaces: 2,
        byKind: {
          ConfigMap: 4,
          Deployment: 2,
          PersistentVolumeClaim: 1,
          Service: 3,
        },
      }),
    );
    expect(context.alerts).toEqual(
      expect.objectContaining({ activeTotal: 2, critical: 1, warning: 1 }),
    );
    expect(context.events.total).toBe(1);
    expect(context.topology).toEqual(
      expect.objectContaining({
        resourceCount: 2,
        relationCount: 2,
        relationsByType: { ROUTES_TO: 1, SELECTS: 1 },
      }),
    );
    expect(JSON.stringify(context)).not.toContain('must-not-appear');
    expect(JSON.stringify(context)).not.toContain('also-secret');
    expect(JSON.stringify(context)).not.toContain('secret-value');
    expect(JSON.stringify(context)).not.toContain('private.example');
  });

  it('degrades each unavailable source without failing analysis', async () => {
    const { service } = build();
    const context = await service.collect('cluster-1', {
      evidence: { issue: 'offline' },
    });
    // The first build is healthy; force all dependent calls to fail for this run.
    const failing = build();
    (failing as any).service['clustersService'].findById.mockRejectedValue(
      new Error('db unavailable'),
    );
    (failing as any).service[
      'clusterHealthService'
    ].getClusterHealthDetail.mockRejectedValue(new Error('health timeout'));
    (failing as any).service['monitoringService'].getAlerts.mockRejectedValue(
      new Error('alerts timeout'),
    );
    (failing as any).service['monitoringService'].getEvents.mockRejectedValue(
      new Error('events timeout'),
    );
    (failing as any).service[
      'topologyGraphService'
    ].getGraphV2.mockRejectedValue(new Error('topology timeout'));
    for (const model of [
      'workloadRecord',
      'networkResource',
      'storageResource',
      'configResource',
    ]) {
      (failing as any).service['prisma'][model].groupBy.mockRejectedValue(
        new Error('inventory timeout'),
      );
    }
    (failing as any).service['prisma'].namespaceRecord.count.mockRejectedValue(
      new Error('inventory timeout'),
    );
    const degraded = await failing.service.collect('cluster-1', {
      evidence: { issue: 'offline' },
    });

    expect(context.degradedSources).toEqual([]);
    expect(degraded.degradedSources).toEqual([
      'alerts',
      'cluster',
      'events',
      'health',
      'resources',
      'topology',
    ]);
    expect(degraded.resources.degraded).toBe(true);
    expect(degraded.health.status).toBe('unknown');
    expect(degraded.alerts.items).toHaveLength(0);
  });

  it('sanitizes untrusted supplemental evidence with bounded depth and sensitive keys', () => {
    const safe = AiContextAggregatorService.sanitizeEvidence({
      apiKey: 'redact',
      plain: 'Bearer abc123',
      list: Array.from({ length: 30 }, (_, index) => index),
      nested: { password: 'redact', value: 'ok' },
    });
    expect(safe).toEqual(
      expect.objectContaining({
        apiKey: '[REDACTED]',
        plain: 'Bearer [REDACTED]',
      }),
    );
    expect((safe.list as unknown[]).length).toBe(20);
    expect((safe.nested as Record<string, unknown>).password).toBe(
      '[REDACTED]',
    );
  });
});
