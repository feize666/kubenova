import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import * as query from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { transformSync } from 'esbuild';
import * as workloads from '@/lib/api/workloads';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';
import * as relations from '../../app/clusters/[clusterId]/resource/[kind]/[...id]/pod-relations';

const filename = 'src/app/clusters/[clusterId]/resource/[kind]/[...id]/detail-config.tsx';
const row = (name: string, ownerRefs: unknown[] = [], labels: Record<string, string> = { app: 'shared' }, scope = {}) => ({
  id: name + '-id', clusterId: 'c1', namespace: 'prod', kind: 'Pod', name, labels,
  replicas: 1, readyReplicas: 1, state: 'active', statusJson: { phase: 'Running', ownerReferences: ownerRefs },
  createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z', ...scope,
});
type Row = ReturnType<typeof row>;
type Detail = { overview: Record<string, unknown>; rawSpec: Record<string, unknown>; rawStatus?: Record<string, unknown>; associations: unknown[] };
const detail = (): Detail => ({ overview: { clusterId: 'c1', namespace: 'prod', name: 'web', kind: 'Deployment' }, rawSpec: { selector: { matchLabels: { app: 'shared' } } }, rawStatus: { uid: 'deploy-current' }, associations: [] });

async function fixture(run: (harness: Awaited<ReturnType<typeof mount>>) => Promise<void>) {
  const harness = await mount();
  try { await run(harness); } finally { await harness.close(); }
}

async function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, fetch: fixtureFetch, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let token = 'account-a';
  let selected = detail();
  let status = 200;
  let failKind = '';
  let statusQueue: number[] = [];
  let items: Record<string, Row[]> = { Pod: [], ReplicaSet: [], Job: [] };
  const requests: Array<{ kind: string; page: number; clusterId: string | null; namespace: string | null; keyword: string | null; token: string | null }> = [];
  const navigated: unknown[] = [];
  async function fixtureFetch(url: string | URL | Request, init?: RequestInit) {
    const request = new URL(String(url), 'http://fixture.local');
    assert.equal(request.pathname, '/api/workloads', 'no live request is permitted');
    const kind = request.searchParams.get('kind')!;
    const page = Number(request.searchParams.get('page') || 1);
    requests.push({ kind, page, clusterId: request.searchParams.get('clusterId'), namespace: request.searchParams.get('namespace'), keyword: request.searchParams.get('keyword'), token: new Headers(init?.headers).get('authorization') });
    const responseStatus = !failKind || failKind === kind ? statusQueue.shift() ?? status : 200;
    if (responseStatus !== 200) return new Response(JSON.stringify({ message: 'fixture error' }), { status: responseStatus, headers: { 'Content-Type': 'application/json' } });
    const source = items[kind] ?? [];
    return new Response(JSON.stringify({ data: { items: source.slice((page - 1) * 200, page * 200), total: source.length, page, pageSize: 200 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const source = readFileSync(resolve(process.env.POD_DETAIL_BASELINE ? '../tmp/baseline/frontend/' + filename : filename), 'utf8');
  const module = { exports: {} as { renderTabContent: (tab: string, ctx: unknown) => React.ReactNode; getDetailTabs: (kind: string) => Array<{ key: string }> } };
  const pass = ({ children }: { children: React.ReactNode }) => createElement('div', null, children);
  const Table = ({ dataSource, columns }: { dataSource: Row[]; columns: Array<{ render: (name: string, row: Row) => React.ReactNode }> }) => createElement('div', { 'data-table': true }, dataSource.map(item => createElement('div', { key: item.id }, columns[0].render(item.name, item))));
  const require = (id: string): unknown => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === '@tanstack/react-query') return query;
    if (id === '@/hooks/use-resource-list-query') return { useResourceListQuery };
    if (id === '@/lib/api/workloads') return workloads;
    if (id === './pod-relations') return relations;
    if (id === '@/components/auth-context') return { useAuth: () => ({ accessToken: token }) };
    if (id === 'antd') return { Table, Typography: { Text: pass }, Alert: ({ message }: { message: string }) => createElement('div', { role: 'alert' }, message), Input: ({ onChange, value }: { onChange: React.ChangeEventHandler<HTMLInputElement>; value: string }) => createElement('input', { onChange, value }), Spin: () => createElement('div', null, 'loading') };
    return new Proxy({}, { get: (_, name) => name === '__esModule' ? true : () => null });
  };
  vm.runInNewContext(transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code, { module, exports: module.exports, require });
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = () => new Promise(resolve => setTimeout(resolve, 40));
  const render = async () => {
    await act(async () => {
      root.render(createElement(query.QueryClientProvider, { client }, module.exports.renderTabContent('pods', { detail: selected, onNavigateRequest: (request: unknown) => navigated.push(request) })));
      await settle();
    });
    await act(async () => { await settle(); });
  };
  return {
    dom, client, requests, navigated, render, tabs: module.exports.getDetailTabs,
    rows: () => [...dom.window.document.querySelectorAll('[data-table] a')].map(node => node.textContent),
    configure(next: { detail?: Detail; token?: string; items?: typeof items; status?: number; failKind?: string; statusQueue?: number[] }) { selected = next.detail ?? selected; token = next.token ?? token; items = next.items ?? items; status = next.status ?? status; failKind = next.failKind ?? failKind; statusQueue = next.statusQueue ?? statusQueue; },
    async refresh() { await act(async () => { await client.refetchQueries({ type: 'active' }); await settle(); }); },
    async close() {
      await act(async () => root.unmount()); client.clear();
      await act(async () => { await settle(); }); dom.window.close();
      for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    },
  };
}

test('consumer excludes conflicting owner, old UID and wrong namespace despite shared selectors or association', async () => fixture(async h => {
  const selected = detail();
  selected.associations = [{ id: 'other-id', kind: 'Pod', name: 'other', namespace: 'prod', associationType: 'owned-pod' }];
  h.configure({ detail: selected, items: { Pod: [
    row('good', [{ kind: 'Deployment', name: 'web', uid: 'deploy-current', controller: true }]),
    row('other', [{ kind: 'Deployment', name: 'other', uid: 'other-owner', controller: true }]),
    row('old', [{ kind: 'Deployment', name: 'web', uid: 'deploy-old', controller: true }]),
    row('different-ns', [], { app: 'shared' }, { namespace: 'elsewhere' }),
  ], ReplicaSet: [], Job: [] } });
  await h.render();
  assert.deepEqual(h.rows(), ['good']);
}));

test('consumer proves Deployment and CronJob indirect chains, never a name prefix', async () => fixture(async h => {
  h.configure({ items: { Pod: [row('child', [{ kind: 'ReplicaSet', name: 'web-rs', uid: 'rs-uid' }]), row('web-guessed', [{ kind: 'ReplicaSet', name: 'web-not-real' }])], ReplicaSet: [row('web-rs', [{ kind: 'Deployment', name: 'web', uid: 'deploy-current' }], {}, { kind: 'ReplicaSet', statusJson: { uid: 'rs-uid', ownerReferences: [{ kind: 'Deployment', name: 'web', uid: 'deploy-current' }] } })], Job: [] } });
  await h.render(); assert.deepEqual(h.rows(), ['child']);
  const selected = detail(); selected.overview.kind = 'CronJob'; selected.overview.name = 'nightly'; selected.rawSpec = {}; selected.rawStatus = { uid: 'cron-uid' };
  h.configure({ detail: selected, items: { Pod: [row('nightly-pod', [{ kind: 'Job', name: 'nightly-123', uid: 'job-uid' }])], Job: [row('nightly-123', [], {}, { kind: 'Job', statusJson: { uid: 'job-uid', ownerReferences: [{ kind: 'CronJob', name: 'nightly', uid: 'cron-uid' }] } })], ReplicaSet: [] } });
  await h.render(); await h.refresh(); assert.deepEqual(h.rows(), ['nightly-pod']);
}));

test('consumer does not guess app labels without a selector or owner, accepts matchExpressions', async () => fixture(async h => {
  const selected = detail(); selected.rawSpec = {};
  h.configure({ detail: selected, items: { Pod: [row('guessed', [], { app: 'web' }), row('selected', [], { app: 'shared' })], Job: [], ReplicaSet: [] } });
  await h.render(); assert.deepEqual(h.rows(), []);
  selected.rawSpec = { selector: { matchExpressions: [{ key: 'app', operator: 'In', values: ['shared'] }] } };
  await h.render(); assert.deepEqual(h.rows(), ['selected']);
}));

test('consumer reads beyond page 200 and pod name click emits its resource ID', async () => fixture(async h => {
  h.configure({ items: { Pod: Array.from({ length: 201 }, (_, index) => row('pod-' + index)), Job: [], ReplicaSet: [] } });
  await h.render(); assert.equal(h.rows().length, 201);
  await act(async () => { domClick(h.dom, 'pod-200'); });
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigated)), [{ kind: 'Pod', id: 'pod-200-id' }]);
  assert.ok(h.requests.some(request => request.kind === 'Pod' && request.page === 2));
  assert.ok(h.requests.every(request => request.keyword === null));
}));

function domClick(dom: JSDOM, name: string) { const link = [...dom.window.document.querySelectorAll('a')].find(node => node.textContent === name); assert.ok(link); link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }

test('consumer preserves ordinary 503 snapshot but latches 403 through 503', async () => fixture(async h => {
  h.configure({ items: { Pod: [row('private-pod')], Job: [], ReplicaSet: [] } });
  await h.render(); assert.deepEqual(h.rows(), ['private-pod']);
  h.configure({ status: 503 }); await h.refresh(); assert.deepEqual(h.rows(), ['private-pod']);
  h.configure({ status: 403 }); await h.refresh(); assert.deepEqual(h.rows(), []);
  h.configure({ status: 503 }); await h.refresh(); assert.deepEqual(h.rows(), []);
  h.configure({ status: 200 }); await h.refresh(); assert.deepEqual(h.rows(), ['private-pod']);
}));

test('consumer never shows previous rows after token, cluster or namespace changes', async () => fixture(async h => {
  h.configure({ items: { Pod: [row('private-a')], Job: [], ReplicaSet: [] } });
  await h.render(); assert.deepEqual(h.rows(), ['private-a']);
  for (const scope of [{ clusterId: 'c2' }, { namespace: 'other' }, {}]) {
    const selected = detail(); selected.overview = { ...selected.overview, ...scope };
    h.configure({ detail: selected, token: 'account-b', items: { Pod: [], Job: [], ReplicaSet: [] } });
    await h.render(); assert.deepEqual(h.rows(), []);
  }
  assert.ok(h.requests.some(request => request.clusterId === 'c2'));
  assert.ok(h.requests.some(request => request.namespace === 'other'));
  assert.ok(h.requests.some(request => request.token === 'Bearer account-b'));
}));

test('CronJob exposes its Pod relation tab', async () => fixture(async h => {
  assert.ok(h.tabs('CronJob').some(tab => tab.key === 'pods'));
}));

test('intermediary 403 blocks direct and indirect pods and remains blocked after 503', async () => fixture(async h => {
  h.configure({ items: { Pod: [row('direct', [{ kind: 'Deployment', name: 'web', uid: 'deploy-current' }])], Job: [], ReplicaSet: [] } });
  await h.render(); assert.deepEqual(h.rows(), ['direct']);
  h.configure({ status: 403, failKind: 'ReplicaSet' }); await h.refresh(); assert.deepEqual(h.rows(), []);
  h.configure({ status: 503 }); await h.refresh(); assert.deepEqual(h.rows(), []);
  h.configure({ status: 200 }); await h.refresh(); assert.deepEqual(h.rows(), ['direct']);
}));

test('automatic retry must not turn an initial 403 into a 503 that preserves authorized rows', async () => fixture(async h => {
  h.configure({ items: { Pod: [row('private')], Job: [], ReplicaSet: [] } });
  await h.render(); assert.deepEqual(h.rows(), ['private']);
  h.configure({ status: 503, failKind: 'Pod', statusQueue: [403, 503] });
  await h.refresh(); assert.deepEqual(h.rows(), []);
}));
