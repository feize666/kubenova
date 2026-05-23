jest.mock('@kubernetes/client-node', () => ({}));

import { ClusterHealthSchedulerService } from './cluster-health-scheduler.service';

describe('ClusterHealthSchedulerService', () => {
  it('probes active clusters with kubeconfig in cycle', async () => {
    const clusterHealthService = {
      listClustersNeedingBackgroundProbe: jest.fn().mockResolvedValue(['a']),
      probeCluster: jest.fn().mockResolvedValue(null),
    } as any;

    const service = new ClusterHealthSchedulerService(
      clusterHealthService,
    ) as any;

    await service.runCycle('interval');

    expect(
      clusterHealthService.listClustersNeedingBackgroundProbe,
    ).toHaveBeenCalledWith(10 * 60_000);
    expect(clusterHealthService.probeCluster).toHaveBeenCalledTimes(1);
    expect(clusterHealthService.probeCluster).toHaveBeenCalledWith('a', {
      source: 'auto',
    });
  });
});
