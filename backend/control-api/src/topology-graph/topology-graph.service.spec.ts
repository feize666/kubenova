jest.mock('@kubernetes/client-node', () => ({}));

import { TopologyGraphService } from './topology-graph.service';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { PrismaService } from '../platform/database/prisma.service';
import type { TopologyGraphCacheService } from './topology-graph-cache.service';

describe('TopologyGraphService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function build() {
    const prisma = {
      workloadRecord: { findMany: jest.fn(), aggregate: jest.fn() },
      networkResource: { findMany: jest.fn(), aggregate: jest.fn() },
      storageResource: { findMany: jest.fn(), aggregate: jest.fn() },
      configResource: { findMany: jest.fn(), aggregate: jest.fn() },
      monitoringAlert: { findMany: jest.fn(), aggregate: jest.fn() },
    } as unknown as PrismaService;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
      getLatestSnapshot: jest.fn().mockResolvedValue({
        ok: true,
        isStale: false,
        checkedAt: new Date().toISOString(),
      }),
      probeCluster: jest.fn(),
    } as unknown as ClusterHealthService;
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as TopologyGraphCacheService;
    return {
      service: new TopologyGraphService(prisma, clusterHealthService, cache),
      prisma,
      clusterHealthService,
      cache,
    };
  }

  function mockTables(
    prisma: PrismaService,
    values: Partial<
      Record<
        'workloads' | 'network' | 'storage' | 'configs' | 'alerts',
        unknown[]
      >
    > = {},
  ) {
    (prisma.workloadRecord.findMany as jest.Mock).mockResolvedValue(
      values.workloads ?? [],
    );
    (prisma.networkResource.findMany as jest.Mock).mockResolvedValue(
      values.network ?? [],
    );
    (prisma.storageResource.findMany as jest.Mock).mockResolvedValue(
      values.storage ?? [],
    );
    (prisma.configResource.findMany as jest.Mock).mockResolvedValue(
      values.configs ?? [],
    );
    (prisma.monitoringAlert.findMany as jest.Mock).mockResolvedValue(
      values.alerts ?? [],
    );
    mockAggregate(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      prisma.workloadRecord.aggregate as jest.Mock,
      values.workloads,
    );
    mockAggregate(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      prisma.networkResource.aggregate as jest.Mock,
      values.network,
    );
    mockAggregate(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      prisma.storageResource.aggregate as jest.Mock,
      values.storage,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const configAggregate = prisma.configResource.aggregate as jest.Mock;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const alertAggregate = prisma.monitoringAlert.aggregate as jest.Mock;
    mockAggregate(configAggregate, values.configs);
    mockAggregate(alertAggregate, values.alerts);
  }

  function mockAggregate(mock: jest.Mock, rows: unknown[] | undefined): void {
    const values = (rows ?? []) as Array<{ updatedAt?: Date }>;
    const dates = values.flatMap((row) =>
      row.updatedAt instanceof Date ? [row.updatedAt] : [],
    );
    mock.mockResolvedValue({
      _count: { _all: values.length },
      _max: {
        updatedAt: dates.length
          ? new Date(Math.max(...dates.map((date) => date.getTime())))
          : null,
      },
    });
  }

  it('returns an empty authoritative shape when no clusters are readable', async () => {
    const { service, prisma, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue([]);

    const result = await service.getGraph();
    expect(result.resources).toEqual([]);
    expect(result.relations).toEqual([]);
    expect(result.coverage.warningRecords).toBe(0);
    expect(typeof result.timestamp).toBe('string');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const findMany = prisma.workloadRecord.findMany as jest.Mock;
    expect(findMany).not.toHaveBeenCalled();
  });

  it('derives stable resources, warnings, and only evidenced relations from persisted records', async () => {
    const { service, prisma, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1']);
    mockTables(prisma, {
      workloads: [
        {
          id: 'pod-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Pod',
          name: 'api-1',
          state: 'active',
          replicas: null,
          readyReplicas: null,
          labels: { app: 'api', 'app.kubernetes.io/instance': 'shop' },
          spec: {
            volumes: [
              { persistentVolumeClaim: { claimName: 'data' } },
              { secret: { secretName: 'api-secret' } },
            ],
          },
          statusJson: {
            phase: 'Running',
            nodeName: 'node-a',
            ownerReferences: [{ kind: 'ReplicaSet', name: 'api-7f5d9' }],
          },
        },
        {
          id: 'rs-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'ReplicaSet',
          name: 'api-7f5d9',
          state: 'active',
          replicas: 2,
          readyReplicas: 1,
          labels: { app: 'api' },
          spec: {},
          statusJson: {
            ownerReferences: [{ kind: 'Deployment', name: 'api' }],
          },
        },
        {
          id: 'deploy-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Deployment',
          name: 'api',
          state: 'active',
          replicas: 2,
          readyReplicas: 1,
          labels: { app: 'api' },
          spec: {},
          statusJson: {},
        },
      ],
      network: [
        {
          id: 'svc-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Service',
          name: 'api',
          state: 'active',
          labels: {},
          spec: {
            selector: { app: 'api' },
            ports: [{ protocol: 'TCP', port: 80, targetPort: 8080 }],
          },
          statusJson: {},
        },
        {
          id: 'ing-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Ingress',
          name: 'web',
          state: 'active',
          labels: {},
          spec: {
            rules: [
              {
                http: {
                  paths: [
                    {
                      backend: {
                        service: { name: 'api', port: { number: 80 } },
                      },
                    },
                  ],
                },
              },
            ],
          },
          statusJson: {},
        },
      ],
      storage: [
        {
          id: 'pvc-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'PVC',
          name: 'data',
          state: 'active',
          capacity: '1Gi',
          storageClass: 'fast',
          bindingMode: 'Bound',
          spec: { volumeName: 'pv-data', storageClassName: 'fast' },
          statusJson: {},
        },
        {
          id: 'pv-1',
          clusterId: 'c-1',
          namespace: null,
          kind: 'PV',
          name: 'pv-data',
          state: 'active',
          capacity: '1Gi',
          storageClass: 'fast',
          bindingMode: 'Bound',
          spec: {},
          statusJson: {},
        },
        {
          id: 'sc-1',
          clusterId: 'c-1',
          namespace: null,
          kind: 'SC',
          name: 'fast',
          state: 'active',
          capacity: null,
          storageClass: null,
          bindingMode: null,
          spec: {},
          statusJson: {},
        },
      ],
      configs: [
        {
          id: 'secret-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Secret',
          name: 'api-secret',
          state: 'active',
          dataKeys: ['token'],
          currentRev: 2,
          labels: {},
        },
      ],
      alerts: [
        {
          clusterId: 'c-1',
          namespace: 'app',
          resourceType: 'Pod',
          resourceName: 'api-1',
        },
      ],
    });

    const result = await service.getGraph();

    expect(result.resources.find((item) => item.recordId === 'pod-1')).toEqual(
      expect.objectContaining({
        id: 'workloads:pod-1',
        instanceName: 'shop',
        nodeName: 'node-a',
        summary: 'Running',
        warnings: 1,
        tags: ['app.kubernetes.io/instance=shop', 'app=api'],
      }),
    );
    expect(result.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'workloads:deploy-1',
          target: 'workloads:rs-1',
          label: 'owns',
          evidence: ['statusJson.ownerReferences'],
          ports: [],
        }),
        expect.objectContaining({
          source: 'workloads:rs-1',
          target: 'workloads:pod-1',
          label: 'owns',
          evidence: ['statusJson.ownerReferences'],
          ports: [],
        }),
        expect.objectContaining({
          source: 'network:svc-1',
          target: 'workloads:pod-1',
          label: 'selects',
          ports: ['TCP:80->8080'],
        }),
        expect.objectContaining({
          source: 'network:ing-1',
          target: 'network:svc-1',
          label: 'routes',
          ports: ['80'],
        }),
        expect.objectContaining({
          source: 'workloads:pod-1',
          target: 'storage:pvc-1',
          label: 'mounts',
        }),
        expect.objectContaining({
          source: 'storage:pvc-1',
          target: 'storage:pv-1',
          label: 'binds',
        }),
        expect.objectContaining({
          source: 'storage:pvc-1',
          target: 'storage:sc-1',
          label: 'class',
        }),
        expect.objectContaining({
          source: 'workloads:pod-1',
          target: 'configuration:secret-1',
          label: 'uses',
        }),
      ]),
    );
    expect(result.coverage).toEqual({
      sources: {
        workloads: { records: 3, complete: true },
        network: { records: 2, complete: true },
        storage: { records: 3, complete: true },
        configuration: { records: 1, complete: true },
        gateway: { records: 0, complete: true },
      },
      warningRecords: 1,
    });

    const v2 = await service.getGraphV2({ clusterId: 'c-1' });
    const typedRelations = v2.relations.map((relation) => relation.type);
    expect(typedRelations).toEqual(
      expect.arrayContaining([
        'OWNS',
        'SELECTS',
        'ROUTES_TO',
        'MOUNTS',
        'BINDS',
        'USES_STORAGE_CLASS',
        'USES_SECRET',
      ]),
    );
    expect(
      v2.relations.every(
        (relation) => relation.confidence >= 0 && relation.confidence <= 1,
      ),
    ).toBe(true);
    expect(
      v2.relations.every((relation) => relation.direction === 'outbound'),
    ).toBe(true);
    await expect(service.getGraphV2({ clusterId: 'c-1' })).resolves.toEqual(
      expect.objectContaining({ revision: v2.revision }),
    );
  });

  it('derives service discovery, policy, and workload configuration relationships', async () => {
    const { service, prisma, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1']);
    mockTables(prisma, {
      workloads: [
        {
          id: 'pod-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Pod',
          name: 'api-1',
          state: 'active',
          labels: { app: 'api' },
          spec: {
            serviceAccountName: 'api',
            containers: [
              {
                env: [
                  { valueFrom: { configMapKeyRef: { name: 'api-config' } } },
                ],
                envFrom: [{ secretRef: { name: 'api-secret' } }],
              },
            ],
          },
          statusJson: {},
        },
      ],
      network: [
        {
          id: 'svc-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Service',
          name: 'api',
          state: 'active',
          labels: {},
          spec: { selector: { app: 'api' } },
          statusJson: {},
        },
        {
          id: 'slice-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'EndpointSlice',
          name: 'api-1',
          state: 'active',
          labels: { 'kubernetes.io/service-name': 'api' },
          spec: { endpoints: [{ targetRef: { kind: 'Pod', name: 'api-1' } }] },
          statusJson: {},
        },
        {
          id: 'policy-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'NetworkPolicy',
          name: 'api-only',
          state: 'active',
          labels: {},
          spec: { podSelector: { matchLabels: { app: 'api' } } },
          statusJson: {},
        },
      ],
      configs: [
        {
          id: 'config-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'ConfigMap',
          name: 'api-config',
          state: 'active',
          dataKeys: [],
          currentRev: 1,
          labels: {},
        },
        {
          id: 'secret-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Secret',
          name: 'api-secret',
          state: 'active',
          dataKeys: [],
          currentRev: 1,
          labels: {},
        },
        {
          id: 'sa-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'ServiceAccount',
          name: 'api',
          state: 'active',
          dataKeys: [],
          currentRev: 1,
          labels: {},
        },
      ],
    });

    const result = await service.getGraph();

    expect(result.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'network:svc-1',
          target: 'network:slice-1',
          label: 'publishes',
        }),
        expect.objectContaining({
          source: 'network:slice-1',
          target: 'workloads:pod-1',
          label: 'resolves',
        }),
        expect.objectContaining({
          source: 'network:policy-1',
          target: 'workloads:pod-1',
          label: 'governs',
          role: 'policy',
        }),
        expect.objectContaining({
          source: 'workloads:pod-1',
          target: 'configuration:config-1',
          label: 'uses',
        }),
        expect.objectContaining({
          source: 'workloads:pod-1',
          target: 'configuration:secret-1',
          label: 'uses',
        }),
        expect.objectContaining({
          source: 'workloads:pod-1',
          target: 'configuration:sa-1',
          label: 'uses',
        }),
      ]),
    );
  });

  it('prefers EndpointSlice over legacy Endpoints and direct selector edges', async () => {
    const { service, prisma, clusterHealthService } = build();
    (
      clusterHealthService.listReadableClusterIdsForResourceRead as jest.Mock
    ).mockResolvedValue(['c-1']);
    mockTables(prisma, {
      workloads: [
        {
          id: 'pod-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Pod',
          name: 'api-1',
          state: 'active',
          labels: { app: 'api' },
          spec: {},
          statusJson: {},
        },
      ],
      network: [
        {
          id: 'svc-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Service',
          name: 'api',
          state: 'active',
          labels: {},
          spec: { selector: { app: 'api' } },
          statusJson: {},
        },
        {
          id: 'endpoint-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Endpoints',
          name: 'api',
          state: 'active',
          labels: {},
          spec: {
            subsets: [
              { addresses: [{ targetRef: { kind: 'Pod', name: 'api-1' } }] },
            ],
          },
          statusJson: {},
        },
        {
          id: 'slice-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'EndpointSlice',
          name: 'api-abc',
          state: 'active',
          labels: { 'kubernetes.io/service-name': 'api' },
          spec: { endpoints: [{ targetRef: { kind: 'Pod', name: 'api-1' } }] },
          statusJson: {},
        },
      ],
    });

    const result = await service.getGraph();
    const relationPairs = result.relations.map(
      (relation) => `${relation.source}->${relation.target}`,
    );

    expect(relationPairs).toEqual(
      expect.arrayContaining([
        'network:svc-1->network:slice-1',
        'network:slice-1->workloads:pod-1',
      ]),
    );
    expect(relationPairs).not.toEqual(
      expect.arrayContaining([
        'network:svc-1->network:endpoint-1',
        'network:endpoint-1->workloads:pod-1',
        'network:svc-1->workloads:pod-1',
      ]),
    );
  });

  it('returns a single-cluster V2 graph without an online health gate', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T08:05:00.000Z'));
    const { service, prisma, clusterHealthService } = build();
    const updatedAt = new Date('2026-07-27T08:00:00.000Z');
    mockTables(prisma, {
      workloads: [
        {
          id: 'pod-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Pod',
          name: 'api-1',
          state: 'active',
          labels: { app: 'api' },
          spec: {},
          statusJson: {
            phase: 'Running',
            ownerReferences: [{ kind: 'Deployment', name: 'api' }],
          },
          updatedAt,
        },
        {
          id: 'deploy-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Deployment',
          name: 'api',
          state: 'active',
          labels: {},
          spec: {},
          statusJson: {},
          updatedAt,
        },
      ],
      network: [
        {
          id: 'gateway-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Gateway',
          name: 'edge',
          state: 'active',
          labels: {},
          spec: { gatewayClassName: 'public' },
          statusJson: {},
          updatedAt,
        },
        {
          id: 'gateway-class-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'GatewayClass',
          name: 'public',
          state: 'active',
          labels: {},
          spec: {},
          statusJson: {},
          updatedAt,
        },
      ],
    });

    const result = await service.getGraphV2({ clusterId: 'c-1' });
    jest.useRealTimers();

    const health = clusterHealthService;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const assertOnline = health.assertClusterOnlineForRead as jest.Mock;
    expect(assertOnline).not.toHaveBeenCalled();
    expect(result.schemaVersion).toBe('2.0');
    expect(result.clusterId).toBe('c-1');
    expect(result.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(typeof result.generatedAt).toBe('string');
    expect(result.dataAsOf).toBe(updatedAt.toISOString());
    expect(result.freshness).toEqual({
      status: 'fresh',
      observedAt: updatedAt.toISOString(),
      ageMs: 300_000,
      staleAfterMs: 900_000,
    });
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'network:gateway-1',
          source: 'network',
          identity: {
            clusterId: 'c-1',
            uid: null,
            apiVersion: null,
            resourceVersion: null,
            kind: 'Gateway',
            namespace: 'app',
            name: 'edge',
          },
        }),
      ]),
    );
    expect(result.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'OWNS', label: 'owns' }),
        expect.objectContaining({ type: 'PROVISIONS', label: 'provisions' }),
      ]),
    );
    expect(result.coverage.sources.network).toEqual({
      records: 2,
      status: 'complete',
      dataAsOf: updatedAt.toISOString(),
    });
  });

  it('keeps only the newest ReplicaSet for each Deployment', async () => {
    const { service, prisma } = build();
    mockTables(prisma, {
      workloads: [
        { id: 'deploy', clusterId: 'c-1', namespace: 'app', kind: 'Deployment', name: 'api', state: 'active', labels: {}, spec: {}, statusJson: {} },
        { id: 'rs-old', clusterId: 'c-1', namespace: 'app', kind: 'ReplicaSet', name: 'api-old', state: 'active', labels: {}, replicas: 0, readyReplicas: 0, spec: {}, statusJson: { ownerReferences: [{ kind: 'Deployment', name: 'api' }], metadata: { annotations: { 'deployment.kubernetes.io/revision': '1' } } } },
        { id: 'rs-new', clusterId: 'c-1', namespace: 'app', kind: 'ReplicaSet', name: 'api-new', state: 'active', labels: {}, replicas: 2, readyReplicas: 2, spec: {}, statusJson: { ownerReferences: [{ kind: 'Deployment', name: 'api' }], metadata: { annotations: { 'deployment.kubernetes.io/revision': '2' } } } },
      ],
    });
    const result = await service.getGraphV2({ clusterId: 'c-1', sources: ['workloads'] });
    const replicaSets = result.resources.filter((resource) => resource.kind === 'ReplicaSet');
    expect(replicaSets).toHaveLength(1);
    expect(replicaSets[0]?.name).toBe('api-new');
  });

  it('requires clusterId for V2 and marks omitted domains unavailable', async () => {
    const { service, prisma } = build();
    await expect(service.getGraphV2()).rejects.toThrow(
      'clusterId is required for a single-cluster topology graph',
    );
    mockTables(prisma);

    const result = await service.getGraphV2({
      clusterId: 'c-1',
      sources: ['workloads'],
    });

    expect(result.coverage.sources.network).toEqual({
      records: 0,
      status: 'unavailable',
      dataAsOf: null,
      reason: 'not-requested',
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const findNetworkResources = prisma.networkResource.findMany as jest.Mock;
    expect(findNetworkResources).not.toHaveBeenCalled();
  });

  it('uses a revision cache hit but refreshes health decoration', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T08:05:00.000Z'));
    const { service, prisma, clusterHealthService, cache } = build();
    const updatedAt = new Date('2026-07-27T08:00:00.000Z');
    mockTables(prisma, {
      workloads: [
        {
          id: 'pod-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Pod',
          name: 'api-1',
          state: 'active',
          spec: {},
          statusJson: {},
          labels: {},
          updatedAt,
        },
      ],
    });

    const first = await service.getGraphV2({
      clusterId: 'c-1',
      sources: ['workloads'],
    });
    (cache.get as jest.Mock).mockResolvedValue(first);
    (clusterHealthService.getLatestSnapshot as jest.Mock).mockResolvedValue({
      ok: false,
      isStale: false,
    });
    const second = await service.getGraphV2({
      clusterId: 'c-1',
      sources: ['workloads'],
    });

    expect(first.freshness.status).toBe('fresh');
    expect(second.freshness.status).toBe('stale');
    expect(second.coverage.sources.workloads).toEqual({
      records: 1,
      status: 'complete',
      dataAsOf: updatedAt.toISOString(),
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const findWorkloads = prisma.workloadRecord.findMany as jest.Mock;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const latestHealth = clusterHealthService.getLatestSnapshot as jest.Mock;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const probeCluster = clusterHealthService.probeCluster as jest.Mock;
    const health = clusterHealthService;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const assertOnline = health.assertClusterOnlineForRead as jest.Mock;
    expect(findWorkloads).toHaveBeenCalledTimes(1);
    expect(latestHealth).toHaveBeenCalledTimes(2);
    expect(probeCluster).not.toHaveBeenCalled();
    expect(assertOnline).not.toHaveBeenCalled();
  });

  it('degrades Redis failures to a PostgreSQL graph response', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T08:05:00.000Z'));
    const { service, prisma, cache } = build();
    mockTables(prisma, {
      workloads: [
        {
          id: 'pod-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Pod',
          name: 'api-1',
          state: 'active',
          spec: {},
          statusJson: {},
          labels: {},
          updatedAt: new Date('2026-07-27T08:00:00.000Z'),
        },
      ],
    });
    (cache.get as jest.Mock).mockRejectedValue(new Error('redis down'));
    (cache.set as jest.Mock).mockRejectedValue(new Error('redis down'));

    const result = await service.getGraphV2({
      clusterId: 'c-1',
      sources: ['workloads'],
    });
    expect(Array.isArray(result.resources)).toBe(true);
  });

  it('returns an offline inventory snapshot as stale', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T08:05:00.000Z'));
    const { service, prisma, clusterHealthService } = build();
    mockTables(prisma, {
      workloads: [
        {
          id: 'pod-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Pod',
          name: 'api-1',
          state: 'active',
          spec: {},
          statusJson: {},
          labels: {},
          updatedAt: new Date('2026-07-27T08:00:00.000Z'),
        },
      ],
    });
    (clusterHealthService.getLatestSnapshot as jest.Mock).mockResolvedValue({
      ok: false,
      isStale: false,
    });

    const result = await service.getGraphV2({ clusterId: 'c-1' });

    expect(result.freshness.status).toBe('stale');
    expect(result.resources[0]?.freshness.status).toBe('stale');
    expect(result.coverage.sources.workloads).toEqual(
      expect.objectContaining({ records: 1, status: 'complete' }),
    );
  });

  it('returns unavailable when no inventory has ever been persisted', async () => {
    const { service, prisma, clusterHealthService } = build();
    mockTables(prisma);
    (clusterHealthService.getLatestSnapshot as jest.Mock).mockResolvedValue({
      ok: false,
      isStale: false,
    });

    const result = await service.getGraphV2({ clusterId: 'c-1' });

    expect(result.freshness).toEqual({
      status: 'unavailable',
      observedAt: null,
      ageMs: null,
      staleAfterMs: 900_000,
    });
    expect(result.coverage.sources.workloads).toEqual(
      expect.objectContaining({
        records: 0,
        status: 'complete',
      }),
    );
  });

  it('changes the revision and cache key before reloading modified rows', async () => {
    const { service, prisma, cache } = build();
    mockTables(prisma, {
      workloads: [
        {
          id: 'pod-1',
          clusterId: 'c-1',
          namespace: 'app',
          kind: 'Pod',
          name: 'api-1',
          state: 'active',
          spec: {},
          statusJson: {},
          labels: {},
          updatedAt: new Date('2026-07-27T08:00:00.000Z'),
        },
      ],
    });
    const first = await service.getGraphV2({
      clusterId: 'c-1',
      sources: ['workloads'],
    });
    (prisma.workloadRecord.aggregate as jest.Mock).mockResolvedValue({
      _count: { _all: 2 },
      _max: { updatedAt: new Date('2026-07-27T08:10:00.000Z') },
    });
    const second = await service.getGraphV2({
      clusterId: 'c-1',
      sources: ['workloads'],
    });

    expect(second.revision).not.toBe(first.revision);
    const requestedKeys = (cache.get as jest.Mock).mock.calls.map(
      ([key]) => key as string,
    );
    expect(new Set(requestedKeys).size).toBe(2);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const findWorkloads = prisma.workloadRecord.findMany as jest.Mock;
    expect(findWorkloads).toHaveBeenCalledTimes(2);
  });
});
