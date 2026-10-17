jest.mock('@kubernetes/client-node', () => ({}));

import { ResourcesService } from './resources.service';

describe('ResourcesService workload relationship discovery audit', () => {
  const now = new Date('2026-10-12T00:00:00.000Z');

  function record(kind: string, name: string, labels: Record<string, string>) {
    return {
      id: `${kind}-${name}`,
      clusterId: 'cluster-a',
      namespace: 'apps',
      kind,
      name,
      state: 'running',
      spec:
        kind === 'Pod' ? { containers: [{ name: 'app', image: 'nginx' }] } : {},
      statusJson:
        kind === 'Pod'
          ? {
              ownerReferences: [
                {
                  kind: 'ReplicaSet',
                  name: 'api-rs',
                  uid: 'rs-uid',
                  controller: true,
                },
              ],
            }
          : {},
      labels,
      annotations: null,
      replicas: null,
      readyReplicas: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  function harness(selector: Record<string, unknown>) {
    const deployment = {
      ...record('Deployment', 'api', { app: 'api' }),
      spec: {
        selector,
        template: { spec: { containers: [{ name: 'app', image: 'nginx' }] } },
      },
    };
    const selected = record('Pod', 'selected', {
      app: 'api',
      tier: 'frontend',
    });
    const excluded = record('Pod', 'excluded', { app: 'api', tier: 'backend' });
    const otherNamespace = {
      ...selected,
      id: 'Pod-other-namespace',
      name: 'other-namespace',
      namespace: 'private',
    };
    const otherCluster = {
      ...selected,
      id: 'Pod-other-cluster',
      name: 'other-cluster',
      clusterId: 'cluster-b',
    };
    const rows = [deployment, selected, excluded, otherNamespace, otherCluster];
    const workloadRecord = {
      findUnique: jest.fn().mockResolvedValue(deployment),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            clusterId: string;
            namespace?: string;
            state: { not: string };
          };
        }) =>
          rows.filter(
            (row) =>
              row.clusterId === where.clusterId &&
              (!where.namespace || row.namespace === where.namespace) &&
              row.state !== where.state.not,
          ),
      ),
    };
    const emptyBoundary = () => ({ findMany: jest.fn().mockResolvedValue([]) });
    const prisma = {
      workloadRecord,
      networkResource: emptyBoundary(),
      storageResource: emptyBoundary(),
      configResource: emptyBoundary(),
    };
    const listNamespacedEvent = jest.fn().mockResolvedValue({ items: [] });
    const service = new ResourcesService(
      {
        getKubeconfig: jest.fn().mockResolvedValue('mock-kubeconfig'),
      } as never,
      {
        assertClusterOnlineForRead: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        getCoreApi: jest.fn().mockReturnValue({ listNamespacedEvent }),
      } as never,
      prisma as never,
    );
    return { service, workloadRecord, listNamespacedEvent };
  }

  it.each([
    [
      'matchLabels plus matchExpressions',
      {
        matchLabels: { app: 'api' },
        matchExpressions: [
          { key: 'tier', operator: 'In', values: ['frontend'] },
        ],
      },
    ],
    [
      'matchExpressions only',
      {
        matchExpressions: [
          { key: 'tier', operator: 'In', values: ['frontend'] },
        ],
      },
    ],
  ])(
    'discovers exactly the matching same-scope Pod for %s',
    async (_label, selector) => {
      const h = harness(selector);
      const detail = await h.service.getDetail('deployment', 'Deployment-api');

      expect(h.workloadRecord.findMany).toHaveBeenCalledWith({
        where: {
          clusterId: 'cluster-a',
          namespace: 'apps',
          state: { not: 'deleted' },
        },
      });
      expect(h.listNamespacedEvent).toHaveBeenCalledWith({
        namespace: 'apps',
        fieldSelector:
          'involvedObject.kind=Deployment,involvedObject.name=api,involvedObject.namespace=apps',
        limit: 30,
      });
      expect(
        detail.associations.filter(
          (item) => item.associationType === 'owned-pod',
        ),
      ).toEqual([
        {
          id: 'Pod-selected',
          kind: 'Pod',
          name: 'selected',
          namespace: 'apps',
          associationType: 'owned-pod',
        },
      ]);
    },
  );

  it.each([
    [
      'NotIn',
      { key: 'tier', operator: 'NotIn', values: ['backend'] },
      ['selected'],
    ],
    [
      'NotIn missing key',
      { key: 'missing', operator: 'NotIn', values: ['value'] },
      ['selected', 'excluded'],
    ],
    ['Exists', { key: 'tier', operator: 'Exists' }, ['selected', 'excluded']],
    ['Exists missing key', { key: 'missing', operator: 'Exists' }, []],
    [
      'DoesNotExist',
      { key: 'missing', operator: 'DoesNotExist' },
      ['selected', 'excluded'],
    ],
    ['DoesNotExist present key', { key: 'tier', operator: 'DoesNotExist' }, []],
    ['unsupported operator', { key: 'tier', operator: 'Unsupported' }, []],
    ['empty key', { key: '', operator: 'DoesNotExist' }, []],
  ])(
    'evaluates %s without crossing resource scope',
    async (_label, expression, expected) => {
      const h = harness({ matchExpressions: [expression] });
      const detail = await h.service.getDetail('deployment', 'Deployment-api');
      expect(
        detail.associations
          .filter((item) => item.associationType === 'owned-pod')
          .map((item) => item.name),
      ).toEqual(expected);
    },
  );

  it('does not treat an empty selector as ownership of every Pod', async () => {
    const h = harness({});
    const detail = await h.service.getDetail('deployment', 'Deployment-api');
    expect(
      detail.associations.filter(
        (item) => item.associationType === 'owned-pod',
      ),
    ).toEqual([]);
  });
});
