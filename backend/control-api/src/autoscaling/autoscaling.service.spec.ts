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
      readNamespacedHorizontalPodAutoscaler: jest.fn(),
      replaceNamespacedHorizontalPodAutoscaler: jest.fn(),
      createNamespacedHorizontalPodAutoscaler: jest.fn(),
    };
    const customApi = {
      getNamespacedCustomObject: jest.fn(),
      replaceNamespacedCustomObject: jest.fn(),
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

  function makeHpaResource(name: string) {
    return {
      metadata: {
        name,
        namespace: 'default',
        resourceVersion: 'rv-1',
      },
      spec: {
        scaleTargetRef: {
          kind: 'Deployment',
          name: 'web',
        },
        minReplicas: 1,
        maxReplicas: 3,
        metrics: [
          {
            type: 'Resource',
            resource: {
              name: 'cpu',
              target: {
                type: 'Utilization',
                averageUtilization: 60,
              },
            },
          },
        ],
      },
    };
  }

  function makeVpaResource(name: string) {
    return {
      metadata: {
        name,
        namespace: 'default',
        resourceVersion: 'rv-1',
      },
      spec: {
        targetRef: {
          kind: 'Deployment',
          name: 'web',
        },
        updatePolicy: {
          updateMode: 'Auto',
        },
        resourcePolicy: {
          containerPolicies: [
            {
              controlledResources: ['cpu', 'memory'],
            },
          ],
        },
      },
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

  it('updates HPA without changing the resource name suffix', async () => {
    const { service, clustersService, hpaApi } = build();
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig',
    );
    hpaApi.readNamespacedHorizontalPodAutoscaler.mockResolvedValue(
      makeHpaResource('web-hpa'),
    );
    hpaApi.replaceNamespacedHorizontalPodAutoscaler.mockResolvedValue(
      makeHpaResource('web-hpa'),
    );

    await service.update(
      { username: 'alice', role: 'platform-admin' },
      'HPA',
      'Deployment',
      'web-hpa',
      { clusterId: 'c-1', namespace: 'default' },
      { hpa: { minReplicas: 2 } },
    );

    expect(hpaApi.replaceNamespacedHorizontalPodAutoscaler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'web-hpa',
        namespace: 'default',
        body: expect.objectContaining({
          spec: expect.objectContaining({
            scaleTargetRef: expect.objectContaining({
              name: 'web',
            }),
          }),
          metadata: expect.objectContaining({
            name: 'web-hpa',
            namespace: 'default',
          }),
        }),
      }),
    );
  });

  it('updates VPA without appending the suffix twice', async () => {
    const { service, clustersService, customApi } = build();
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig',
    );
    customApi.getNamespacedCustomObject.mockResolvedValue(
      makeVpaResource('web-vpa'),
    );
    customApi.replaceNamespacedCustomObject.mockResolvedValue(
      makeVpaResource('web-vpa'),
    );

    await service.update(
      { username: 'alice', role: 'platform-admin' },
      'VPA',
      'Deployment',
      'web-vpa',
      { clusterId: 'c-1', namespace: 'default' },
      { vpa: { updateMode: 'Initial' } },
    );

    expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'web-vpa',
        namespace: 'default',
        plural: 'verticalpodautoscalers',
        body: expect.objectContaining({
          spec: expect.objectContaining({
            targetRef: expect.objectContaining({
              name: 'web',
            }),
          }),
          metadata: expect.objectContaining({
            name: 'web-vpa',
            namespace: 'default',
          }),
        }),
      }),
    );
  });

  it('creates autoscaling resources without doubling existing suffixes', async () => {
    const { service, clustersService, hpaApi, customApi } = build();
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig',
    );
    hpaApi.createNamespacedHorizontalPodAutoscaler.mockResolvedValue(
      makeHpaResource('web-hpa'),
    );
    customApi.createNamespacedCustomObject.mockResolvedValue(
      makeVpaResource('web-vpa'),
    );

    await service.create(
      { username: 'alice', role: 'platform-admin' },
      {
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Deployment',
        name: 'web-hpa',
        type: 'HPA',
        hpa: { minReplicas: 1, maxReplicas: 2 },
      },
    );

    await service.create(
      { username: 'alice', role: 'platform-admin' },
      {
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Deployment',
        name: 'web-vpa',
        type: 'VPA',
        vpa: { updateMode: 'Auto' },
      },
    );

    expect(hpaApi.createNamespacedHorizontalPodAutoscaler).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          metadata: expect.objectContaining({
            name: 'web-hpa',
          }),
        }),
      }),
    );
    expect(customApi.createNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          metadata: expect.objectContaining({
            name: 'web-vpa',
          }),
        }),
      }),
    );
  });

  it('creates autoscaling resources from workload name with expected suffixes', async () => {
    const { service, clustersService, hpaApi, customApi } = build();
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig',
    );
    hpaApi.createNamespacedHorizontalPodAutoscaler.mockResolvedValue(
      makeHpaResource('web-hpa'),
    );
    customApi.createNamespacedCustomObject.mockResolvedValue(
      makeVpaResource('web-vpa'),
    );

    await service.create(
      { username: 'alice', role: 'platform-admin' },
      {
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Deployment',
        name: 'web',
        type: 'HPA',
        hpa: { minReplicas: 1, maxReplicas: 2 },
      },
    );

    await service.create(
      { username: 'alice', role: 'platform-admin' },
      {
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Deployment',
        name: 'web',
        type: 'VPA',
        vpa: { updateMode: 'Auto' },
      },
    );

    expect(hpaApi.createNamespacedHorizontalPodAutoscaler).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'default',
        body: expect.objectContaining({
          metadata: expect.objectContaining({
            name: 'web-hpa',
            namespace: 'default',
          }),
        }),
      }),
    );
    expect(customApi.createNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'default',
        plural: 'verticalpodautoscalers',
        body: expect.objectContaining({
          metadata: expect.objectContaining({
            name: 'web-vpa',
            namespace: 'default',
          }),
        }),
      }),
    );
  });

  it('updates HPA with the exact resource name', async () => {
    const { service, clustersService, hpaApi } = build();
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue('kubeconfig');
    hpaApi.readNamespacedHorizontalPodAutoscaler.mockResolvedValue(
      makeHpaResource('web-hpa'),
    );
    hpaApi.replaceNamespacedHorizontalPodAutoscaler.mockResolvedValue(
      makeHpaResource('web-hpa'),
    );

    await service.update(
      { username: 'alice', role: 'platform-admin' },
      'HPA',
      'Deployment',
      'web-hpa',
      { clusterId: 'c-1', namespace: 'default' },
      { hpa: { minReplicas: 2 } },
    );

    expect(hpaApi.replaceNamespacedHorizontalPodAutoscaler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'web-hpa',
        body: expect.objectContaining({
          metadata: expect.objectContaining({ name: 'web-hpa' }),
        }),
      }),
    );
  });

  it('updates VPA with the exact resource name', async () => {
    const { service, clustersService, customApi } = build();
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue('kubeconfig');
    customApi.getNamespacedCustomObject.mockResolvedValue(
      makeVpaResource('web-vpa'),
    );
    customApi.replaceNamespacedCustomObject.mockResolvedValue(
      makeVpaResource('web-vpa'),
    );

    await service.update(
      { username: 'alice', role: 'platform-admin' },
      'VPA',
      'Deployment',
      'web-vpa',
      { clusterId: 'c-1', namespace: 'default' },
      { vpa: { updateMode: 'Initial' } },
    );

    expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'web-vpa',
        body: expect.objectContaining({
          metadata: expect.objectContaining({ name: 'web-vpa' }),
        }),
      }),
    );
  });
});
