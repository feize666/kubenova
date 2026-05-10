jest.mock('@kubernetes/client-node', () => ({}));

import { ClusterHealthSchedulerService } from './cluster-health-scheduler.service';

describe('ClusterHealthSchedulerService', () => {
  it('probes active clusters with kubeconfig in cycle', async () => {
    const clustersService = {
      list: jest.fn().mockResolvedValue({
        items: [
          { id: 'a', state: 'active', hasKubeconfig: true },
          { id: 'b', state: 'active', hasKubeconfig: false },
          { id: 'c', state: 'disabled', hasKubeconfig: true },
        ],
      }),
    } as any;
    const clusterHealthService = {
      probeCluster: jest.fn().mockResolvedValue(null),
    } as any;

    const service = new ClusterHealthSchedulerService(
      clustersService,
      clusterHealthService,
    ) as any;

    await service.runCycle('interval');

    expect(clusterHealthService.probeCluster).toHaveBeenCalledTimes(1);
    expect(clusterHealthService.probeCluster).toHaveBeenCalledWith('a', {
      source: 'auto',
    });
  });
});
