jest.mock('@kubernetes/client-node', () => ({
  KubernetesObjectApi: {
    makeApiClient: jest.fn((kc: { __api?: unknown }) => kc.__api),
  },
}));

import { ResourcesService } from './resources.service';
import type { ClustersService } from '../clusters/clusters.service';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { K8sClientService } from '../clusters/k8s-client.service';

type MockedPrisma = {
  workloadRecord: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  networkResource: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  storageResource: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  configResource: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  apiResourceCapability?: {
    findFirst: jest.Mock;
  };
};

function buildService(prisma: MockedPrisma): ResourcesService {
  return new ResourcesService(
    {} as ClustersService,
    {
      assertClusterOnlineForRead: jest.fn().mockResolvedValue(undefined),
    } as unknown as ClusterHealthService,
    {} as K8sClientService,
    prisma as never,
  );
}

describe('ResourcesService detail aggregation', () => {
  const now = new Date('2026-04-16T10:00:00.000Z');

  it('keeps workload detail sections deterministic for drawer rendering', async () => {
    const prisma: MockedPrisma = {
      workloadRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'wl-deploy-1',
          clusterId: 'cluster-a',
          namespace: 'default',
          kind: 'Deployment',
          name: 'web',
          state: 'running',
          spec: {
            template: {
              spec: {
                volumes: [
                  {
                    name: 'data',
                    persistentVolumeClaim: { claimName: 'web-data' },
                  },
                ],
                containers: [{ name: 'app', image: 'nginx:1.27' }],
              },
            },
          },
          statusJson: {
            phase: 'Running',
            replicas: 2,
            readyReplicas: 2,
            availableReplicas: 2,
            image: 'nginx:1.27',
          },
          labels: { app: 'web' },
          annotations: { team: 'ops' },
          replicas: 2,
          readyReplicas: 2,
          createdAt: now,
          updatedAt: now,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'wl-deploy-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'Deployment',
            name: 'web',
            state: 'running',
            spec: { template: { spec: {} } },
            statusJson: {},
            labels: null,
            annotations: null,
            replicas: 2,
            readyReplicas: 2,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'pod-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'Pod',
            name: 'web-75c8f8f5db-x1y2z',
            state: 'running',
            spec: { containers: [{ name: 'app', image: 'nginx:1.27' }] },
            statusJson: {
              ownerReferences: [{ kind: 'Deployment', name: 'web' }],
            },
            labels: null,
            annotations: null,
            replicas: null,
            readyReplicas: null,
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
      networkResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      storageResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pvc-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'PVC',
            name: 'web-data',
            state: 'Bound',
            storageClass: 'fast-ssd',
            capacity: '5Gi',
            accessModes: ['ReadWriteOnce'],
            bindingMode: null,
            spec: { volumeName: 'pv-web-data', storageClassName: 'fast-ssd' },
            statusJson: { phase: 'Bound' },
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
      configResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = buildService(prisma);
    const detail = await service.getDetail('deployment', 'wl-deploy-1');

    expect(detail.descriptor.sections).toEqual([
      'overview',
      'runtime',
      'associations',
      'network',
      'storage',
      'events',
      'metadata',
    ]);
    expect(detail.associations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'Pod',
          name: 'web-75c8f8f5db-x1y2z',
          associationType: 'owned-pod',
        }),
        expect.objectContaining({
          kind: 'PersistentVolumeClaim',
          name: 'web-data',
          associationType: 'mount-claim',
        }),
      ]),
    );
  });

  it('aggregates related resources and IP fields for service detail', async () => {
    const prisma: MockedPrisma = {
      workloadRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      networkResource: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'svc-1',
          clusterId: 'cluster-a',
          namespace: 'default',
          kind: 'Service',
          name: 'svc-web',
          state: 'running',
          spec: {
            clusterIP: '10.96.88.10',
            ports: [{ port: 80, protocol: 'TCP', targetPort: 8080 }],
          },
          statusJson: {
            loadBalancer: {
              ingress: [{ ip: '34.120.8.9' }],
            },
          },
          labels: { app: 'web' },
          createdAt: now,
          updatedAt: now,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'svc-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'Service',
            name: 'svc-web',
            state: 'running',
            spec: {
              clusterIP: '10.96.88.10',
              ports: [{ port: 80, protocol: 'TCP', targetPort: 8080 }],
            },
            statusJson: {
              loadBalancer: {
                ingress: [{ ip: '34.120.8.9' }],
              },
            },
            labels: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'ing-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'Ingress',
            name: 'ing-web',
            state: 'running',
            spec: {
              rules: [
                {
                  host: 'web.example.com',
                  http: {
                    paths: [
                      {
                        path: '/',
                        backend: { service: { name: 'svc-web' } },
                      },
                    ],
                  },
                },
              ],
            },
            statusJson: {},
            labels: null,
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
      storageResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      configResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = buildService(prisma);
    const detail = await service.getDetail('service', 'svc-1');
    expect(detail.descriptor.sections).toEqual([
      'overview',
      'runtime',
      'associations',
      'network',
      'events',
      'metadata',
    ]);

    expect(detail.associations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'Ingress',
          name: 'ing-web',
          associationType: 'routes-to-service',
        }),
      ]),
    );
    expect(detail.network.clusterIPs).toContain('10.96.88.10');
    expect(detail.network.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ip: '34.120.8.9',
        }),
      ]),
    );
    expect(detail.descriptor.sections).not.toContain('storage');
  });

  it('keeps storage detail schema isolated from network section', async () => {
    const prisma: MockedPrisma = {
      workloadRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      networkResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      storageResource: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pvc-1',
          clusterId: 'cluster-a',
          namespace: 'default',
          kind: 'PVC',
          name: 'web-data',
          state: 'Bound',
          storageClass: 'fast-ssd',
          capacity: '5Gi',
          accessModes: ['ReadWriteOnce'],
          bindingMode: null,
          spec: { volumeName: 'pv-web-data', storageClassName: 'fast-ssd' },
          statusJson: { phase: 'Bound' },
          createdAt: now,
          updatedAt: now,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pvc-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'PVC',
            name: 'web-data',
            state: 'Bound',
            storageClass: 'fast-ssd',
            capacity: '5Gi',
            accessModes: ['ReadWriteOnce'],
            bindingMode: null,
            spec: { volumeName: 'pv-web-data', storageClassName: 'fast-ssd' },
            statusJson: { phase: 'Bound' },
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
      configResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = buildService(prisma);
    const detail = await service.getDetail('pvc', 'pvc-1');

    expect(detail.descriptor.sections).toEqual([
      'overview',
      'runtime',
      'associations',
      'storage',
      'events',
      'metadata',
    ]);
    expect(detail.descriptor.sections).not.toContain('network');
  });
});

describe('ResourcesService dynamic listing', () => {
  function buildDynamicService(prisma: MockedPrisma) {
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn().mockResolvedValue(undefined),
      listReadableClusterIdsForResourceRead: jest.fn(),
    };
    const clustersService = {
      getKubeconfig: jest.fn(),
      list: jest.fn(),
    };
    const k8sClientService = {
      createClient: jest.fn((kubeconfig: string) => ({
        __api: kubeconfig === 'kubeconfig-a'
          ? {
              list: jest.fn().mockResolvedValue({
                items: [
                  {
                    metadata: {
                      name: 'web-a',
                      namespace: 'default',
                      creationTimestamp: '2026-04-16T10:00:00.000Z',
                    },
                    status: { phase: 'Running' },
                  },
                ],
              }),
            }
          : {
              list: jest.fn().mockResolvedValue({
                items: [
                  {
                    metadata: {
                      name: 'web-b',
                      namespace: 'default',
                      creationTimestamp: '2026-04-16T10:01:00.000Z',
                    },
                    status: { state: 'Pending' },
                  },
                ],
              }),
            },
      })),
    };

    return {
      service: new ResourcesService(
        clustersService as never,
        clusterHealthService as never,
        k8sClientService as never,
        prisma as never,
      ),
      clustersService,
      clusterHealthService,
      k8sClientService,
    };
  }

  it('aggregates dynamic resources across all readable clusters when clusterId is empty', async () => {
    const prisma: MockedPrisma = {
      workloadRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      networkResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      storageResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      configResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      apiResourceCapability: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({
            clusterId: where.clusterId,
            group: '',
            version: 'v1',
            resource: 'deployments',
            kind: 'Deployment',
            namespaced: true,
          }),
        ),
      },
    };

    const { service, clustersService, clusterHealthService } =
      buildDynamicService(prisma);
    (clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock).mockResolvedValue([
      'cluster-a',
      'cluster-b',
    ]);
    (clustersService.getKubeconfig as jest.Mock).mockImplementation(
      async (clusterId: string) =>
        clusterId === 'cluster-a' ? 'kubeconfig-a' : 'kubeconfig-b',
    );

    const result = await service.listDynamicResources({
      group: '',
      version: 'v1',
      resource: 'deployments',
    });

    expect(clusterHealthService.listReadableClusterIdsForResourceRead).toHaveBeenCalledTimes(
      1,
    );
    expect(clustersService.list).not.toHaveBeenCalled();
    expect(result.clusterId).toBe('');
    expect(result.kind).toBe('Deployment');
    expect(result.namespaced).toBe(true);
    expect(result.total).toBe(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cluster-a/default/web-a',
          clusterId: 'cluster-a',
          name: 'web-a',
          state: 'Running',
        }),
        expect.objectContaining({
          id: 'cluster-b/default/web-b',
          clusterId: 'cluster-b',
          name: 'web-b',
          state: 'Pending',
        }),
      ]),
    );
  });

  it('keeps single-cluster dynamic listing behavior when clusterId is set', async () => {
    const prisma: MockedPrisma = {
      workloadRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      networkResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      storageResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      configResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      apiResourceCapability: {
        findFirst: jest.fn().mockResolvedValue({
          clusterId: 'cluster-a',
          group: '',
          version: 'v1',
          resource: 'deployments',
          kind: 'Deployment',
          namespaced: true,
        }),
      },
    };

    const { service, clustersService, clusterHealthService } =
      buildDynamicService(prisma);
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig-a',
    );

    const result = await service.listDynamicResources({
      clusterId: 'cluster-a',
      version: 'v1',
      resource: 'deployments',
    });

    expect(clusterHealthService.listReadableClusterIdsForResourceRead).not.toHaveBeenCalled();
    expect(result.clusterId).toBe('cluster-a');
    expect(result.kind).toBe('Deployment');
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'cluster-a/default/web-a',
        clusterId: 'cluster-a',
      }),
    );
  });
});
