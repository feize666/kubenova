jest.mock('@kubernetes/client-node', () => ({
  dumpYaml: (value: unknown) => JSON.stringify(value),
  BatchV1Api: class BatchV1Api {},
}));

import { WorkloadsService } from './workloads.service';
import { BadRequestException } from '@nestjs/common';
import type { WorkloadsRepository } from './workloads.repository';
import type { StorageService } from '../storage/storage.service';
import type { NetworkService } from '../network/network.service';
import type { ClustersService } from '../clusters/clusters.service';
import type { ClusterSyncService } from '../clusters/cluster-sync.service';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { ClusterEventSyncService } from '../clusters/cluster-event-sync.service';
import type { K8sClientService } from '../clusters/k8s-client.service';
import type { LiveMetricsService } from '../metrics/live-metrics.service';
import type { PrismaService } from '../platform/database/prisma.service';

interface WorkloadsRepositoryMock {
  list: jest.Mock;
  findByKey?: jest.Mock;
  getClusterKubeconfig?: jest.Mock;
  create?: jest.Mock;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

describe('WorkloadsService list online gate', () => {
  function build() {
    const repository: WorkloadsRepositoryMock = {
      list: jest.fn(),
    };
    const storageService = {} as StorageService;
    const networkService = {} as NetworkService;
    const clustersService = {
      getKubeconfig: jest.fn(),
    } as unknown as ClustersService;
    const clusterSyncService = {
      syncCluster: jest.fn(),
    };
    const clusterEventSyncService = {
      consumeClusterDirty: jest.fn().mockReturnValue(false),
    } as unknown as ClusterEventSyncService;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    };
    const k8sClientService = {} as K8sClientService;
    const liveMetricsService = {
      getClusterSnapshot: jest.fn(),
    } as unknown as LiveMetricsService;
    const prisma = {} as PrismaService;

    const service = new WorkloadsService(
      repository as unknown as WorkloadsRepository,
      storageService,
      networkService,
      clustersService,
      clusterSyncService as unknown as ClusterSyncService,
      clusterHealthService as unknown as ClusterHealthService,
      clusterEventSyncService,
      k8sClientService,
      liveMetricsService,
      prisma,
    );
    return { service, repository, clusterHealthService, clusterSyncService };
  }

  it('returns empty when no readable clusters', async () => {
    const { service, repository, clusterHealthService } = build();
    clusterHealthService.listReadableClusterIdsForResourceRead.mockResolvedValue(
      [],
    );

    const result = await service.list({ page: '2', pageSize: '9' });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(9);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('passes clusterIds when clusterId is absent', async () => {
    const { service, repository, clusterHealthService, clusterSyncService } =
      build();
    clusterHealthService.listReadableClusterIdsForResourceRead.mockResolvedValue(
      ['c-1', 'c-2'],
    );
    clusterSyncService.syncCluster.mockResolvedValue({
      errors: [],
    });
    (
      service as unknown as { clustersService: { getKubeconfig: jest.Mock } }
    ).clustersService.getKubeconfig.mockResolvedValue('kubeconfig');
    repository.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });

    await service.list({ keyword: 'nginx' });

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: undefined,
        clusterIds: ['c-1', 'c-2'],
      }),
    );
    expect(clusterSyncService.syncCluster).toHaveBeenCalledTimes(2);
  });

  it('asserts online for explicit clusterId', async () => {
    const { service, repository, clusterHealthService } = build();
    repository.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });

    await service.list({ clusterId: ' c-1 ' });

    expect(
      clusterHealthService.assertClusterOnlineForRead,
    ).toHaveBeenCalledWith('c-1');
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c-1', clusterIds: undefined }),
    );
  });

  it('passes normalized sortBy/sortOrder to repository', async () => {
    const { service, repository, clusterHealthService } = build();
    repository.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    clusterHealthService.listReadableClusterIdsForResourceRead.mockResolvedValue(
      ['c-1'],
    );

    await service.list({
      kind: 'pods',
      sortBy: 'name',
      sortOrder: 'ASC',
    });

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        sortBy: 'name',
        sortOrder: 'asc',
      }),
    );
  });

  it('ignores invalid sortBy/sortOrder and keeps default behavior', async () => {
    const { service, repository, clusterHealthService } = build();
    repository.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    clusterHealthService.listReadableClusterIdsForResourceRead.mockResolvedValue(
      ['c-1'],
    );

    await service.list({
      sortBy: 'unknownField',
      sortOrder: 'SIDEWAYS',
    });

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: undefined,
        sortOrder: undefined,
      }),
    );
  });

  it('keeps default list payload unchanged', async () => {
    const { service, repository, clusterHealthService } = build();
    const record = {
      id: 'w-1',
      clusterId: 'c-1',
      namespace: 'default',
      kind: 'Deployment',
      name: 'web',
      state: 'active',
      replicas: 2,
      readyReplicas: 1,
      spec: { template: { spec: { containers: [{ image: 'nginx' }] } } },
      statusJson: { availableReplicas: 1 },
      labels: { app: 'web' },
      annotations: { checksum: 'abc' },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:01:00.000Z'),
    };
    repository.list.mockResolvedValue({
      items: [record],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    clusterHealthService.listReadableClusterIdsForResourceRead.mockResolvedValue(
      ['c-1'],
    );

    const result = await service.list({});

    expect(result.items).toEqual([record]);
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ projection: undefined }),
    );
  });

  it('returns slim topology projection without raw json payloads', async () => {
    const { service, repository, clusterHealthService, clusterSyncService } =
      build();
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    clusterSyncService.syncCluster.mockResolvedValue({
      errors: [],
    });
    (
      service as unknown as { clustersService: { getKubeconfig: jest.Mock } }
    ).clustersService.getKubeconfig.mockResolvedValue('kubeconfig');
    clusterHealthService.listReadableClusterIdsForResourceRead.mockResolvedValue(
      ['c-1'],
    );
    repository.list.mockResolvedValue({
      items: [
        {
          id: 'pod-1',
          clusterId: 'c-1',
          namespace: 'default',
          kind: 'Pod',
          name: 'web-abc',
          state: 'active',
          replicas: 1,
          readyReplicas: 1,
          spec: null,
          statusJson: {
            phase: 'Running',
            nodeName: 'node-1',
            restartCount: 3,
            ownerReferences: [{ kind: 'ReplicaSet', name: 'web-abc' }],
            creationTimestamp: createdAt.toISOString(),
          },
          labels: { app: 'web' },
          annotations: null,
          createdAt,
          updatedAt: new Date('2026-01-01T00:01:00.000Z'),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });

    const result = await service.list({
      kind: 'pods',
      projection: 'topology',
    });
    const item = result.items[0] as unknown as Record<string, unknown>;

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        projection: 'topology',
      }),
    );
    expect(item).toEqual(
      expect.objectContaining({
        id: 'pod-1',
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Pod',
        name: 'web-abc',
        status: 'Running',
        podPhase: 'Running',
        nodeName: 'node-1',
        restarts: 3,
        ownerRefs: [{ kind: 'ReplicaSet', name: 'web-abc' }],
      }),
    );
    expect(item).not.toHaveProperty('spec');
    expect(item).not.toHaveProperty('statusJson');
    expect(item).not.toHaveProperty('annotations');
  });
});

describe('WorkloadsService workspace advanced validation', () => {
  function build() {
    const repository: Required<WorkloadsRepositoryMock> = {
      findByKey: jest.fn().mockResolvedValue(null),
      getClusterKubeconfig: jest.fn().mockResolvedValue('kubeconfig'),
      create: jest.fn().mockImplementation((payload: unknown) => {
        const data = asRecord(payload);
        return Promise.resolve({
          id: 'w-1',
          clusterId: data.clusterId,
          namespace: data.namespace,
          kind: data.kind,
          name: data.name,
          state: 'active',
          replicas: data.replicas ?? 1,
          readyReplicas: data.readyReplicas ?? 0,
          spec: data.spec,
        });
      }),
      list: jest.fn(),
    };
    const storageService = {
      create: jest.fn(),
    } as unknown as StorageService;
    const networkService = {
      create: jest.fn(),
    } as unknown as NetworkService;
    const clustersService = {
      getKubeconfig: jest.fn(),
    } as unknown as ClustersService;
    const clusterSyncService = {
      syncCluster: jest.fn(),
    } as unknown as ClusterSyncService;
    const clusterEventSyncService = {
      consumeClusterDirty: jest.fn().mockReturnValue(false),
    } as unknown as ClusterEventSyncService;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    } as unknown as ClusterHealthService;
    const k8sClientService = {
      getAppsApi: jest.fn().mockReturnValue({
        createNamespacedDeployment: jest.fn().mockResolvedValue({}),
      }),
      getCoreApi: jest.fn().mockReturnValue({}),
      createClient: jest.fn().mockReturnValue({
        makeApiClient: jest.fn().mockReturnValue({}),
      }),
    } as unknown as K8sClientService;
    const liveMetricsService = {
      getClusterSnapshot: jest.fn(),
    } as unknown as LiveMetricsService;
    const prisma = {
      clusterRegistry: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }),
      },
      storageResource: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;

    const service = new WorkloadsService(
      repository as unknown as WorkloadsRepository,
      storageService,
      networkService,
      clustersService,
      clusterSyncService,
      clusterHealthService,
      clusterEventSyncService,
      k8sClientService,
      liveMetricsService,
      prisma,
    );

    return { service, repository };
  }

  it('returns step + fieldPath for scheduling and probes validation', async () => {
    const { service } = build();

    const result = await service.validateWorkspace({
      clusterId: 'c-1',
      namespace: 'default',
      kind: 'Deployment',
      name: 'demo',
      image: 'nginx:1.25',
      scheduling: {
        nodeSelector: 'bad-format',
      },
      probes: {
        liveness: {
          enabled: true,
          type: 'httpGet',
          timeoutSeconds: 0,
          periodSeconds: 5,
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'advanced',
          fieldPath: 'scheduling.nodeSelector',
          field: 'scheduling.nodeSelector',
        }),
        expect.objectContaining({
          step: 'advanced',
          fieldPath: 'probes.liveness.path',
          field: 'probes.liveness.path',
        }),
        expect.objectContaining({
          step: 'advanced',
          fieldPath: 'probes.liveness.port',
          field: 'probes.liveness.port',
        }),
        expect.objectContaining({
          step: 'advanced',
          fieldPath: 'probes.liveness.timeoutSeconds',
        }),
      ]),
    );
  });

  it('rejects probe time ranges when upper bound exceeded', async () => {
    const { service } = build();

    const result = await service.validateWorkspace({
      clusterId: 'c-1',
      namespace: 'default',
      kind: 'Deployment',
      name: 'demo',
      image: 'nginx:1.25',
      probes: {
        readiness: {
          enabled: true,
          type: 'tcpSocket',
          port: 8080,
          periodSeconds: 3601,
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'advanced',
          fieldPath: 'probes.readiness.periodSeconds',
        }),
      ]),
    );
    const readinessError = result.errors.find(
      (error) => error.fieldPath === 'probes.readiness.periodSeconds',
    );
    expect(readinessError?.message).toContain('范围内');
  });

  it('keeps render-yaml and submit serialization from same normalized source', async () => {
    const { service, repository } = build();

    const request = {
      clusterId: ' c-1 ',
      namespace: ' default ',
      kind: 'deployment',
      name: 'demo-app',
      image: 'nginx:1.25',
      replicas: 2,
      scheduling: {
        nodeSelector: 'disktype=ssd',
      },
      probes: {
        liveness: {
          enabled: true,
          type: 'httpGet' as const,
          path: '/healthz',
          port: 8080,
          timeoutSeconds: 2,
          periodSeconds: 5,
        },
      },
    };

    const rendered = await service.renderWorkspaceYaml(request);
    await service.submitWorkspace(request);

    const workloadManifest = rendered.manifests.find(
      (item) => item.source === 'workload',
    );
    expect(workloadManifest).toBeDefined();
    const renderedSpec = asRecord(JSON.parse(workloadManifest!.yaml)).spec;
    const submitCall = repository.create.mock.calls.at(0) as
      | unknown[]
      | undefined;
    const submitPayload = asRecord(submitCall?.[0]);
    const submitSpec = submitPayload.spec;

    expect(submitPayload).toEqual(
      expect.objectContaining({
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Deployment',
        name: 'demo-app',
      }),
    );
    expect(submitSpec).toEqual(renderedSpec);
  });

  it('submit returns validation error payload with fieldPath when probe invalid', async () => {
    const { service } = build();

    await expect(
      service.submitWorkspace({
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Deployment',
        name: 'demo',
        image: 'nginx:1.25',
        probes: {
          startup: {
            enabled: true,
            type: 'exec',
            timeoutSeconds: 8,
            periodSeconds: 3,
          },
        },
      }),
    ).rejects.toThrow(BadRequestException);

    await service
      .submitWorkspace({
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Deployment',
        name: 'demo',
        image: 'nginx:1.25',
        probes: {
          startup: {
            enabled: true,
            type: 'exec',
            timeoutSeconds: 8,
            periodSeconds: 3,
          },
        },
      })
      .catch((error: BadRequestException) => {
        const payload = error.getResponse() as {
          details?: { errors?: Array<{ fieldPath?: string; step?: string }> };
        };
        expect(payload.details?.errors?.[0]).toEqual(
          expect.objectContaining({
            step: 'advanced',
            fieldPath: 'probes.startup.command',
          }),
        );
      });
  });
});
