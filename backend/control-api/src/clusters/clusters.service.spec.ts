jest.mock('@kubernetes/client-node', () => ({}));

import { BadRequestException } from '@nestjs/common';
import { ClustersService } from './clusters.service';
import type { ClusterRecord } from './clusters.repository';
import type { PrismaService } from '../platform/database/prisma.service';
import type { K8sClientService } from './k8s-client.service';

const BASE_RECORD: ClusterRecord = {
  id: 'c-001',
  name: 'prod-cn-hz',
  environment: '公有云',
  status: '正常',
  cpuUsage: 10,
  memoryUsage: 20,
  storageUsage: 30,
  provider: 'ACK',
  kubernetesVersion: 'v1.30.2',
  state: 'active',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  kubeconfig: 'apiVersion: v1',
};

function buildService() {
  const prismaMock = {
    clusterRegistry: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
    },
    clusterProfile: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(null),
    },
    clusterHealthSnapshot: {
      findUnique: jest.fn(),
    },
  } as unknown as PrismaService;
  const k8sClientService = {
    getCoreApi: jest.fn(),
  } as unknown as K8sClientService;
  const service = new ClustersService(prismaMock, k8sClientService);
  (service as unknown as { repository: { findById: jest.Mock } }).repository = {
    findById: jest.fn(),
    findByName: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  return { service, prismaMock, k8sClientService };
}

describe('ClustersService detail', () => {
  it('builds detail from cluster, profile, health and node inventory', async () => {
    const { service, prismaMock, k8sClientService } = buildService();
    const repository = (
      service as unknown as { repository: { findById: jest.Mock } }
    ).repository;
    repository.findById.mockResolvedValue(BASE_RECORD);
    (prismaMock.clusterProfile.findUnique as jest.Mock).mockResolvedValue({
      clusterId: 'c-001',
      environmentType: 'public-cloud',
      provider: 'ACK',
      region: 'cn-hz',
      labelsJson: { displayName: '杭州生产集群' },
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    (
      prismaMock.clusterHealthSnapshot.findUnique as jest.Mock
    ).mockResolvedValue({
      checkedAt: new Date('2026-01-02T00:00:00.000Z'),
      status: 'running',
      ok: true,
      reason: null,
      detailJson: {
        version: 'v1.30.2',
        cniPlugin: 'calico',
        criRuntime: 'containerd',
      },
    });
    (k8sClientService.getCoreApi as jest.Mock).mockReturnValue({
      listNode: jest.fn().mockResolvedValue({
        items: [
          {
            metadata: {
              name: 'node-a',
              labels: {
                'node-role.kubernetes.io/control-plane': '',
              },
            },
            status: {
              conditions: [{ type: 'Ready', status: 'True' }],
              nodeInfo: { kubeletVersion: 'v1.30.2' },
            },
          },
          {
            metadata: { name: 'node-b', labels: {} },
            status: {
              conditions: [{ type: 'Ready', status: 'False' }],
              nodeInfo: { kubeletVersion: 'v1.30.2' },
            },
          },
        ],
      }),
    });

    const detail = await service.getDetail('c-001');

    expect(detail.id).toBe('c-001');
    expect(detail.displayName).toBe('杭州生产集群');
    expect(detail.nodeSummary.total).toBe(2);
    expect(detail.nodeSummary.ready).toBe(1);
    expect(detail.platform.cniPlugin).toBe('calico');
    expect(detail.platform.criRuntime).toBe('containerd');
    expect(detail.runtimeStatus).toBe('running');
  });

  it('throws when cluster id is empty', async () => {
    const { service } = buildService();
    await expect(service.getDetail('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
