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
});
