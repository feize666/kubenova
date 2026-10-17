import assert from 'node:assert/strict';
import test from 'node:test';
import { getClusters } from './clusters';

test('cluster pages preserve the server total beyond the current page', async () => {
  const previousFetch = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://fixture.local');
    requests.push(url);
    const page = Number(url.searchParams.get('page'));
    const items = page === 1
      ? Array.from({length: 25}, (_, index) => ({id: `cluster-${index}`, name: `Cluster ${index}`, state: 'active'}))
      : [{id: 'cluster-25', name: 'Cluster 25', state: 'active'}];
    return new Response(JSON.stringify({data: {items, total: 26, page, pageSize: 25}}), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  try {
    const first = await getClusters({page: 1, pageSize: 25}, 'fixture-token');
    assert.equal(first.items.length, 25);
    assert.equal(first.total, 26, 'current page size cannot disable the next page');
    const second = await getClusters({page: 2, pageSize: 25}, 'fixture-token');
    assert.equal(second.items[0].id, 'cluster-25');
    assert.equal(second.total, 26, 'last-page length cannot shrink pagination');
    assert.deepEqual(requests.map(url => url.searchParams.get('page')), ['1', '2']);
  } finally { globalThis.fetch = previousFetch; }
});
