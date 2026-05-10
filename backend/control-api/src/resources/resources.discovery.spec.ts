jest.mock('@kubernetes/client-node', () => ({}));

import { ResourcesService } from './resources.service';

describe('ResourcesService discovery catalog', () => {
  function buildDiscoveryService(options?: {
    getKubeconfig?: jest.Mock;
    createClient?: jest.Mock;
    prismaOverrides?: Record<string, unknown>;
  }) {
    const clustersService = {
      getKubeconfig:
        options?.getKubeconfig ?? jest.fn().mockResolvedValue('kubeconfig'),
    };
    const k8sClientService = {
      createClient: options?.createClient ?? jest.fn(),
    };
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn().mockResolvedValue(undefined),
    };
    const tx = {
      apiResourceCapability: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (inner: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      apiResourceCapability: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...(options?.prismaOverrides ?? {}),
    };

    return {
      service: new ResourcesService(
        clustersService as never,
        clusterHealthService as never,
        k8sClientService as never,
        prisma as never,
      ),
      clustersService,
      k8sClientService,
      prisma,
      tx,
    };
  }

  it('refreshes discovery and persists list/get capable resources', async () => {
    const coreV1Api = {
      getAPIResources: jest.fn().mockResolvedValue({
        resources: [
          {
            name: 'pods',
            kind: 'Pod',
            namespaced: true,
            verbs: ['get', 'list', 'watch'],
          },
          {
            name: 'pods/status',
            kind: 'Pod',
            namespaced: true,
            verbs: ['get', 'patch'],
          },
        ],
      }),
    };
    const apisApi = {
      getAPIVersions: jest.fn().mockResolvedValue({
        groups: [{ name: 'apps', preferredVersion: { version: 'v1' } }],
      }),
    };
    const customObjectsApi = {
      getAPIResources: jest.fn().mockResolvedValue({
        resources: [
          {
            name: 'deployments',
            kind: 'Deployment',
            namespaced: true,
            verbs: ['get', 'list', 'patch'],
          },
          {
            name: 'deployments/scale',
            kind: 'Scale',
            namespaced: true,
            verbs: ['get', 'update'],
          },
        ],
      }),
    };
    const makeApiClient = jest
      .fn()
      .mockReturnValueOnce(coreV1Api)
      .mockReturnValueOnce(apisApi)
      .mockReturnValueOnce(customObjectsApi);

    const { service, k8sClientService, prisma } = buildDiscoveryService({
      createClient: jest.fn().mockReturnValue({
        makeApiClient,
      }),
    });

    const result = await service.refreshDiscoveryCatalog('cluster-a');
    expect(result.clusterId).toBe('cluster-a');
    expect(result.registered).toBe(2);

    expect(k8sClientService.createClient).toHaveBeenCalledTimes(1);
    expect(prisma.apiResourceCapability.deleteMany).toHaveBeenCalledWith({
      where: { clusterId: 'cluster-a' },
    });
    expect(prisma.apiResourceCapability.createMany).toHaveBeenCalledTimes(1);
    const createManyArg =
      prisma.apiResourceCapability.createMany.mock.calls[0][0];
    expect(createManyArg.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clusterId: 'cluster-a',
          group: '',
          version: 'v1',
          resource: 'pods',
          kind: 'Pod',
          namespaced: true,
          verbsJson: expect.arrayContaining(['get', 'list']),
        }),
        expect.objectContaining({
          clusterId: 'cluster-a',
          group: 'apps',
          version: 'v1',
          resource: 'deployments',
          kind: 'Deployment',
          namespaced: true,
          verbsJson: expect.arrayContaining(['get', 'list']),
        }),
      ]),
    );
  });

  it('returns stale catalog when refresh fails and serves cached rows', async () => {
    const now = new Date('2026-04-18T00:00:00.000Z');
    const { service, prisma } = buildDiscoveryService({
      getKubeconfig: jest.fn().mockResolvedValue(null),
      prismaOverrides: {
        apiResourceCapability: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'cap-1',
              clusterId: 'cluster-a',
              group: '',
              version: 'v1',
              kind: 'Pod',
              resource: 'pods',
              namespaced: true,
              verbsJson: ['get', 'list'],
              lastDiscoveredAt: now,
            },
          ]),
        },
      },
    });

    const result = await service.getDiscoveryCatalog('cluster-a', {
      refresh: true,
    });

    expect(result.stale).toBe(true);
    expect(result.refreshError).toContain('kubeconfig');
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'cap-1',
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        resource: 'pods',
        kind: 'Pod',
        namespaced: true,
        verbs: ['get', 'list'],
        lastDiscoveredAt: now.toISOString(),
      }),
    );
    expect(prisma.apiResourceCapability.findMany).toHaveBeenCalledWith({
      where: { clusterId: 'cluster-a' },
      orderBy: [{ group: 'asc' }, { version: 'asc' }, { resource: 'asc' }],
    });
  });
});
