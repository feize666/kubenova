jest.mock('@kubernetes/client-node', () => ({
  dumpYaml: (value: unknown) => JSON.stringify(value, null, 2),
}));

import { WorkloadsService } from './workloads.service';
import type { WorkloadsRepository } from './workloads.repository';
import type { StorageService } from '../storage/storage.service';
import type { NetworkService } from '../network/network.service';
import type { ClustersService } from '../clusters/clusters.service';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { K8sClientService } from '../clusters/k8s-client.service';
import type { LiveMetricsService } from '../metrics/live-metrics.service';
import type { PrismaService } from '../platform/database/prisma.service';

describe('WorkloadsService manual image fallback', () => {
  function build() {
    const repository = {
      findByKey: jest.fn().mockResolvedValue(null),
      list: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      setState: jest.fn(),
    } as unknown as WorkloadsRepository;

    const storageService = {} as StorageService;
    const networkService = {} as NetworkService;
    const clustersService = {
      getKubeconfig: jest.fn(),
    } as unknown as ClustersService;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    } as unknown as ClusterHealthService;
    const k8sClientService = {
      createClient: jest.fn(),
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
      repository,
      storageService,
      networkService,
      clustersService,
      { watchClusterResources: jest.fn() } as never,
      clusterHealthService,
      { emitClusterRefresh: jest.fn() } as never,
      k8sClientService,
      liveMetricsService,
      prisma,
    );

    return { service, repository };
  }

  it('validateWorkspace accepts manual image reference without registry connector dependency', async () => {
    const { service } = build();

    const validation = await service.validateWorkspace({
      clusterId: 'c-1',
      namespace: 'default',
      kind: 'Deployment',
      name: 'demo-app',
      image: 'manual.registry.local/team/demo:v1.2.3',
      replicas: 1,
    });

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('renderWorkspaceYaml keeps manual image value as submit source of truth', async () => {
    const { service } = build();

    const rendered = await service.renderWorkspaceYaml({
      clusterId: 'c-1',
      namespace: 'default',
      kind: 'Deployment',
      name: 'demo-app',
      image: 'manual.registry.local/team/demo:v1.2.3',
      replicas: 2,
    });

    expect(rendered.summary.image).toBe(
      'manual.registry.local/team/demo:v1.2.3',
    );
    expect(rendered.yaml).toContain(
      '"image": "manual.registry.local/team/demo:v1.2.3"',
    );
  });
});
