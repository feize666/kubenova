jest.mock('@kubernetes/client-node', () => ({}));

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
