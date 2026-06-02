jest.mock('@kubernetes/client-node', () => ({}));

import { MonitoringController } from './monitoring.controller';

describe('MonitoringController', () => {
  it('forwards observability summary time filters', async () => {
    const monitoringService = {
      getObservabilitySummary: jest.fn().mockResolvedValue({
        range: '1h',
        timestamp: new Date().toISOString(),
        timeRange: {
          from: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          to: new Date('2026-01-01T01:00:00.000Z').toISOString(),
        },
        healthScore: 90,
        activeAlerts: {
          critical: 0,
          warning: 1,
          total: 1,
          source: 'monitoring-alert',
          degraded: false,
        },
        sourceStatus: [],
        entities: [],
        signalPanels: [],
        recentEvents: [],
        externalLinks: [],
        degraded: false,
      }),
    };
    const controller = new MonitoringController(monitoringService as never);

    await controller.getObservabilitySummary(
      '1h',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
    );

    expect(monitoringService.getObservabilitySummary).toHaveBeenCalledWith({
      range: '1h',
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-01T01:00:00.000Z'),
    });
  });
});
