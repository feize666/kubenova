jest.mock('@kubernetes/client-node', () => ({}));

import { NotFoundException } from '@nestjs/common';
import { ResourcesService } from './resources.service';

describe('ResourcesService detail cluster scope resolution', () => {
  function harness() {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      workloadRecord: { findFirst: jest.fn().mockResolvedValue(null) },
      networkResource: { findFirst: jest.fn().mockResolvedValue(null) },
      storageResource: { findFirst: jest.fn().mockResolvedValue(null) },
      configResource: { findFirst: jest.fn().mockResolvedValue(null) },
      namespaceRecord: { findFirst: jest.fn().mockResolvedValue(null) },
      clusterRegistry: { findFirst },
    };
    const clustersService = { getKubeconfig: jest.fn() };
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    };
    const k8sClientService = {
      createClient: jest.fn(),
      getCoreApi: jest.fn(),
    };
    const service = new ResourcesService(
      clustersService as never,
      clusterHealthService as never,
      k8sClientService as never,
      prisma as never,
    );
    return {
      service,
      prisma,
      clustersService,
      clusterHealthService,
      k8sClientService,
    };
  }

  it.each([
    [
      'dynamic resource',
      'dynamic',
      'dynamic:cluster-a:example.com:v1:widgets:default:demo',
      'namespace',
    ],
    ['Helm release', 'helmrelease', 'cluster-a/default/demo', 'namespace'],
    ['Helm repository', 'helmrepository', 'cluster-a/stable', 'cluster'],
    ['live node', 'node', 'live-node:cluster-a:worker-1', 'cluster'],
    [
      'live network resource',
      'service',
      'live:cluster-a:Service:default:api',
      'namespace',
    ],
    [
      'live namespace',
      'namespace',
      'live-namespace:cluster-a:default',
      'cluster',
    ],
    [
      'autoscaling identity',
      'horizontalpodautoscaler',
      'cluster-a/default/api',
      'namespace',
    ],
  ])(
    'parses %s ownership without Kubernetes, health, Helm, or database calls',
    async (_label, kind, id, scope) => {
      const h = harness();
      await expect(
        h.service.resolveDetailClusterScope(kind, id, ['cluster-a']),
      ).resolves.toEqual({ clusterId: 'cluster-a', scope });
      expect(
        h.clusterHealthService.assertClusterOnlineForRead,
      ).not.toHaveBeenCalled();
      expect(h.clustersService.getKubeconfig).not.toHaveBeenCalled();
      expect(h.k8sClientService.createClient).not.toHaveBeenCalled();
      expect(h.prisma.workloadRecord.findFirst).not.toHaveBeenCalled();
    },
  );

  it('resolves an opaque database id with a clusterId-only access-constrained query', async () => {
    const h = harness();
    h.prisma.workloadRecord.findFirst.mockResolvedValue({
      clusterId: 'cluster-a',
    });

    await expect(
      h.service.resolveDetailClusterScope('deployment', 'opaque-cuid', [
        'cluster-a',
      ]),
    ).resolves.toEqual({ clusterId: 'cluster-a', scope: 'namespace' });
    expect(h.prisma.workloadRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'opaque-cuid',
        clusterId: { in: ['cluster-a'] },
        kind: 'Deployment',
        state: { not: 'deleted' },
      },
      select: { clusterId: true },
    });
    expect(
      h.clusterHealthService.assertClusterOnlineForRead,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ['disallowed parsed cluster', 'node', 'live-node:cluster-b:worker-1'],
    [
      'kind-mismatched live id',
      'ingress',
      'live:cluster-a:Service:default:api',
    ],
    ['malformed Helm id', 'helmrelease', 'invalid'],
    ['missing opaque id', 'deployment', 'missing-cuid'],
  ])(
    'normalizes %s to the opaque not-found response',
    async (_label, kind, id) => {
      const h = harness();
      await expect(
        h.service.resolveDetailClusterScope(kind, id, ['cluster-a']),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'RESOURCE_NOT_FOUND_OR_INACCESSIBLE',
        }),
      });
    },
  );

  it('does not query globally when the caller has no accessible clusters', async () => {
    const h = harness();
    await expect(
      h.service.resolveDetailClusterScope('deployment', 'opaque-cuid', []),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prisma.workloadRecord.findFirst).not.toHaveBeenCalled();
  });
});
