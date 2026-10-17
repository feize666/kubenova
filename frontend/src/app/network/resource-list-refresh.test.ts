import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider, QueryObserver, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { scopedPlaceholder } from '@/lib/query/scoped-placeholder';
import { RESOURCE_LIST_REFRESH_OPTIONS } from '@/lib/resource-list-refresh';
import { listQueryOptions } from '@/lib/query/policies';
import { ResourceQueryFeedback } from '@/components/resource-query-feedback';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';

const pages = ['services', 'endpoints', 'endpointslices', 'ingress', 'networkpolicy', 'gateway-api'];

// Extract the actual page query boundary rather than duplicating its options in the fixture.
function pageQuery(page: string) {
  const filename = resolve('src/app/network', page, 'page.tsx');
  const file = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let call: ts.CallExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
      const expression = node.initializer;
      if (['useQuery', 'useResourceListQuery'].includes(expression.expression.getText(file)) &&
          /getNetworkResources|getDynamicResources/.test(expression.arguments[0]?.getText(file) ?? '')) call = expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(call, `${page} main resource query was not found`);
  const js = ts.transpile(`(env) => { with(env) { return ${call.getText(file)}; } }`, { target: ts.ScriptTarget.ES2022 });
  return new Function(`return ${js}`)() as (env: Record<string, unknown>) => ReturnType<typeof useQuery>;
}

for (const page of pages) test(`${page}: refresh retains snapshots but namespace changes and authorization failures never expose old records`, async () => {
  const query = pageQuery(page);
  const dom = new JSDOM('<div id="root"></div>');
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, ShadowRoot: dom.window.ShadowRoot, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { ...listQueryOptions, retry: false } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  let namespace = 'prod';
  let clusterId = 'cluster-a';
  let accessToken = 'account-a';
  let keyword = '';
  let failure: unknown;
  let result: ReturnType<typeof useQuery>;
  let resolveRequest: ((value: unknown) => void) | undefined;
  let pending = false;
  const frames: Array<unknown> = [];
  try {
    const fetchResources = async () => {
      if (pending) return new Promise(resolve => { resolveRequest = resolve; });
      if (failure) throw failure;
      return { items: [{ name: `${namespace}-private-row` }], total: 1, page: 1, pageSize: 10 };
    };
    function Probe() {
      const env = {
        useQuery, useResourceListQuery, scopedPlaceholder,
        SERVICE_LIST_QUERY_CACHE_OPTIONS: { retry: false }, RESOURCE_LIST_REFRESH_OPTIONS,
        serviceListScope: JSON.stringify([accessToken, clusterId, namespace, keyword]), serviceListParams: { clusterId, namespace, keyword }, SERVICE_KIND: 'Service',
        clusterId, namespace, keyword, page: 1,
        pagination: { pageIndex: 0, pageSize: 10 }, sortBy: undefined, sortOrder: undefined,
        accessToken, isInitializing: false, getNetworkResources: fetchResources,
        getDynamicResources: fetchResources, kind: 'gateway', kindMeta: { version: 'v1', resource: 'gateways', namespaced: true },
      };
      result = query(env);
      frames.push(result.data);
      return createElement('div', null,
        createElement('output', null, JSON.stringify(result.data ?? null)),
        createElement(ResourceQueryFeedback, { label: page, query: result }));
    }
    const render = () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe)));
    const flush = () => act(async () => { return new Promise<void>(resolve => setTimeout(resolve, 20)); });
    await act(async () => { render(); await new Promise(resolve => setTimeout(resolve, 20)); });
    await act(async () => { await result!.refetch(); });
    await flush();
    assert.match(dom.window.document.querySelector('output')!.textContent!, /prod-private-row/);
    failure = new Error('offline');
    await act(async () => { await result!.refetch(); });
    await flush();
    assert.match(dom.window.document.querySelector('output')!.textContent!, /prod-private-row/);
    assert.match(dom.window.document.body.textContent!, /刷新失败/);
    for (const status of [401, 403]) {
      failure = new ApiError('access denied', status);
      await act(async () => { await result!.refetch(); });
      await flush();
      assert.equal(dom.window.document.querySelector('output')!.textContent!, 'null', `status ${status} must hide successful cached rows`);
      failure = undefined;
      await act(async () => { await result!.refetch(); });
      await flush();
    }
    for (const scope of ['namespace', 'cluster', 'account', 'keyword']) {
      frames.length = 0;
      if (scope === 'namespace') namespace = 'dev';
      if (scope === 'cluster') clusterId = 'cluster-b';
      if (scope === 'account') accessToken = 'account-b';
      if (scope === 'keyword') keyword = 'new-search';
      pending = true; resolveRequest = undefined;
      await act(async () => { render(); });
      assert.ok(frames.length > 0 && frames.every(frame => frame === undefined), `${scope} transition must not retain previous rows in any render`);
      assert.ok(resolveRequest);
      await act(async () => { resolveRequest!({ items: [{ name: `${scope}-row` }], total: 1 }); });
      await flush();
      assert.match(dom.window.document.querySelector('output')!.textContent!, new RegExp(`${scope}-row`));
    }
  } finally {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, value] of originals) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  }
});

for (const mutationName of ['applyYamlMutation', 'deleteMutation']) test(`Endpoints ${mutationName}: success performs exactly one list refresh`, async () => {
  const filename = resolve('src/app/network/endpoints/page.tsx');
  const file = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let success: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === mutationName && node.initializer && ts.isCallExpression(node.initializer)) {
      const options = node.initializer.arguments[0];
      if (ts.isObjectLiteralExpression(options)) {
        const property = options.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(file) === 'onSuccess');
        if (property && ts.isPropertyAssignment(property)) success = property.initializer;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(success);
  const js = ts.transpile(`(env) => { with(env) { return ${success.getText(file)}; } }`, { target: ts.ScriptTarget.ES2022 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['network', 'Endpoints', 'prod'], { items: [] });
  let requests = 0;
  const observer = new QueryObserver(client, {
    queryKey: ['network', 'Endpoints', 'prod'], staleTime: Infinity,
    queryFn: async () => { requests++; return { items: [] }; },
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const onSuccess = new Function(`return ${js}`)()({
      queryClient: client, refetch: () => observer.refetch(), message: { success: () => {} },
      setModalOpen: () => {}, setCreateYaml: () => {},
    });
    await onSuccess({ message: 'done' });
    assert.equal(requests, 1, 'invalidation already refreshes the active list; an extra refetch creates a duplicate request');
  } finally { unsubscribe(); client.clear(); }
});
