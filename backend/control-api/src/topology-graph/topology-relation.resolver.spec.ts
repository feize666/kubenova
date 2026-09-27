import { TopologyRelationResolver } from './topology-relation.resolver';
import type { TopologyRow } from './topology-graph.contract';
import type { Prisma } from '@prisma/client';

describe('TopologyRelationResolver access chain', () => {
  it('links both endpoint types to Service while preferring EndpointSlice for Pod resolution', () => {
    const rows = [
      resource('network', 'ing', 'Ingress', 'web', 'app', {
        rules: [
          {
            http: {
              paths: [
                { backend: { service: { name: 'web', port: { number: 80 } } } },
              ],
            },
          },
        ],
      }),
      resource('network', 'svc', 'Service', 'web', 'app', {
        selector: { app: 'web' },
      }),
      resource(
        'network',
        'slice',
        'EndpointSlice',
        'web-abc',
        'app',
        {
          endpoints: [{ addresses: ['10.0.0.12'] }],
        },
        { 'kubernetes.io/service-name': 'web' },
      ),
      resource('network', 'eps', 'Endpoints', 'web', 'app', {
        subsets: [{ addresses: [{ ip: '10.0.0.12' }] }],
      }),
      resource(
        'workloads',
        'pod',
        'Pod',
        'web-1',
        'app',
        {},
        {},
        { podIP: '10.0.0.12' },
      ),
    ];
    const resources = rows.map(({ row, source }) => ({
      id: `${source}:${row.id}`,
      recordId: row.id,
    }));
    const relations = new TopologyRelationResolver().resolveV2(rows, resources);
    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ROUTES_TO',
          source: 'network:ing',
          target: 'network:svc',
        }),
        expect.objectContaining({
          type: 'PUBLISHES',
          source: 'network:svc',
          target: 'network:slice',
        }),
        expect.objectContaining({
          type: 'RESOLVES',
          source: 'network:slice',
          target: 'workloads:pod',
        }),
        expect.objectContaining({
          type: 'PUBLISHES',
          source: 'network:svc',
          target: 'network:eps',
        }),
      ]),
    );
    expect(relations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'network:eps',
          target: 'workloads:pod',
        }),
      ]),
    );
  });

  it('never links same-name Endpoints across namespaces or clusters', () => {
    const rows = [
      resource('network', 'svc', 'Service', 'web', 'app', {}),
      resource('network', 'other-ns', 'Endpoints', 'web', 'other', {}),
      resource('network', 'other-cluster', 'Endpoints', 'web', 'app', {}),
    ];
    rows[2].row.clusterId = 'c2';
    const relations = new TopologyRelationResolver().resolveV2(
      rows,
      rows.map(({ row }) => ({ id: row.id, recordId: row.id })),
    );
    expect(relations).toEqual([]);
  });
});

function resource(
  source: TopologyRow['source'],
  id: string,
  kind: string,
  name: string,
  namespace: string | null,
  spec: Prisma.JsonValue,
  labels: Record<string, string> = {},
  statusJson: Prisma.JsonValue = {},
): TopologyRow {
  return {
    source,
    row: {
      id,
      clusterId: 'c1',
      namespace,
      kind,
      name,
      state: 'active',
      spec,
      labels,
      statusJson,
    },
  };
}
