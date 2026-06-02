jest.mock('@kubernetes/client-node', () => ({
  dumpYaml: jest.fn((value: unknown) => JSON.stringify(value)),
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

function buildService(
  prisma: MockedPrisma,
  overrides: {
    clustersService?: Partial<ClustersService>;
    k8sClientService?: Partial<K8sClientService>;
  } = {},
): ResourcesService {
  return new ResourcesService(
    {
      getKubeconfig: jest.fn().mockResolvedValue(null),
      ...overrides.clustersService,
    } as unknown as ClustersService,
    {
      assertClusterOnlineForRead: jest.fn().mockResolvedValue(undefined),
    } as unknown as ClusterHealthService,
    {
      getCoreApi: jest.fn(),
      ...overrides.k8sClientService,
    } as unknown as K8sClientService,
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

    expect(detail.rawSpec).toEqual({
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
    });
    expect(detail.rawStatus).toEqual({
      phase: 'Running',
      replicas: 2,
      readyReplicas: 2,
      availableReplicas: 2,
      image: 'nginx:1.27',
    });
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
            id: 'pod-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'Pod',
            name: 'web-7f9d8',
            state: 'running',
            spec: {},
            statusJson: {},
            labels: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'eps-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'EndpointSlice',
            name: 'svc-web-abc',
            state: 'running',
            spec: {
              metadataLabels: {
                'kubernetes.io/service-name': 'svc-web',
              },
              ports: [{ name: 'http', port: 8080, protocol: 'TCP' }],
              endpoints: [
                {
                  addresses: ['10.10.0.21'],
                  conditions: { ready: true },
                  targetRef: {
                    kind: 'Pod',
                    name: 'web-7f9d8',
                    namespace: 'default',
                  },
                },
              ],
            },
            statusJson: {},
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
          id: 'ing-1',
          associationType: 'routes-to-service',
        }),
        expect.objectContaining({
          kind: 'EndpointSlice',
          name: 'svc-web-abc',
          id: 'eps-1',
          associationType: 'selects-service',
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
    expect(detail.network.networkPipelines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: 'Service',
          sourceName: 'svc-web',
          sourceNamespace: 'default',
          serviceName: 'svc-web',
          serviceNamespace: 'default',
          endpointSourceKind: 'EndpointSlice',
          endpointSourceName: 'svc-web-abc',
          backendPodName: 'web-7f9d8',
          backendPodNamespace: 'default',
          ip: '10.10.0.21',
          ready: true,
        }),
        expect.objectContaining({
          sourceKind: 'Ingress',
          sourceName: 'ing-web',
          sourceNamespace: 'default',
          host: 'web.example.com',
          path: '/',
          serviceName: 'svc-web',
          serviceNamespace: 'default',
        }),
      ]),
    );
    expect(detail.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'network',
          items: expect.arrayContaining([
            expect.objectContaining({
              chain: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'Service',
                  name: 'svc-web',
                  id: 'svc-1',
                  clusterId: 'cluster-a',
                  apiVersion: 'v1',
                  role: 'entry',
                }),
                expect.objectContaining({
                  kind: 'EndpointSlice',
                  name: 'svc-web-abc',
                  id: 'eps-1',
                  clusterId: 'cluster-a',
                  apiVersion: 'discovery.k8s.io/v1',
                  role: 'endpoint',
                }),
                expect.objectContaining({
                  kind: 'Pod',
                  name: 'web-7f9d8',
                  id: 'pod-1',
                  clusterId: 'cluster-a',
                  apiVersion: 'v1',
                  role: 'backend',
                }),
              ]),
            }),
          ]),
        }),
      ]),
    );
    expect(detail.descriptor.sections).not.toContain('storage');
  });

  it('exposes Gateway API spec fields in runtime detail', async () => {
    const prisma: MockedPrisma = {
      workloadRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      networkResource: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'gwc-1',
          clusterId: 'cluster-a',
          namespace: '',
          kind: 'GatewayClass',
          name: 'nginx',
          state: 'accepted',
          spec: { controllerName: 'gateway.nginx.org/nginx-gateway-controller' },
          statusJson: { conditions: [{ type: 'Accepted', status: 'True' }] },
          labels: null,
          annotations: null,
          createdAt: now,
          updatedAt: now,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'gw-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'Gateway',
            name: 'public',
            state: 'active',
            spec: { gatewayClassName: 'nginx' },
            statusJson: {},
            labels: null,
            annotations: null,
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
    const detail = await service.getDetail('gatewayclass', 'gwc-1');

    expect(detail.runtime.controllerName).toBe(
      'gateway.nginx.org/nginx-gateway-controller',
    );
    expect(detail.runtime.conditions).toEqual([
      expect.objectContaining({ type: 'Accepted', status: 'True' }),
    ]);
    expect(detail.associations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'Gateway',
          name: 'public',
        }),
      ]),
    );
  });

  it('builds live Node detail with readiness, roles, addresses, capacity, and events', async () => {
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
    };
    const readNode = jest.fn().mockResolvedValue({
      metadata: {
        name: 'worker-a',
        labels: { 'node-role.kubernetes.io/worker': '' },
        creationTimestamp: now,
      },
      spec: {
        unschedulable: false,
        taints: [{ key: 'dedicated', value: 'apps', effect: 'NoSchedule' }],
      },
      status: {
        addresses: [
          { type: 'InternalIP', address: '10.0.0.10' },
          { type: 'ExternalIP', address: '203.0.113.10' },
        ],
        capacity: { cpu: '8', memory: '32768Mi' },
        nodeInfo: {
          osImage: 'Ubuntu 24.04',
          kernelVersion: '6.8.0',
          containerRuntimeVersion: 'containerd://1.7.0',
          kubeletVersion: 'v1.30.1',
        },
        conditions: [{ type: 'Ready', status: 'True' }],
      },
    });
    const listEventForAllNamespaces = jest.fn().mockResolvedValue({
      items: [
        {
          metadata: { uid: 'node-event' },
          type: 'Normal',
          reason: 'NodeReady',
          message: 'Node worker-a is ready',
          involvedObject: { kind: 'Node', name: 'worker-a' },
          lastTimestamp: '2026-04-16T10:05:00.000Z',
        },
      ],
    });
    const service = buildService(prisma, {
      clustersService: {
        getKubeconfig: jest.fn().mockResolvedValue('kubeconfig-a'),
      },
      k8sClientService: {
        getCoreApi: jest.fn().mockReturnValue({
          readNode,
          listEventForAllNamespaces,
        }),
        getDiscoveryApi: jest.fn().mockReturnValue({}),
        getNetworkingApi: jest.fn().mockReturnValue({}),
        getCustomObjectsApi: jest.fn().mockReturnValue({}),
      },
    });

    const detail = await service.getDetail(
      'node',
      'live-node:cluster-a:worker-a',
    );

    expect(readNode).toHaveBeenCalledWith({ name: 'worker-a' });
    expect(detail.overview.kind).toBe('Node');
    expect(detail.runtime.ready).toBe(true);
    expect(detail.runtime.roles).toEqual(['worker']);
    expect(detail.runtime.internalIP).toBe('10.0.0.10');
    expect(detail.runtime.externalIP).toBe('203.0.113.10');
    expect(detail.runtime.cpuCapacity).toBe('8');
    expect(detail.runtime.memoryCapacity).toBe('32768Mi');
    expect(detail.runtime.taints).toEqual(['dedicated=apps:NoSchedule']);
    expect(detail.runtime.conditions).toEqual([
      expect.objectContaining({ type: 'Ready', status: 'True' }),
    ]);
    expect(listEventForAllNamespaces).toHaveBeenCalledWith({
      fieldSelector: 'involvedObject.kind=Node,involvedObject.name=worker-a',
      limit: 30,
    });
    expect(detail.events.items[0]).toEqual(
      expect.objectContaining({
        id: 'node-event',
        reason: 'NodeReady',
      }),
    );
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

  it('builds pod storage pipeline from volumeMount to pvc pv and storageclass', async () => {
    const prisma: MockedPrisma = {
      workloadRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pod-1',
          clusterId: 'cluster-a',
          namespace: 'default',
          kind: 'Pod',
          name: 'web-0',
          state: 'running',
          spec: {
            volumes: [
              {
                name: 'data',
                persistentVolumeClaim: { claimName: 'web-data' },
              },
              {
                name: 'cache',
                emptyDir: {},
              },
            ],
            containers: [
              {
                name: 'app',
                image: 'nginx:1.27',
                volumeMounts: [
                  { name: 'data', mountPath: '/data', readOnly: false },
                  { name: 'cache', mountPath: '/cache', readOnly: true },
                ],
                envFrom: [{ configMapRef: { name: 'app-config' } }],
                env: [
                  {
                    name: 'DB_PASSWORD',
                    valueFrom: {
                      secretKeyRef: { name: 'db-secret', key: 'password' },
                    },
                  },
                ],
              },
            ],
          },
          statusJson: {
            phase: 'Running',
            ownerReferences: [{ kind: 'Deployment', name: 'web' }],
          },
          labels: { app: 'web' },
          annotations: null,
          replicas: null,
          readyReplicas: null,
          createdAt: now,
          updatedAt: now,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'deploy-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'Deployment',
            name: 'web',
            state: 'running',
            spec: { template: { spec: {} } },
            statusJson: {},
            labels: null,
            annotations: null,
            replicas: 1,
            readyReplicas: 1,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'pod-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'Pod',
            name: 'web-0',
            state: 'running',
            spec: {
              volumes: [
                {
                  name: 'data',
                  persistentVolumeClaim: { claimName: 'web-data' },
                },
                {
                  name: 'cache',
                  emptyDir: {},
                },
              ],
              containers: [
                {
                  name: 'app',
                  image: 'nginx:1.27',
                  volumeMounts: [
                    { name: 'data', mountPath: '/data', readOnly: false },
                    { name: 'cache', mountPath: '/cache', readOnly: true },
                  ],
                  envFrom: [{ configMapRef: { name: 'app-config' } }],
                  env: [
                    {
                      name: 'DB_PASSWORD',
                      valueFrom: {
                        secretKeyRef: { name: 'db-secret', key: 'password' },
                      },
                    },
                  ],
                },
              ],
            },
            statusJson: {
              phase: 'Running',
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
          {
            id: 'pv-1',
            clusterId: 'cluster-a',
            namespace: null,
            kind: 'PV',
            name: 'pv-web-data',
            state: 'Bound',
            storageClass: 'fast-ssd',
            capacity: '5Gi',
            accessModes: ['ReadWriteOnce'],
            bindingMode: null,
            spec: {
              claimRef: { namespace: 'default', name: 'web-data' },
              storageClassName: 'fast-ssd',
            },
            statusJson: { phase: 'Bound' },
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'sc-1',
            clusterId: 'cluster-a',
            namespace: null,
            kind: 'SC',
            name: 'fast-ssd',
            state: 'available',
            storageClass: null,
            capacity: null,
            accessModes: null,
            bindingMode: 'WaitForFirstConsumer',
            spec: {},
            statusJson: {},
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
      configResource: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cm-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'ConfigMap',
            name: 'app-config',
            state: 'available',
            labels: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'secret-1',
            clusterId: 'cluster-a',
            namespace: 'default',
            kind: 'Secret',
            name: 'db-secret',
            state: 'available',
            labels: null,
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
    };

    const service = buildService(prisma);
    const detail = await service.getDetail('pod', 'pod-1');

    expect(detail.storage.storageClasses).toContain('fast-ssd');
    expect(detail.storage.storagePipelines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          container: 'app',
          mountPath: '/data',
          readOnly: false,
          volumeName: 'data',
          volumeType: 'persistentVolumeClaim',
          volumeSource: 'web-data',
          pvcName: 'web-data',
          pvcNamespace: 'default',
          pvcPhase: 'Bound',
          pvName: 'pv-web-data',
          pvPhase: 'Bound',
          storageClass: 'fast-ssd',
        }),
        expect.objectContaining({
          container: 'app',
          mountPath: '/cache',
          readOnly: true,
          volumeName: 'cache',
          volumeType: 'emptyDir',
        }),
      ]),
    );
    expect(detail.metadata.configUsages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referencedKind: 'ConfigMap',
          referencedName: 'app-config',
          consumerKind: 'Pod',
          consumerName: 'web-0',
          consumerNamespace: 'default',
          usageType: 'envFrom',
          container: 'app',
        }),
        expect.objectContaining({
          referencedKind: 'Secret',
          referencedName: 'db-secret',
          consumerKind: 'Pod',
          consumerName: 'web-0',
          consumerNamespace: 'default',
          usageType: 'env',
          container: 'app',
          key: 'DB_PASSWORD',
        }),
      ]),
    );
    expect(detail.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'control',
          items: expect.arrayContaining([
            expect.objectContaining({
              chain: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'Deployment',
                  name: 'web',
                  id: 'deploy-1',
                  clusterId: 'cluster-a',
                  apiVersion: 'apps/v1',
                  role: 'owner',
                }),
              ]),
            }),
          ]),
        }),
        expect.objectContaining({
          key: 'config',
          items: expect.arrayContaining([
            expect.objectContaining({
              chain: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'ConfigMap',
                  name: 'app-config',
                  id: 'cm-1',
                  clusterId: 'cluster-a',
                  apiVersion: 'v1',
                  role: 'referenced',
                }),
                expect.objectContaining({
                  kind: 'Pod',
                  name: 'web-0',
                  id: 'pod-1',
                  clusterId: 'cluster-a',
                  apiVersion: 'v1',
                  role: 'consumer',
                }),
              ]),
            }),
            expect.objectContaining({
              chain: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'Secret',
                  name: 'db-secret',
                  id: 'secret-1',
                  clusterId: 'cluster-a',
                  apiVersion: 'v1',
                  role: 'referenced',
                }),
                expect.objectContaining({
                  kind: 'Pod',
                  name: 'web-0',
                  id: 'pod-1',
                  clusterId: 'cluster-a',
                  apiVersion: 'v1',
                  role: 'consumer',
                }),
              ]),
            }),
          ]),
        }),
      ]),
    );
  });

  it('loads live Kubernetes events for detail drawer', async () => {
    const listNamespacedEvent = jest.fn().mockResolvedValue({
      items: [
        {
          metadata: {
            name: 'web.older',
            namespace: 'default',
            uid: 'event-older',
            creationTimestamp: '2026-04-16T10:00:00.000Z',
          },
          involvedObject: {
            kind: 'Pod',
            namespace: 'default',
            name: 'web-0',
            fieldPath: 'spec.containers{app}',
            uid: 'pod-uid',
          },
          type: 'Normal',
          reason: 'Pulled',
          message: 'Successfully pulled image',
          count: 1,
          firstTimestamp: '2026-04-16T10:00:00.000Z',
          lastTimestamp: '2026-04-16T10:00:00.000Z',
          source: { component: 'kubelet', host: 'worker-a' },
        },
        {
          metadata: {
            name: 'web.newer',
            namespace: 'default',
            uid: 'event-newer',
            creationTimestamp: '2026-04-16T10:05:00.000Z',
          },
          involvedObject: {
            kind: 'Pod',
            namespace: 'default',
            name: 'web-0',
          },
          type: 'Warning',
          reason: 'BackOff',
          message: 'Back-off restarting failed container',
          count: 3,
          lastTimestamp: '2026-04-16T10:05:00.000Z',
          reportingComponent: 'kubelet',
          reportingInstance: 'worker-a',
        },
      ],
    });
    const prisma: MockedPrisma = {
      workloadRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pod-1',
          clusterId: 'cluster-a',
          namespace: 'default',
          kind: 'Pod',
          name: 'web-0',
          state: 'running',
          spec: { containers: [{ name: 'app', image: 'nginx:1.27' }] },
          statusJson: { phase: 'Running' },
          labels: null,
          annotations: null,
          replicas: null,
          readyReplicas: null,
          createdAt: now,
          updatedAt: now,
        }),
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
    };

    const service = buildService(prisma, {
      clustersService: {
        getKubeconfig: jest.fn().mockResolvedValue('kubeconfig-a'),
      },
      k8sClientService: {
        getCoreApi: jest.fn().mockReturnValue({ listNamespacedEvent }),
      },
    });
    const detail = await service.getDetail('pod', 'pod-1');

    expect(listNamespacedEvent).toHaveBeenCalledWith({
      namespace: 'default',
      fieldSelector:
        'involvedObject.kind=Pod,involvedObject.name=web-0,involvedObject.namespace=default',
      limit: 30,
    });
    expect(detail.events.items[0]).toEqual(
      expect.objectContaining({
        id: 'event-newer',
        type: 'Warning',
        reason: 'BackOff',
        message: 'Back-off restarting failed container',
        count: 3,
        lastTimestamp: '2026-04-16T10:05:00.000Z',
        source: 'kubelet',
        reportingInstance: 'worker-a',
        involvedObject: {
          kind: 'Pod',
          name: 'web-0',
          namespace: 'default',
        },
      }),
    );
    expect(detail.events.items[1]).toEqual(
      expect.objectContaining({
        id: 'event-older',
        type: 'Normal',
        reason: 'Pulled',
        source: 'kubelet',
        sourceHost: 'worker-a',
        involvedObject: {
          kind: 'Pod',
          name: 'web-0',
          namespace: 'default',
          fieldPath: 'spec.containers{app}',
          uid: 'pod-uid',
        },
      }),
    );
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
      getCoreApi: jest.fn().mockReturnValue({
        listNamespacedEvent: jest.fn().mockResolvedValue({ items: [] }),
        listEventForAllNamespaces: jest.fn().mockResolvedValue({ items: [] }),
      }),
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
              read: jest.fn().mockResolvedValue({
                apiVersion: 'example.com/v1',
                kind: 'Widget',
                metadata: {
                  name: 'widget-a',
                  namespace: 'default',
                  labels: { app: 'widget' },
                  creationTimestamp: new Date('2026-04-16T10:00:00.000Z'),
                },
                spec: {
                  size: 'small',
                  gatewayClassName: 'edge',
                  rules: [{ backendRefs: [{ name: 'web', port: 80 }] }],
                },
                status: {
                  phase: 'Ready',
                  conditions: [{ type: 'Available', status: 'True' }],
                },
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
              read: jest.fn().mockResolvedValue({
                apiVersion: 'example.com/v1',
                kind: 'Widget',
                metadata: {
                  name: 'widget-b',
                  namespace: 'default',
                  creationTimestamp: '2026-04-16T10:01:00.000Z',
                },
                status: { state: 'Pending' },
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

  it('returns an empty dynamic list for optional missing capabilities', async () => {
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
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const { service, clustersService } = buildDynamicService(prisma);
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig-a',
    );

    const result = await service.listDynamicResources({
      clusterId: 'cluster-a',
      group: 'gateway.networking.k8s.io',
      version: 'v1',
      resource: 'gatewayclasses',
      missingAsEmpty: 'true',
    });

    expect(clustersService.getKubeconfig).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: 'gateway.networking.k8s.io',
        version: 'v1',
        resource: 'gatewayclasses',
        total: 0,
        items: [],
      }),
    );
  });

  it('returns standard drawer detail for dynamic resources', async () => {
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
          group: 'example.com',
          version: 'v1',
          resource: 'widgets',
          kind: 'Widget',
          namespaced: true,
        }),
      },
    };
    const { service, clustersService } = buildDynamicService(prisma);
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig-a',
    );

    const result = await service.getDynamicResourceDetail({
      clusterId: 'cluster-a',
      group: 'example.com',
      version: 'v1',
      resource: 'widgets',
      namespace: 'default',
      name: 'widget-a',
    });

    expect(result.detail.overview).toEqual(
      expect.objectContaining({
        id: 'dynamic:cluster-a:example.com:v1:widgets:default:widget-a',
        clusterId: 'cluster-a',
        namespace: 'default',
        kind: 'Widget',
        name: 'widget-a',
        state: 'Ready',
        createdAt: '2026-04-16T10:00:00.000Z',
      }),
    );
    expect(result.detail.runtime).toEqual(
      expect.objectContaining({
        phase: 'Ready',
        conditions: [expect.objectContaining({ type: 'Available', status: 'True' })],
      }),
    );
    expect(result.detail.metadata.labels).toEqual({ app: 'widget' });

    const drawerDetail = await service.getDetail(
      'dynamic',
      'dynamic:cluster-a:example.com:v1:widgets:default:widget-a',
    );
    expect(drawerDetail.overview.kind).toBe('Widget');
    expect(drawerDetail.runtime.phase).toBe('Ready');
    expect(drawerDetail.rawSpec).toEqual({
      size: 'small',
      gatewayClassName: 'edge',
      rules: [{ backendRefs: [{ name: 'web', port: 80 }] }],
    });
    expect(drawerDetail.rawStatus).toEqual(
      expect.objectContaining({
        phase: 'Ready',
        conditions: [expect.objectContaining({ type: 'Available', status: 'True' })],
      }),
    );
  });

  it('adds Gateway API runtime and relations for dynamic fallback detail', async () => {
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
          group: 'gateway.networking.k8s.io',
          version: 'v1',
          resource: 'gateways',
          kind: 'Gateway',
          namespaced: true,
        }),
      },
    };
    const { service, clustersService } = buildDynamicService(prisma);
    (clustersService.getKubeconfig as jest.Mock).mockResolvedValue(
      'kubeconfig-a',
    );

    const detail = await service.getDetail(
      'dynamic',
      'dynamic:cluster-a:gateway.networking.k8s.io:v1:gateways:default:widget-a',
    );

    expect(detail.runtime.gatewayClassName).toBe('edge');
    expect(detail.associations).toEqual([
      expect.objectContaining({
        kind: 'GatewayClass',
        name: 'edge',
        associationType: 'gateway-class',
      }),
    ]);
  });
});
