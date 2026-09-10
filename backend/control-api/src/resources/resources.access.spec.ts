jest.mock('@kubernetes/client-node', () => ({}));

import { ForbiddenException } from '@nestjs/common';
import { ResourcesController } from './resources.controller';

type ControllerMethod = (...args: unknown[]) => unknown;
type CallableController = Record<string, ControllerMethod>;

describe('ResourcesController explicit cluster authorization', () => {
  const actor = {
    id: 'operator-1',
    username: 'operator',
    role: 'cluster-operator',
  };
  const request = { user: { user: actor } };

  function createHarness(options?: { deny?: boolean }) {
    const resourcesService = {
      refreshDiscoveryCatalog: jest.fn(),
      getDiscoveryCatalog: jest.fn(),
      listDynamicResources: jest.fn(),
      getDynamicResourceDetail: jest.fn(),
      updateDynamicYaml: jest.fn(),
      deleteDynamicResource: jest.fn(),
      createDynamicResource: jest.fn(),
      getYaml: jest.fn(),
      getDetail: jest.fn(),
      updateYaml: jest.fn(),
      applyYaml: jest.fn(),
      scaleResource: jest.fn(),
      updateImage: jest.fn(),
    };
    const clustersService = {
      getKubeconfig: jest.fn().mockResolvedValue('kubeconfig'),
    };
    const clusterSyncService = {
      syncCluster: jest.fn().mockResolvedValue(undefined),
    };
    const rejection = new ForbiddenException('cluster access denied');
    const clusterAccessService = {
      assertCanRead: options?.deny
        ? jest.fn().mockRejectedValue(rejection)
        : jest.fn().mockResolvedValue(undefined),
      assertCanMutate: options?.deny
        ? jest.fn().mockRejectedValue(rejection)
        : jest.fn().mockResolvedValue(undefined),
    };
    const ControllerConstructor = ResourcesController as unknown as new (
      ...args: unknown[]
    ) => ResourcesController;
    const controller = new ControllerConstructor(
      resourcesService,
      clustersService,
      clusterSyncService,
      clusterAccessService,
    ) as unknown as CallableController;

    return {
      controller,
      resourcesService,
      clustersService,
      clusterSyncService,
      clusterAccessService,
    };
  }

  function expectNoDownstreamCalls(
    harness: ReturnType<typeof createHarness>,
  ): void {
    for (const serviceCall of Object.values(harness.resourcesService)) {
      expect(serviceCall).not.toHaveBeenCalled();
    }
    expect(harness.clustersService.getKubeconfig).not.toHaveBeenCalled();
    expect(harness.clusterSyncService.syncCluster).not.toHaveBeenCalled();
  }

  it.each([
    [
      'discovery catalog',
      'getDiscoveryCatalog',
      [request, 'cluster-a', 'true'],
    ],
    ['dynamic list', 'listDynamic', [request, { clusterId: 'cluster-a' }]],
    [
      'dynamic detail',
      'getDynamicDetail',
      [request, 'cluster-a', '', 'v1', 'pods', 'default', 'api'],
    ],
    [
      'resource YAML',
      'getYaml',
      [request, 'cluster-a', 'default', 'Pod', 'api'],
    ],
  ])('denies %s before any downstream read', async (_label, method, args) => {
    const harness = createHarness({ deny: true });

    await expect(harness.controller[method](...args)).rejects.toThrow(
      'cluster access denied',
    );

    expect(harness.clusterAccessService.assertCanRead).toHaveBeenCalledWith(
      actor,
      'cluster-a',
    );
    expect(harness.clusterAccessService.assertCanMutate).not.toHaveBeenCalled();
    expectNoDownstreamCalls(harness);
  });

  it.each([
    [
      'discovery refresh',
      'refreshDiscovery',
      [request, { clusterId: 'cluster-a' }],
    ],
    [
      'dynamic YAML update',
      'updateDynamicYaml',
      [request, { clusterId: 'cluster-a', yaml: '{}' }],
    ],
    ['dynamic delete', 'deleteDynamic', [request, { clusterId: 'cluster-a' }]],
    [
      'dynamic create',
      'createDynamic',
      [request, { clusterId: 'cluster-a', body: {} }],
    ],
    [
      'resource YAML update',
      'updateYaml',
      [
        request,
        {
          clusterId: 'cluster-a',
          kind: 'Pod',
          name: 'api',
          yaml: '{}',
        },
      ],
    ],
    [
      'resource YAML apply',
      'applyYaml',
      [request, { clusterId: 'cluster-a', yaml: '{}' }],
    ],
    [
      'scale',
      'scale',
      [
        request,
        {
          clusterId: 'cluster-a',
          kind: 'Deployment',
          name: 'api',
          replicas: 2,
        },
      ],
    ],
    [
      'image update',
      'updateImage',
      [
        request,
        {
          clusterId: 'cluster-a',
          kind: 'Deployment',
          name: 'api',
          image: 'nginx:2',
        },
      ],
    ],
  ])(
    'denies %s before any downstream mutation or sync',
    async (_label, method, args) => {
      const harness = createHarness({ deny: true });

      await expect(harness.controller[method](...args)).rejects.toThrow(
        'cluster access denied',
      );

      expect(harness.clusterAccessService.assertCanMutate).toHaveBeenCalledWith(
        actor,
        'cluster-a',
      );
      expect(harness.clusterAccessService.assertCanRead).not.toHaveBeenCalled();
      expectNoDownstreamCalls(harness);
    },
  );

  it('authorizes a dynamic list with an explicit cluster before listing it', async () => {
    const harness = createHarness();
    const response = { items: [], total: 0 };
    harness.resourcesService.listDynamicResources.mockResolvedValue(response);

    await expect(
      harness.controller.listDynamic(request, { clusterId: 'cluster-a' }),
    ).resolves.toBe(response);

    expect(harness.clusterAccessService.assertCanRead).toHaveBeenCalledWith(
      actor,
      'cluster-a',
    );
    expect(
      harness.clusterAccessService.assertCanRead.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.resourcesService.listDynamicResources.mock.invocationCallOrder[0],
    );
  });

  it('keeps dry-run YAML updates from triggering a cluster sync', async () => {
    const harness = createHarness();
    harness.resourcesService.updateYaml.mockResolvedValue({
      clusterId: 'cluster-a',
    });

    await harness.controller.updateYaml(request, {
      clusterId: 'cluster-a',
      kind: 'Deployment',
      name: 'api',
      yaml: '{}',
      dryRun: true,
    });

    expect(harness.clusterAccessService.assertCanMutate).toHaveBeenCalledWith(
      actor,
      'cluster-a',
    );
    expect(harness.clustersService.getKubeconfig).not.toHaveBeenCalled();
    expect(harness.clusterSyncService.syncCluster).not.toHaveBeenCalled();
  });

  it('keeps successful non-dry-run YAML updates triggering a cluster sync', async () => {
    const harness = createHarness();
    harness.resourcesService.updateYaml.mockResolvedValue({
      clusterId: 'cluster-a',
    });

    await harness.controller.updateYaml(request, {
      clusterId: 'cluster-a',
      kind: 'Deployment',
      name: 'api',
      yaml: '{}',
      dryRun: false,
    });

    expect(harness.clustersService.getKubeconfig).toHaveBeenCalledWith(
      'cluster-a',
    );
    await Promise.resolve();
    expect(harness.clusterSyncService.syncCluster).toHaveBeenCalledWith(
      'cluster-a',
      'kubeconfig',
    );
  });
});
