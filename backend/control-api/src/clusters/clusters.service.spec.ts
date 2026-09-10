jest.mock('@kubernetes/client-node', () => ({}));

import { BadRequestException } from '@nestjs/common';
import { ClustersService } from './clusters.service';
import type { ClusterRecord } from './clusters.repository';
import type { PrismaService } from '../platform/database/prisma.service';
import type { K8sClientService } from './k8s-client.service';

const BASE_RECORD: ClusterRecord = {
  id: 'c-001',
  name: 'prod-cn-hz',
  apiServer: 'https://api.example.test:6443',
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

const READONLY_ROLE_NAME = 'aiops:kubeconfig-export:read-only';
const READONLY_SERVICE_ACCOUNT = 'aiops-export-reader-c-001';
const EXPECTED_READONLY_RULES = [
  {
    apiGroups: [''],
    resources: ['namespaces', 'nodes', 'pods', 'services', 'endpoints'],
    verbs: ['get', 'list', 'watch'],
  },
  {
    apiGroups: ['apps'],
    resources: ['deployments', 'statefulsets', 'daemonsets', 'replicasets'],
    verbs: ['get', 'list', 'watch'],
  },
  {
    apiGroups: ['batch'],
    resources: ['jobs', 'cronjobs'],
    verbs: ['get', 'list', 'watch'],
  },
  {
    apiGroups: ['networking.k8s.io'],
    resources: ['ingresses', 'networkpolicies'],
    verbs: ['get', 'list', 'watch'],
  },
  {
    apiGroups: ['storage.k8s.io'],
    resources: ['storageclasses'],
    verbs: ['get', 'list', 'watch'],
  },
];

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
    inspectKubeconfig: jest.fn().mockReturnValue({
      apiServer: 'https://api.example.test:6443',
    }),
  } as unknown as K8sClientService;
  const service = new ClustersService(prismaMock, k8sClientService);
  (
    service as unknown as {
      repository: {
        findById: jest.Mock;
        findByName: jest.Mock;
        list: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
      };
    }
  ).repository = {
    findById: jest.fn(),
    findByName: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  return { service, prismaMock, k8sClientService };
}

function prepareReadonlyExport(options?: {
  cluster?: Partial<ClusterRecord>;
  token?: string;
  expirationTimestamp?: string;
}) {
  const { service, k8sClientService } = buildService();
  const repository = (
    service as unknown as { repository: { findById: jest.Mock } }
  ).repository;
  repository.findById.mockResolvedValue({
    ...BASE_RECORD,
    ...options?.cluster,
  });

  const coreApi = {
    readNamespacedServiceAccount: jest.fn().mockResolvedValue({}),
    createNamespacedServiceAccount: jest.fn().mockResolvedValue({}),
    createNamespacedServiceAccountToken: jest.fn().mockResolvedValue({
      status: {
        token: options?.token ?? 'short-lived-readonly-token',
        ...(options?.expirationTimestamp
          ? { expirationTimestamp: options.expirationTimestamp }
          : {}),
      },
    }),
  };
  const rbacApi = {
    readClusterRole: jest.fn().mockResolvedValue({
      metadata: { name: READONLY_ROLE_NAME, resourceVersion: 'role-v1' },
      rules: EXPECTED_READONLY_RULES,
    }),
    createClusterRole: jest.fn().mockResolvedValue({}),
    replaceClusterRole: jest.fn().mockResolvedValue({}),
    readClusterRoleBinding: jest.fn().mockResolvedValue({
      metadata: {
        name: `${READONLY_SERVICE_ACCOUNT}-binding`,
        resourceVersion: 'binding-v1',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: READONLY_ROLE_NAME,
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: READONLY_SERVICE_ACCOUNT,
          namespace: 'default',
        },
      ],
    }),
    createClusterRoleBinding: jest.fn().mockResolvedValue({}),
    replaceClusterRoleBinding: jest.fn().mockResolvedValue({}),
  };
  Object.assign(k8sClientService as object, {
    createClient: jest.fn().mockReturnValue({
      getCurrentCluster: jest.fn().mockReturnValue({
        server: 'https://api.example.test:6443',
        caData: 'cluster-ca-data',
      }),
    }),
    getCoreApi: jest.fn().mockReturnValue(coreApi),
    getRbacAuthorizationApi: jest.fn().mockReturnValue(rbacApi),
    exportKubeconfig: jest
      .fn()
      .mockReturnValue(
        [
          'apiVersion: v1',
          'users:',
          '- user:',
          `    token: ${options?.token ?? 'short-lived-readonly-token'}`,
          '',
        ].join('\n'),
      ),
  });

  return {
    service,
    k8sClientService: k8sClientService as unknown as {
      exportKubeconfig: jest.Mock;
    },
    coreApi,
    rbacApi,
  };
}

describe('ClustersService access-filtered listing', () => {
  it('passes the caller accessible cluster ids to the repository', async () => {
    const { service } = buildService();
    const repository = (
      service as unknown as { repository: { list: jest.Mock } }
    ).repository;
    repository.list.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });

    await service.list(
      { page: '1', pageSize: '10' },
      { accessibleClusterIds: ['cluster-a'] },
    );

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ accessibleClusterIds: ['cluster-a'] }),
    );
  });
});

describe('ClustersService detail', () => {
  it('does not expose a raw kubeconfig export method', () => {
    const { service } = buildService();

    expect(
      (service as unknown as Record<string, unknown>)[
        'getExportableKubeconfig'
      ],
    ).toBeUndefined();
  });

  it('fails closed when the token response has no expiration timestamp', async () => {
    const { service, k8sClientService } = prepareReadonlyExport();

    await expect(service.exportReadonlyKubeconfig('c-001')).rejects.toThrow(
      '过期时间',
    );
    expect(k8sClientService.exportKubeconfig).not.toHaveBeenCalled();
  });

  it('fails closed when the issued token lifetime is not short-lived', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T08:00:00.000Z'));
    try {
      const { service, k8sClientService } = prepareReadonlyExport({
        expirationTimestamp: '2026-09-10T10:00:00.000Z',
      });

      await expect(service.exportReadonlyKubeconfig('c-001')).rejects.toThrow(
        '有效期',
      );
      expect(k8sClientService.exportKubeconfig).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('requests a one-hour scoped token and exports only that credential', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { service, k8sClientService, coreApi } = prepareReadonlyExport({
      token: 'short-lived-readonly-token',
      expirationTimestamp: expiresAt,
      cluster: {
        kubeconfig:
          'apiVersion: v1\nusers:\n- user:\n    client-key-data: source-admin-secret\n',
      },
    });

    const result = await service.exportReadonlyKubeconfig('c-001');

    expect(coreApi.createNamespacedServiceAccountToken).toHaveBeenCalledWith({
      name: READONLY_SERVICE_ACCOUNT,
      namespace: 'default',
      body: {
        spec: {
          audiences: ['api'],
          expirationSeconds: 3600,
        },
      },
    });
    expect(k8sClientService.exportKubeconfig).toHaveBeenCalledWith({
      clusterName: 'cluster-prod-cn-hz',
      server: 'https://api.example.test:6443',
      caData: 'cluster-ca-data',
      skipTLSVerify: false,
      userName: `${READONLY_SERVICE_ACCOUNT}-token`,
      contextName: 'prod-cn-hz-readonly',
      namespace: 'default',
      token: 'short-lived-readonly-token',
    });
    expect(result.expiresAt).toBe(expiresAt);
    expect(result.content).not.toContain('source-admin-secret');
    expect(result.content).not.toContain('client-key-data');
  });

  it('reconciles an over-privileged existing ClusterRole to exact read-only rules', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { service, rbacApi, coreApi } = prepareReadonlyExport({
      expirationTimestamp: expiresAt,
    });
    rbacApi.readClusterRole.mockResolvedValue({
      metadata: { name: READONLY_ROLE_NAME, resourceVersion: 'role-dangerous' },
      rules: [{ apiGroups: ['*'], resources: ['*'], verbs: ['*'] }],
    });

    await service.exportReadonlyKubeconfig('c-001');

    expect(rbacApi.replaceClusterRole).toHaveBeenCalledWith({
      name: READONLY_ROLE_NAME,
      body: {
        metadata: {
          name: READONLY_ROLE_NAME,
          resourceVersion: 'role-dangerous',
        },
        rules: EXPECTED_READONLY_RULES,
      },
    });
    expect(rbacApi.replaceClusterRole.mock.invocationCallOrder[0]).toBeLessThan(
      coreApi.createNamespacedServiceAccountToken.mock.invocationCallOrder[0],
    );
  });

  it('reconciles an existing binding that points at cluster-admin', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { service, rbacApi, coreApi } = prepareReadonlyExport({
      expirationTimestamp: expiresAt,
    });
    rbacApi.readClusterRoleBinding.mockResolvedValue({
      metadata: {
        name: `${READONLY_SERVICE_ACCOUNT}-binding`,
        resourceVersion: 'binding-dangerous',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: 'cluster-admin',
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: READONLY_SERVICE_ACCOUNT,
          namespace: 'default',
        },
      ],
    });

    await service.exportReadonlyKubeconfig('c-001');

    expect(rbacApi.replaceClusterRoleBinding).toHaveBeenCalledWith({
      name: `${READONLY_SERVICE_ACCOUNT}-binding`,
      body: {
        metadata: {
          name: `${READONLY_SERVICE_ACCOUNT}-binding`,
          resourceVersion: 'binding-dangerous',
        },
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: READONLY_ROLE_NAME,
        },
        subjects: [
          {
            kind: 'ServiceAccount',
            name: READONLY_SERVICE_ACCOUNT,
            namespace: 'default',
          },
        ],
      },
    });
    expect(
      rbacApi.replaceClusterRoleBinding.mock.invocationCallOrder[0],
    ).toBeLessThan(
      coreApi.createNamespacedServiceAccountToken.mock.invocationCallOrder[0],
    );
  });

  it('reconciles an existing binding with any additional subject', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { service, rbacApi } = prepareReadonlyExport({
      expirationTimestamp: expiresAt,
    });
    rbacApi.readClusterRoleBinding.mockResolvedValue({
      metadata: {
        name: `${READONLY_SERVICE_ACCOUNT}-binding`,
        resourceVersion: 'binding-extra-subject',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: READONLY_ROLE_NAME,
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: READONLY_SERVICE_ACCOUNT,
          namespace: 'default',
        },
        {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'Group',
          name: 'system:masters',
        },
      ],
    });

    await service.exportReadonlyKubeconfig('c-001');

    expect(rbacApi.replaceClusterRoleBinding).toHaveBeenCalledWith({
      name: `${READONLY_SERVICE_ACCOUNT}-binding`,
      body: {
        metadata: {
          name: `${READONLY_SERVICE_ACCOUNT}-binding`,
          resourceVersion: 'binding-extra-subject',
        },
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: READONLY_ROLE_NAME,
        },
        subjects: [
          {
            kind: 'ServiceAccount',
            name: READONLY_SERVICE_ACCOUNT,
            namespace: 'default',
          },
        ],
      },
    });
  });

  it('does not request a token when reading export RBAC fails', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { service, rbacApi, coreApi } = prepareReadonlyExport({
      expirationTimestamp: expiresAt,
    });
    rbacApi.readClusterRole.mockRejectedValue({
      response: { statusCode: 403 },
      message: 'forbidden',
    });

    await expect(service.exportReadonlyKubeconfig('c-001')).rejects.toEqual(
      expect.objectContaining({ message: 'forbidden' }),
    );
    expect(rbacApi.createClusterRole).not.toHaveBeenCalled();
    expect(coreApi.createNamespacedServiceAccountToken).not.toHaveBeenCalled();
  });

  it('does not request a token when reconciling export RBAC fails', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { service, rbacApi, coreApi } = prepareReadonlyExport({
      expirationTimestamp: expiresAt,
    });
    rbacApi.readClusterRole.mockResolvedValue({
      metadata: { name: READONLY_ROLE_NAME, resourceVersion: 'role-dangerous' },
      rules: [{ apiGroups: ['*'], resources: ['*'], verbs: ['*'] }],
    });
    rbacApi.replaceClusterRole.mockRejectedValue(new Error('replace denied'));

    await expect(service.exportReadonlyKubeconfig('c-001')).rejects.toThrow(
      'replace denied',
    );
    expect(coreApi.createNamespacedServiceAccountToken).not.toHaveBeenCalled();
  });

  it('does not request a token when reading the export binding fails', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { service, rbacApi, coreApi } = prepareReadonlyExport({
      expirationTimestamp: expiresAt,
    });
    rbacApi.readClusterRoleBinding.mockRejectedValue({
      response: { statusCode: 403 },
      message: 'binding forbidden',
    });

    await expect(service.exportReadonlyKubeconfig('c-001')).rejects.toEqual(
      expect.objectContaining({ message: 'binding forbidden' }),
    );
    expect(rbacApi.createClusterRoleBinding).not.toHaveBeenCalled();
    expect(coreApi.createNamespacedServiceAccountToken).not.toHaveBeenCalled();
  });

  it('does not request a token when reconciling the export binding fails', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { service, rbacApi, coreApi } = prepareReadonlyExport({
      expirationTimestamp: expiresAt,
    });
    rbacApi.readClusterRoleBinding.mockResolvedValue({
      metadata: {
        name: `${READONLY_SERVICE_ACCOUNT}-binding`,
        resourceVersion: 'binding-dangerous',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: 'cluster-admin',
      },
      subjects: [],
    });
    rbacApi.replaceClusterRoleBinding.mockRejectedValue(
      new Error('binding replace denied'),
    );

    await expect(service.exportReadonlyKubeconfig('c-001')).rejects.toThrow(
      'binding replace denied',
    );
    expect(coreApi.createNamespacedServiceAccountToken).not.toHaveBeenCalled();
  });

  it('creates cluster with API Server parsed from kubeconfig and ignores manual version', async () => {
    const { service, k8sClientService } = buildService();
    const repository = (
      service as unknown as {
        repository: { findByName: jest.Mock; create: jest.Mock };
      }
    ).repository;
    repository.findByName.mockResolvedValue(null);
    repository.create.mockImplementation(async (record: ClusterRecord) => ({
      ...record,
      id: 'c-created',
    }));

    const created = await service.create({
      name: 'ack-prod',
      environment: '公有云',
      provider: 'ACK',
      kubernetesVersion: 'manual-value-must-be-ignored',
      kubeconfig: 'apiVersion: v1',
    });

    expect(k8sClientService.inspectKubeconfig).toHaveBeenCalledWith(
      'apiVersion: v1',
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        apiServer: 'https://api.example.test:6443',
        kubernetesVersion: 'unknown',
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        apiServer: 'https://api.example.test:6443',
        kubernetesVersion: 'unknown',
      }),
    );
  });

  it('rejects malformed kubeconfig before saving cluster', async () => {
    const { service, k8sClientService } = buildService();
    const repository = (
      service as unknown as { repository: { create: jest.Mock } }
    ).repository;
    (k8sClientService.inspectKubeconfig as jest.Mock).mockImplementation(() => {
      throw new Error('当前 context 不存在');
    });

    await expect(
      service.create({
        name: 'ack-prod',
        environment: '公有云',
        provider: 'ACK',
        kubeconfig: 'bad config',
      }),
    ).rejects.toThrow('kubeconfig 无效：当前 context 不存在');
    expect(repository.create).not.toHaveBeenCalled();
  });

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
    expect(detail.nodeSummary.degraded).toBe(false);
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

  it('returns degraded node inventory when kubeconfig is missing', async () => {
    const { service } = buildService();
    const repository = (
      service as unknown as { repository: { findById: jest.Mock } }
    ).repository;
    repository.findById.mockResolvedValue({
      ...BASE_RECORD,
      kubeconfig: undefined,
    });

    const nodes = await service.listNodes('c-001');

    expect(nodes.items).toEqual([]);
    expect(nodes.total).toBe(0);
    expect(nodes.degraded).toBe(true);
    expect(nodes.degradationReason).toContain('kubeconfig');
  });

  it('marks cluster detail node summary degraded when kubeconfig is missing', async () => {
    const { service, prismaMock } = buildService();
    const repository = (
      service as unknown as { repository: { findById: jest.Mock } }
    ).repository;
    repository.findById.mockResolvedValue({
      ...BASE_RECORD,
      kubeconfig: undefined,
    });
    (
      prismaMock.clusterHealthSnapshot.findUnique as jest.Mock
    ).mockResolvedValue(null);

    const detail = await service.getDetail('c-001');

    expect(detail.nodeSummary.items).toEqual([]);
    expect(detail.nodeSummary.degraded).toBe(true);
    expect(detail.nodeSummary.degradationReason).toContain('kubeconfig');
    expect(detail.runtimeStatus).toBe('offline-mode');
  });

  it('returns degraded cluster detail when the Kubernetes node API stalls', async () => {
    const previousTimeout = process.env.CLUSTER_NODE_REQUEST_TIMEOUT_MS;
    process.env.CLUSTER_NODE_REQUEST_TIMEOUT_MS = '10';

    try {
      const { service, prismaMock, k8sClientService } = buildService();
      const repository = (
        service as unknown as { repository: { findById: jest.Mock } }
      ).repository;
      repository.findById.mockResolvedValue(BASE_RECORD);
      (
        prismaMock.clusterHealthSnapshot.findUnique as jest.Mock
      ).mockResolvedValue({
        checkedAt: new Date('2026-01-02T00:00:00.000Z'),
        status: 'offline',
        ok: false,
        reason: 'probe timeout',
        detailJson: { version: 'v1.30.2' },
      });
      (k8sClientService.getCoreApi as jest.Mock).mockReturnValue({
        listNode: jest.fn(() => new Promise(() => undefined)),
      });

      const result = await Promise.race([
        service.getDetail('c-001'),
        new Promise<'test-timeout'>((resolve) =>
          setTimeout(() => resolve('test-timeout'), 100),
        ),
      ]);

      expect(result).not.toBe('test-timeout');
      expect(result).toMatchObject({
        id: 'c-001',
        runtimeStatus: 'offline',
        nodeSummary: {
          items: [],
          degraded: true,
        },
      });
      expect(
        (result as Awaited<ReturnType<typeof service.getDetail>>).nodeSummary
          .degradationReason,
      ).toContain('timeout after 10ms');
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.CLUSTER_NODE_REQUEST_TIMEOUT_MS;
      } else {
        process.env.CLUSTER_NODE_REQUEST_TIMEOUT_MS = previousTimeout;
      }
    }
  });
});
