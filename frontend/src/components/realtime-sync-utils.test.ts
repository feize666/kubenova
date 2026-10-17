import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { applyRealtimePatch, getTopologyQueryPrefixes, type RealtimeEvent } from './realtime-sync-utils';

const key = ['configs', 'configmaps', { clusterId: 'qa-cluster', namespace: 'default' }, 'qa-account'];
const row = { id: 'qa-config', name: 'private-config', clusterId: 'qa-cluster', namespace: 'default', state: 'active' };
const event: RealtimeEvent = {
  clusterId: 'qa-cluster', domains: ['configs'], kind: 'ConfigMap', phase: 'update', action: 'upsert',
  resource: { kind: 'ConfigMap', name: 'private-config', namespace: 'default', state: 'updated' },
  timestamp: '2026-10-11T00:00:00Z',
};

test('topology resource events invalidate only the matching v2 cluster graph', () => {
  for (const kind of ['Pod', 'Deployment', 'Service', 'Endpoints', 'EndpointSlice', 'Ingress']) {
    assert.deepEqual(getTopologyQueryPrefixes({ ...event, resource: { kind } }), [["topology-v2", "graph", "qa-cluster"]]);
  }
  assert.deepEqual(getTopologyQueryPrefixes({ ...event, clusterId: '', resource: { kind: 'Pod' } }), []);
});

test('an unmatched realtime event does not manufacture a successful list read', () => {
  const client = new QueryClient();
  try {
    client.setQueryData(key, { items: [row] });
    const query = client.getQueryCache().find({ queryKey: key })!;
    const before = query.state;
    assert.equal(applyRealtimePatch(client, { ...event, resource: { ...event.resource, name: 'unrelated-config' } }), false);
    assert.strictEqual(query.state, before, 'a no-op event must not dispatch a manual success');
  } finally { client.clear(); }
});

for (const status of [403, 503]) {
  test(`realtime events cannot release a ${status} read failure or change its cached rows`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      client.setQueryData(key, { items: [row] });
      const failure = new ApiError('controlled read failure', status);
      await assert.rejects(client.fetchQuery({ queryKey: key, queryFn: async () => { throw failure; } }), failure);
      const query = client.getQueryCache().find({ queryKey: key })!;
      const before = query.state;
      assert.equal(applyRealtimePatch(client, event), false);
      assert.strictEqual(query.state, before, 'a stream event is not a successful authorized list read');
      assert.strictEqual(query.state.error, failure);
      assert.equal(query.state.status, 'error');
      assert.deepEqual(query.state.data, { items: [row] });
    } finally { client.clear(); }
  });
}

test('realtime events still update matched resources after a successful list read', () => {
  const client = new QueryClient();
  try {
    client.setQueryData(key, { items: [row] });
    assert.equal(applyRealtimePatch(client, event), true);
    assert.equal(client.getQueryData<{ items: typeof row[] }>(key)!.items[0].state, 'updated');
    assert.equal(applyRealtimePatch(client, { ...event, action: 'delete' }), true);
    assert.deepEqual(client.getQueryData(key), { items: [] });
  } finally { client.clear(); }
});

test('a successful sibling query cannot let a realtime patch overwrite a denied account cache', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const siblingKey = [...key.slice(0, -1), 'qa-other-account'];
  try {
    client.setQueryData(key, { items: [row] });
    client.setQueryData(siblingKey, { items: [row] });
    await assert.rejects(client.fetchQuery({ queryKey: key, queryFn: async () => { throw new ApiError('forbidden', 403); } }));
    const deniedQuery = client.getQueryCache().find({ queryKey: key })!;
    const before = deniedQuery.state;
    assert.equal(applyRealtimePatch(client, event), true, 'a matched healthy query still reports a patch');
    assert.strictEqual(deniedQuery.state, before, 'each matching query must independently retain its read failure');
    assert.equal(client.getQueryData<{ items: typeof row[] }>(siblingKey)!.items[0].state, 'updated');
  } finally { client.clear(); }
});
