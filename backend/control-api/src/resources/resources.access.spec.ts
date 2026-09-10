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
      resolveDetailClusterScope: jest.fn().mockResolvedValue({
        clusterId: 'cluster-a',
        scope: 'namespace',
      }),
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
      listAccessibleClusterIds: jest.fn().mockResolvedValue(['cluster-a']),
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
      [request, 'cluster-a', 'false'],
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

  it.each(['true', '1', 'yes', 'on'])(
    'requires mutation access before a discovery catalog refresh=%s',
    async (refresh) => {
      const harness = createHarness({ deny: true });

      await expect(
        harness.controller.getDiscoveryCatalog(request, 'cluster-a', refresh),
      ).rejects.toThrow('cluster access denied');

      expect(harness.clusterAccessService.assertCanMutate).toHaveBeenCalledWith(
        actor,
        'cluster-a',
      );
      expect(harness.clusterAccessService.assertCanRead).not.toHaveBeenCalled();
      expectNoDownstreamCalls(harness);
    },
  );

  it('normalizes whitespace and case before authorizing discovery refresh', async () => {
    const harness = createHarness({ deny: true });

    await expect(
      harness.controller.getDiscoveryCatalog(request, 'cluster-a', ' TRUE '),
    ).rejects.toThrow('cluster access denied');

    expect(harness.clusterAccessService.assertCanMutate).toHaveBeenCalledWith(
      actor,
      'cluster-a',
    );
    expectNoDownstreamCalls(harness);
  });

  it('uses read access for discovery catalog requests without refresh', async () => {
    const harness = createHarness();
    const response = { clusterId: 'cluster-a', items: [] };
    harness.resourcesService.getDiscoveryCatalog.mockResolvedValue(response);

    await expect(
      harness.controller.getDiscoveryCatalog(request, 'cluster-a', undefined),
    ).resolves.toBe(response);

    expect(harness.clusterAccessService.assertCanRead).toHaveBeenCalledWith(
      actor,
      'cluster-a',
    );
    expect(harness.clusterAccessService.assertCanMutate).not.toHaveBeenCalled();
    expect(harness.resourcesService.getDiscoveryCatalog).toHaveBeenCalledWith(
      'cluster-a',
      { refresh: false },
    );
  });

  it('limits a dynamic list without clusterId to the actor accessible clusters', async () => {
    const harness = createHarness();
    harness.resourcesService.listDynamicResources.mockResolvedValue({
      items: [],
      total: 0,
    });

    await harness.controller.listDynamic(request, {});

    expect(
      harness.clusterAccessService.listAccessibleClusterIds,
    ).toHaveBeenCalledWith(actor);
    expect(harness.resourcesService.listDynamicResources).toHaveBeenCalledWith(
      {},
      { accessibleClusterIds: ['cluster-a'] },
    );
  });

  it('resolves opaque detail ownership inside the accessible scope before loading it', async () => {
    const harness = createHarness({ deny: true });

    await expect(
      harness.controller.getDetail(request, 'deployment', 'opaque-cuid'),
    ).rejects.toThrow('cluster access denied');

    expect(
      harness.clusterAccessService.listAccessibleClusterIds,
    ).toHaveBeenCalledWith(actor);
    expect(
      harness.resourcesService.resolveDetailClusterScope,
    ).toHaveBeenCalledWith('deployment', 'opaque-cuid', ['cluster-a']);
    expect(harness.clusterAccessService.assertCanRead).toHaveBeenCalledWith(
      actor,
      'cluster-a',
    );
    expect(harness.resourcesService.getDetail).not.toHaveBeenCalled();
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

  it.each([
    [
      'dynamic YAML update',
      'updateDynamicYaml',
      [request, { clusterId: 'cluster-a', yaml: '{}', dryRun: false }],
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
          kind: 'Deployment',
          name: 'api',
          yaml: '{}',
          dryRun: false,
        },
      ],
    ],
    [
      'resource YAML apply',
      'applyYaml',
      [request, { clusterId: 'cluster-a', yaml: '{}', dryRun: false }],
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
    'syncs the authorized input cluster after %s even when the service returns another cluster',
    async (_label, method, args) => {
      const harness = createHarness();
      for (const serviceCall of Object.values(harness.resourcesService)) {
        serviceCall.mockResolvedValue({ clusterId: 'cluster-b' });
      }

      await harness.controller[method](...args);

      expect(harness.clustersService.getKubeconfig).toHaveBeenCalledWith(
        'cluster-a',
      );
      expect(harness.clustersService.getKubeconfig).not.toHaveBeenCalledWith(
        'cluster-b',
      );
      await Promise.resolve();
      expect(harness.clusterSyncService.syncCluster).toHaveBeenCalledWith(
        'cluster-a',
        'kubeconfig',
      );
    },
  );
});
