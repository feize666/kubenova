jest.mock('@kubernetes/client-node', () => ({}));

import { TopologyGraphController } from './topology-graph.controller';
import type { TopologyGraphService } from './topology-graph.service';

describe('TopologyGraphController', () => {
  it('trims clusterId before delegating', async () => {
    const response = {
      resources: [],
      relations: [],
      coverage: {},
      timestamp: '',
    };
    const getGraph = jest.fn().mockResolvedValue(response);
    const service = { getGraph } as unknown as TopologyGraphService;
    const controller = new TopologyGraphController(service);

    await expect(controller.getGraph(' c-1 ')).resolves.toBe(response);
    expect(getGraph).toHaveBeenCalledWith({ clusterId: 'c-1' });
  });

  it('delegates the normalized single-cluster V2 query', async () => {
    const response = {
      schemaVersion: '2.0',
      resources: [],
      relations: [],
    };
    const getGraphV2 = jest.fn().mockResolvedValue(response);
    const service = { getGraphV2 } as unknown as TopologyGraphService;
    const controller = new TopologyGraphController(service);

    await expect(
      controller.getGraphV2(' c-1 ', ' app ', 'workloads, network'),
    ).resolves.toBe(response);
    expect(getGraphV2).toHaveBeenCalledWith({
      clusterId: 'c-1',
      namespace: 'app',
      sources: ['workloads', 'network'],
    });
  });
});
