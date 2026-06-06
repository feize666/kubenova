jest.mock('@kubernetes/client-node', () => ({}));

import { AiopsService } from './aiops.service';

describe('AiopsService', () => {
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
});
