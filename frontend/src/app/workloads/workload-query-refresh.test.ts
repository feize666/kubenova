import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { ResourceQueryFeedback } from '@/components/resource-query-feedback';
import { scopedPlaceholder } from '@/lib/query/scoped-placeholder';
import { listQueryOptions, QUERY_CACHE_TIMINGS } from '@/lib/query/policies';
import { RESOURCE_LIST_REFRESH_OPTIONS } from '@/lib/resource-list-refresh';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';

// Evaluate the production list boundary, not a copy of its options. The slow
// API is controlled; React Query, the list hook and feedback remain real.
function listExpression(page: string) {
  const path = new URL(`./${page}/page.tsx`, import.meta.url);
  const file = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let call: ts.CallExpression | undefined;
  let key: ts.VariableDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ['queryKey', 'workloadsKey'].includes(node.name.getText(file))) key = node;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['useQuery', 'useResourceListQuery'].includes(node.expression.text)) {
      const options = node.arguments[0];
      if (options && /getWorkloads(?:ByKind)?\(/.test(options.getText(file))) call = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(call, `${page}: list query boundary is required`);
  return { call: call.getText(file), key: key?.getText(file) };
}

for (const page of ['pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs']) {
  test(`${page} hides revoked cached rows but retains rows on transient refresh failure`, async () => {
    const dom = new JSDOM('<div id="root"></div>');
    const replacements = { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
    const original = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of Object.entries(replacements)) {
      original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    const root = createRoot(dom.window.document.getElementById('root')!);
    const client = new QueryClient({ defaultOptions: { queries: { ...listQueryOptions, retry: false } } });
    let status = 200;
    let latest!: UseQueryResult<{ items: Array<{ name: string }> }, Error>;
    const api = async (_kind: string, input: { clusterId?: string; namespace?: string }, token: string) => {
      assert.equal(token, 'test-account');
      assert.equal(input.clusterId, 'cluster-a');
      assert.equal(input.namespace, 'prod');
      if (status !== 200) throw new ApiError('fixture failure', status);
      return { items: [{ id: 'fixture-pod', name: 'private-row', namespace: 'prod', clusterId: 'cluster-a', labels: {} }], total: 1 };
    };
    const extracted = listExpression(page);
    const dependencies = {
      createElement, useQuery, useResourceListQuery,
      getWorkloads: api, getWorkloadsByKind: api, scopedPlaceholder, QUERY_CACHE_TIMINGS,
      RESOURCE_LIST_REFRESH_OPTIONS,
      POD_LIST_QUERY_CACHE_OPTIONS: { ...listQueryOptions, retry: false },
      capture: (result: typeof latest) => { latest = result; },
    };
    const code = `return function Probe() {
      const clusterId='cluster-a', namespace='prod', keyword='', 关键字='', accessToken='test-account';
      const mergedFilters=[], phaseFilter='', page=1, pageSize=10, sortBy='', sortOrder='';
      const pagination={pageIndex:0,pageSize:10}, isInitializing=false, POD_KIND='Pod';
      const podListScope=JSON.stringify(['pods',accessToken,clusterId,namespace,keyword,phaseFilter,mergedFilters]);
      ${extracted.key ? `const ${extracted.key};` : ''}
      const result=${extracted.call};
      // Consumers read error/fetch state to render ResourceQueryFeedback.
      const {isError,isFetching,error}=result; capture({...result,isError,isFetching,error});
      return createElement('output',null,result.data?.items?.map(item=>item.name).join(',') ?? '');
    }`;
    const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Probe = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
    try {
      await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Probe))); });
      await act(async () => { await latest.refetch(); await new Promise(resolve => setTimeout(resolve, 10)); });
      assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-row');
      status = 503;
      await act(async () => { await latest.refetch(); await new Promise(resolve => setTimeout(resolve, 10)); });
      assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-row');
      assert.match(renderToStaticMarkup(createElement(ResourceQueryFeedback, { label: page, query: latest })), /已保留最近一次成功读取的数据/);
      status = 403;
      await act(async () => { await latest.refetch(); await new Promise(resolve => setTimeout(resolve, 10)); });
      assert.equal(dom.window.document.querySelector('output')!.textContent, '', 'revoked resource rows must disappear');
      assert.match(renderToStaticMarkup(createElement(ResourceQueryFeedback, { label: page, query: latest })), /当前资源内容已隐藏/);
    } finally {
      await act(async () => root.unmount());
      client.clear(); dom.window.close();
      for (const [name, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
}
