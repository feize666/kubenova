jest.mock('@kubernetes/client-node', () => ({
  KubernetesObjectApi: {
    makeApiClient: jest.fn().mockReturnValue({
      read: jest.fn().mockResolvedValue({}),
    }),
  },
}));

import { ConflictException } from '@nestjs/common';
import { AutoscalingService } from './autoscaling.service';
import type { ClustersService } from '../clusters/clusters.service';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { K8sClientService } from '../clusters/k8s-client.service';

describe('AutoscalingService list and create guards', () => {
  function build() {
    const clustersService = {
      list: jest.fn(),
      getKubeconfig: jest.fn(),
    } as unknown as ClustersService;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    } as unknown as ClusterHealthService;
    const hpaApi = {
      createNamespacedHorizontalPodAutoscaler: jest.fn(),
    };
    const customApi = {
      createNamespacedCustomObject: jest.fn(),
    };
    const k8sClientService = {
      createClient: jest.fn().mockReturnValue({
        makeApiClient: jest.fn().mockReturnValue(hpaApi),
      }),
      getCustomObjectsApi: jest.fn().mockReturnValue(customApi),
    } as unknown as K8sClientService;
    const service = new AutoscalingService(
      clustersService,
      clusterHealthService,
      k8sClientService,
    );

    return {
      service,
      clustersService,
      clusterHealthService,
      hpaApi,
      customApi,
    };
  }

  it('falls back to paging all readable clusters when permission gate returns none', async () => {
    const { service, clustersService, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue([]);
    const firstPageItems = Array.from({ length: 200 }, (_, index) => ({
      id: `c-${index + 1}`,
      state: 'active',
      hasKubeconfig: index % 2 === 0,
    }));
    (clustersService.list as jest.Mock)
      .mockResolvedValueOnce({ items: firstPageItems })
      .mockResolvedValueOnce({
        items: [{ id: 'c-201', state: 'active', hasKubeconfig: true }],
      });
    jest.spyOn(service as any, 'listHpas').mockResolvedValue([]);
    jest.spyOn(service as any, 'listVpas').mockResolvedValue([]);

    await service.list({});

    expect(clustersService.list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ page: '1', pageSize: '200', state: 'active' }),
    );
    expect(clustersService.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: '2', pageSize: '200', state: 'active' }),
    );
  });

  it('throws conflict when HPA creation hits already exists', async () => {
    const { service, clustersService, hpaApi } = build();
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig',
    );
    hpaApi.createNamespacedHorizontalPodAutoscaler.mockRejectedValue({
      response: { statusCode: 409 },
    });

    await expect(
      service.create(
        { username: 'alice', role: 'platform-admin' },
        {
          clusterId: 'c-1',
          namespace: 'default',
          kind: 'Deployment',
          name: 'web',
          type: 'HPA',
          hpa: { minReplicas: 1, maxReplicas: 2 },
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws conflict when VPA creation reports AlreadyExists', async () => {
    const { service, clustersService, customApi } = build();
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig',
    );
    customApi.createNamespacedCustomObject.mockRejectedValue({
      response: { body: { reason: 'AlreadyExists' } },
    });

    await expect(
      service.create(
        { username: 'alice', role: 'platform-admin' },
        {
          clusterId: 'c-1',
          namespace: 'default',
          kind: 'Deployment',
          name: 'web',
          type: 'VPA',
          vpa: { updateMode: 'Auto' },
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
