jest.mock('@kubernetes/client-node', () => ({}));

import { AiopsService } from './aiops.service';
import { AuthorizationService } from '../common/authorization.service';

describe('AiopsService', () => {
  it('requires a matching mutation grant rather than the platform operator role alone', async () => {
    let role = 'viewer';
    const authorization = new AuthorizationService({
      groupMembership: { findMany: async () => [] },
      accessGrant: { findMany: async () => [{
        id: 'grant', userId: 'operator', groupId: null, clusterId: 'cluster', role,
        state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null,
        namespaces: [{ namespaceUid: 'uid' }], capabilities: [],
      }] },
    } as never);
    const base = createService({ getAlerts: jest.fn().mockResolvedValue({
      items: [{ id: 'a', clusterId: 'cluster', namespace: 'ai', resourceType: 'Pod',
        resourceName: 'pod', severity: 'critical', title: 'issue', firedAt: '2026-01-01' }],
      dataSource: 'monitoring-alert', degraded: false,
    }) });
    const monitoring = (base as unknown as { monitoringService: never }).monitoringService;
    const service = new AiopsService(monitoring, authorization, undefined,
      { resolve: async () => 'uid' } as never);
    const actor = { id: 'operator', role: 'cluster-operator' as const };
    await expect(service.approveRecommendation('rec:alert:a', actor)).rejects.toThrow();
    role = 'operator';
    await expect(service.approveRecommendation('rec:alert:a', actor)).resolves.toMatchObject({
      approved: true, executionStatus: 'not-executed',
    });
  });

  it('forwards the subject and does not reuse user summaries after revocation', async () => {
    const actor = { id: 'reader', role: 'read-only' };
    let revoked = false;
    const service = createService({
      getAlerts: jest.fn().mockImplementation((_filter, subject) => {
        if (subject?.id !== 'reader' || revoked) throw new Error('forbidden');
        return { items: [], dataSource: 'workload-derived', degraded: true };
      }),
    });
    await expect(Reflect.apply(service.getSummary, service, [{}, actor])).resolves.toHaveProperty('incidentQueue');
    revoked = true;
    await expect(Reflect.apply(service.getSummary, service, [{}, actor])).rejects.toThrow('forbidden');
  });

  it('rejects missing and unknown HTTP subjects before reading monitoring', async () => {
    const service = createService();
    for (const actor of [{}, { id: 'reader', role: 'unknown' }]) {
      await expect(Reflect.apply(service.getSummary, service, [{}, actor])).rejects.toThrow();
    }
  });

  it('does not approve arbitrary recommendation identifiers', async () => {
    const service = createService();
    await expect(Promise.resolve().then(() => Reflect.apply(service.approveRecommendation, service, [
      'rec:alert:foreign', { id: 'admin', role: 'platform-admin' },
    ]))).rejects.toThrow();
  });

  function createService(overrides: Partial<Record<string, jest.Mock>> = {}) {
    const monitoringService = {
      getObservabilitySummary: jest.fn().mockResolvedValue({
        range: '24h',
        timestamp: new Date().toISOString(),
        activeAlerts: { degraded: true },
        degraded: true,
      }),
      getAlerts: jest.fn().mockResolvedValue({
        items: [],
        dataSource: 'workload-derived',
        degraded: true,
      }),
      getClusterInspection: jest.fn().mockResolvedValue({
        timestamp: '2026-01-01T00:00:00.000Z',
        items: [
          {
            id: 'duplicate',
            title: 'first issue',
            severity: 'warning',
            resourceRef: 'test/default/Deployment/api',
            evidence: 'first',
          },
          {
            id: 'duplicate',
            title: 'second issue',
            severity: 'warning',
            resourceRef: 'test/default/Service/api',
            evidence: 'second',
          },
        ],
      }),
      ...overrides,
    };

    return new AiopsService(monitoringService as never);
  }

  it('deduplicates derived incident ids before returning summary rows', async () => {
    const service = createService();

    const summary = await service.getSummary({ range: '24h' });

    expect(summary.incidentQueue.map((item) => item.id)).toEqual([
      'inspection:duplicate',
      'inspection:duplicate:2',
    ]);
    expect(summary.recommendations.map((item) => item.id)).toEqual([
      'rec:inspection:duplicate',
      'rec:inspection:duplicate:2',
    ]);
    expect(summary.rootCauseCandidates.map((item) => item.incidentId)).toEqual([
      'inspection:duplicate',
      'inspection:duplicate:2',
    ]);
  });

  it('reuses cached summary and returns clones', async () => {
    const service = createService();

    const first = await service.getSummary({ range: '24h' });
    first.incidentQueue[0].title = 'mutated';
    const second = await service.getSummary({ range: '24h' });

    expect(second.incidentQueue[0].title).toBe('first issue');
    expect(second).not.toBe(first);
    expect(second.incidentQueue[0]).not.toBe(first.incidentQueue[0]);
    expect(
      (service as unknown as { monitoringService: Record<string, jest.Mock> })
        .monitoringService.getObservabilitySummary,
    ).toHaveBeenCalledTimes(1);
  });

  it('deduplicates in-flight summary work for the same time filter', async () => {
    let resolveObservability: (value: unknown) => void = () => undefined;
    const observability = new Promise((resolve) => {
      resolveObservability = resolve;
    });
    const service = createService({
      getObservabilitySummary: jest.fn().mockReturnValue(observability),
    });

    const first = service.getSummary({ range: '24h' });
    const second = service.getSummary({ range: '24h' });

    resolveObservability({
      range: '24h',
      timestamp: new Date().toISOString(),
      activeAlerts: { degraded: true },
      degraded: true,
    });
    await Promise.all([first, second]);

    const harness = service as unknown as {
      monitoringService: Record<string, jest.Mock>;
    };
    expect(
      harness.monitoringService.getObservabilitySummary,
    ).toHaveBeenCalledTimes(1);
    expect(harness.monitoringService.getAlerts).toHaveBeenCalledTimes(1);
    expect(
      harness.monitoringService.getClusterInspection,
    ).toHaveBeenCalledTimes(1);
  });

  it('partitions cached summaries by cluster and forwards the target scope', async () => {
    const service = createService({
      getObservabilitySummary: jest
        .fn()
        .mockImplementation((filter: { clusterId?: string }) =>
          Promise.resolve({
            range: '24h',
            timestamp: new Date().toISOString(),
            activeAlerts: { degraded: true },
            degraded: true,
            note: filter.clusterId,
          }),
        ),
    });

    const first = await service.getSummary({
      range: '24h',
      clusterId: 'cluster-a',
    });
    const second = await service.getSummary({
      range: '24h',
      clusterId: 'cluster-b',
    });

    expect(first.note).toBe('cluster-a');
    expect(second.note).toBe('cluster-b');
    const harness = service as unknown as {
      monitoringService: Record<string, jest.Mock>;
    };
    expect(harness.monitoringService.getAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'cluster-a' }),
      undefined,
    );
    expect(harness.monitoringService.getAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'cluster-b' }),
      undefined,
    );
    expect(harness.monitoringService.getClusterInspection).toHaveBeenCalledWith(
      'cluster-a',
      undefined,
      expect.objectContaining({ clusterId: 'cluster-a' }),
      undefined,
    );
    expect(harness.monitoringService.getClusterInspection).toHaveBeenCalledWith(
      'cluster-b',
      undefined,
      expect.objectContaining({ clusterId: 'cluster-b' }),
      undefined,
    );
  });

  it('does not build incidents or recommendations from another cluster', async () => {
    const service = createService({
      getAlerts: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'a1',
            clusterId: 'cluster-a',
            namespace: 'default',
            severity: 'critical',
            title: 'cluster-a issue',
            resourceType: 'Deployment',
            resourceName: 'api-a',
            firedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'b1',
            clusterId: 'cluster-b',
            namespace: 'default',
            severity: 'critical',
            title: 'cluster-b issue',
            resourceType: 'Deployment',
            resourceName: 'api-b',
            firedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        dataSource: 'monitoring-alert',
        degraded: false,
      }),
      getClusterInspection: jest.fn().mockResolvedValue({
        timestamp: '2026-01-01T00:00:00.000Z',
        items: [
          {
            id: 'i-a',
            clusterId: 'cluster-a',
            title: 'inspection a',
            severity: 'warning',
            resourceRef: 'cluster-a/default/Pod/api-a',
          },
          {
            id: 'i-b',
            clusterId: 'cluster-b',
            title: 'inspection b',
            severity: 'warning',
            resourceRef: 'cluster-b/default/Pod/api-b',
          },
        ],
      }),
    });

    const summary = await service.getSummary({
      range: '24h',
      clusterId: 'cluster-a',
    });

    expect(summary.incidentQueue.map((item) => item.title)).toEqual([
      'cluster-a issue',
      'inspection a',
    ]);
    expect(summary.recommendations).toHaveLength(2);
    expect(
      summary.recommendations.every((item) => !item.id.includes('b1')),
    ).toBe(true);
  });
});
