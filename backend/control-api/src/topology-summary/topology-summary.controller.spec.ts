jest.mock('@kubernetes/client-node', () => ({}));

import { TopologySummaryController } from './topology-summary.controller';
import type { TopologySummaryService } from './topology-summary.service';

describe('TopologySummaryController', () => {
  it('trims clusterId and delegates namespace summary query', async () => {
    const response = { items: [], timestamp: '2026-01-01T00:00:00.000Z' };
    const service = {
      listNamespaceSummaries: jest.fn().mockResolvedValue(response),
    } as unknown as TopologySummaryService;
    const controller = new TopologySummaryController(service);

    await expect(controller.listNamespaceSummaries(' c-1 ')).resolves.toBe(
      response,
    );
    expect(service.listNamespaceSummaries).toHaveBeenCalledWith({
      clusterId: 'c-1',
    });
  });

  it('passes undefined clusterId for all readable clusters', async () => {
    const service = {
      listNamespaceSummaries: jest.fn().mockResolvedValue({
        items: [],
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    } as unknown as TopologySummaryService;
    const controller = new TopologySummaryController(service);

    await controller.listNamespaceSummaries('  ');

    expect(service.listNamespaceSummaries).toHaveBeenCalledWith({
      clusterId: undefined,
    });
  });
});
