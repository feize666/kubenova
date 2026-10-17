import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { act, createElement, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ResourceQueryFeedback } from '@/components/resource-query-feedback';
import { ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/query/keys';
import { listQueryOptions } from '@/lib/query/policies';
import { scopedPlaceholder } from '@/lib/query/scoped-placeholder';
import { isResourceAccessDenied } from '@/lib/query/visible-resource-data';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';
import { useScopedDeferredValue } from '@/hooks/use-scoped-deferred-value';

type Fixture = { items: Array<{ id: string; name: string; namespace: string; state: string }>; total: number };
type Scope = { accessToken: string; clusterId: string; keyword: string };
const initialScope: Scope = { accessToken: 'account-a', clusterId: 'cluster-a', keyword: '' };

// Execute each page's actual query boundary and deferred table pipeline. Only
// HTTP is controlled; React Query, permission masking and rendering remain real.
function declarations(page: string) {
  const path = new URL(page, import.meta.url);
  const file = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) result.set(node.name.text, node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}

const pages = [
  { label: 'Clusters', page: './page.tsx', variable: 'query', deferred: true },
  { label: 'Namespace', page: '../namespaces/page.tsx', variable: 'namespacesQuery', deferred: false },
  { label: 'Node', page: './nodes/page.tsx', variable: 'nodesQuery', deferred: false },
  { label: 'Node cluster options', page: './nodes/page.tsx', variable: 'clustersQuery', deferred: false },
  { label: 'Namespace cluster options', page: '../namespaces/page.tsx', variable: 'clustersQuery', deferred: false },
];

for (const page of pages) {
  test(`${page.label}: denied refresh hides every rendered cached frame, transient failure preserves snapshot and retry recovers`, async () => {
    const dom = new JSDOM('<div id="root"></div>');
    const replacements = { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
    const original = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of Object.entries(replacements)) {
      original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    const root = createRoot(dom.window.document.getElementById('root')!);
    const client = new QueryClient({ defaultOptions: { queries: { ...listQueryOptions, retry: false, gcTime: Infinity } } });
    const vars = declarations(page.page);
    const query = vars.get(page.variable);
    assert.ok(query, 'production query declaration is required');
    let status = 200;
    let paused = false;
    let latest!: UseQueryResult<Fixture, Error>;
    const frames: Array<{ error: unknown; names: string; token: string }> = [];
    const api = async () => {
      if (paused) return new Promise<Fixture>(() => {});
      if (status !== 200) throw new ApiError('fixture failure', status);
      return { items: [{ id: 'private-cluster', name: 'private-row', namespace: 'prod', state: 'active' }], total: 1 };
    };
    const dependencies = {
      createElement, useQuery, useResourceListQuery, useScopedDeferredValue, useMemo,
      queryKeys, scopedPlaceholder, isResourceAccessDenied,
      getClusters: api, getNamespaces: api, getClusterNodes: api,
      CLUSTER_LIST_QUERY_OPTIONS: { ...listQueryOptions, retry: false, gcTime: Infinity },
      EMPTY_CLUSTERS: [],
      capture: (result: typeof latest, names: string, token: string) => {
        latest = result;
        frames.push({ error: result.error, names, token });
      },
    };
    const pipeline = page.deferred
      ? `${vars.get('clusterItems')}; const ${vars.get('clusterViewScope')}; const ${vars.get('tableData')}; const ${vars.get('deferredTableData')}; const rows=deferredTableData;`
      : `const rows=${page.variable}.data?.items ?? [];`;
    const code = `return function Probe({accessToken,clusterId,keyword}) {
      const isInitializing=false,workspace=null,environment='',sortBy='',sortOrder='';
      const effectiveClusterId=clusterId,pagination={pageIndex:0,pageSize:25},tableFilters={};
      ${page.deferred ? `const ${vars.get('queryKey')}; const ${vars.get('clusterListScope')};` : ''}
      const ${query};
      ${page.deferred ? 'const ' : ''}${pipeline}
      const names=rows.map(item=>item.name).join(',');capture(${page.variable},names,accessToken);
      return createElement('output',null,names);
    }`;
    const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Probe = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
    const render = async (scope = initialScope) => {
      await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe, scope))));
      await act(async () => { await latest.refetch(); await new Promise(resolve => setTimeout(resolve, 15)); });
    };
    const refetch = async () => {
      await act(async () => { await latest.refetch(); await new Promise(resolve => setTimeout(resolve, 15)); });
    };
    try {
      await render();
      assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-row');
      status = 503;
      await refetch();
      assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-row');
      assert.match(renderToStaticMarkup(createElement(ResourceQueryFeedback, { label: page.label, query: latest })), /已保留最近一次成功读取的数据/);
      for (const denied of [401, 403]) {
        status = denied;
        frames.length = 0;
        await refetch();
        const deniedFrames = frames.filter(frame => isResourceAccessDenied(frame.error));
        assert.ok(deniedFrames.length);
        assert.ok(deniedFrames.every(frame => frame.names === ''), 'permission revocation cannot leak a deferred frame');
        assert.equal(dom.window.document.querySelector('output')!.textContent, '');
        assert.match(renderToStaticMarkup(createElement(ResourceQueryFeedback, { label: page.label, query: latest })), /当前资源内容已隐藏/);
        status = 200;
        await refetch();
        assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-row');
      }
      const scopeChanges: Scope[] = [{ ...initialScope, accessToken: 'account-b' }];
      if (page.variable === 'namespacesQuery' || page.variable === 'nodesQuery') scopeChanges.push({ ...initialScope, clusterId: 'cluster-b' });
      if (page.variable === 'query' || page.variable === 'namespacesQuery') scopeChanges.push({ ...initialScope, keyword: 'new-filter' });
      for (const nextScope of scopeChanges) {
        paused = true;
        frames.length = 0;
        await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe, nextScope))));
        await act(async () => new Promise(resolve => setTimeout(resolve, 15)));
        assert.ok(frames.length);
        assert.ok(frames.every(frame => frame.names === ''), 'changed resource scope must not inherit prior rows');
        assert.equal(dom.window.document.querySelector('output')!.textContent, '');
        paused = false;
        await render();
      }
    } finally {
      await act(async () => root.unmount());
      client.clear();
      await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
      dom.window.close();
      for (const [name, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
}

test('Clusters: list action refresh fetches the active list exactly once', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const client = new QueryClient({ defaultOptions: { queries: { ...listQueryOptions, retry: false, gcTime: Infinity } } });
  const vars = declarations('./page.tsx');
  let requests = 0;
  let refresh!: () => Promise<void>;
  let latest!: UseQueryResult;
  const dependencies = {
    createElement, useQuery, useResourceListQuery, useCallback, queryKeys, scopedPlaceholder,
    CLUSTER_LIST_QUERY_OPTIONS: { ...listQueryOptions, retry: false, gcTime: Infinity },
    queryClient: client,
    getClusters: async () => { requests += 1; return { items: [], total: 0 }; },
    capture: (result: typeof latest, callback: typeof refresh) => { latest = result; refresh = callback; },
  };
  const code = `return function Probe() {
    const accessToken='account-a',keyword='',environment='',isInitializing=false,pagination={pageIndex:0,pageSize:25},sortBy='',sortOrder='';
    const tableData=[],refreshHealthSummaries=async()=>{};
    const ${vars.get('queryKey')}; const ${vars.get('clusterListScope')}; const ${vars.get('query')}; const ${vars.get('refetchList')};
    capture(query,refetchList);return createElement('output');
  }`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Probe = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
    await act(async () => { await latest.refetch(); await new Promise(resolve => setTimeout(resolve, 15)); });
    requests = 0;
    await act(async () => { await refresh(); await new Promise(resolve => setTimeout(resolve, 15)); });
    assert.equal(requests, 1);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
    dom.window.close();
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
