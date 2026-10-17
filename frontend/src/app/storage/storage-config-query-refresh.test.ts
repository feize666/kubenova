import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Alert, Typography } from 'antd';
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';
import { ResourceQueryFeedback } from '@/components/resource-query-feedback';
import { listQueryOptions } from '@/lib/query/policies';
import { RESOURCE_LIST_REFRESH_OPTIONS } from '@/lib/resource-list-refresh';

type ListData = { items: Array<{ id: string; name: string }>; total: number; page: number; pageSize: number };

// Execute each page's real query and feedback boundary. Only the external API
// is controlled, so bypassing the permission guard would expose a cached row.
function pageBoundary(path: string) {
  const filePath = new URL(path, import.meta.url);
  const file = ts.createSourceFile(filePath.pathname, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let query: ts.CallExpression | undefined;
  let feedback: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['useQuery', 'useResourceListQuery'].includes(node.expression.text)) {
      if (/get(?:StorageResources|Configs|DynamicResources)\(/.test(node.arguments[0]?.getText(file) ?? '')) query = node;
    }
    if (ts.isConditionalExpression(node) && ['isError', 'listQuery.isError'].includes(node.condition.getText(file))) feedback = node;
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'ResourceQueryFeedback') feedback = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(query, `${path}: resource list query is required`);
  assert.ok(feedback, `${path}: resource feedback is required`);
  return { query: query.getText(file), feedback: feedback.getText(file) };
}

const pages = [
  { path: './pv/page.tsx', resource: 'PV', namespace: undefined },
  { path: './pvc/page.tsx', resource: 'PVC', namespace: 'prod' },
  { path: './sc/page.tsx', resource: 'SC', namespace: undefined },
  { path: '../configs/configmaps/page.tsx', resource: 'configmaps', namespace: 'prod' },
  { path: '../configs/secrets/page.tsx', resource: 'secrets', namespace: 'prod' },
  { path: '../configs/serviceaccounts/page.tsx', resource: 'serviceaccounts', namespace: 'prod' },
  { path: '../../components/configs/dynamic-config-resource-page.tsx', resource: 'limitranges', namespace: 'prod' },
  { path: '../../components/configs/dynamic-config-resource-page.tsx', resource: 'resourcequotas', namespace: 'prod' },
];

for (const page of pages) {
  test(`${page.resource}: revoke cached rows immediately, retain transient snapshot, and recover`, async () => {
    const dom = new JSDOM('<div id="root"></div>');
    const replacements = { window: dom.window, document: dom.window.document, ShadowRoot: dom.window.ShadowRoot, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement, Element: dom.window.Element, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of Object.entries(replacements)) {
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    const root = createRoot(dom.window.document.getElementById('root')!);
    const client = new QueryClient({ defaultOptions: { queries: { ...listQueryOptions, retry: false, gcTime: Infinity } } });
    let status = 200;
    let latest!: UseQueryResult<ListData, Error>;
    const frames: Array<{ denied: boolean; visible: boolean }> = [];
    const api = async (params: { clusterId?: string; namespace?: string; kind?: string; resource?: string; pageSize?: number }, token?: string) => {
      assert.equal(token, 'test-account');
      assert.equal(params.clusterId, 'cluster-a');
      assert.equal(params.namespace, page.namespace);
      assert.equal(params.kind ?? params.resource, page.resource);
      assert.equal(params.pageSize, 25);
      if (status !== 200) throw new ApiError('controlled request failure', status);
      return { items: [{ id: 'private-resource', name: 'private-row', kind: page.resource, clusterId: 'cluster-a', namespace: page.namespace, labels: {}, state: 'active', createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', dataCount: 1, version: 1 }], total: 1, page: 1, pageSize: 25 };
    };
    const boundary = pageBoundary(page.path);
    const dependencies = {
      React, Alert, Typography, ResourceQueryFeedback, useQuery, useResourceListQuery, RESOURCE_LIST_REFRESH_OPTIONS,
      getStorageResources: api, getDynamicResources: api,
      getConfigs: (kind: string, params: Parameters<typeof api>[0], token: string) => api({ ...params, kind }, token),
      capture: (query: typeof latest) => {
        latest = query;
        const requestStatus = query.error instanceof ApiError ? query.error.status : 0;
        frames.push({ denied: requestStatus === 401 || requestStatus === 403, visible: Boolean(query.data?.items.length) });
      },
    };
    const code = `return function Probe() {
      const clusterId='cluster-a',namespace='prod',keyword='',accessToken='test-account';
      const pagination={pageIndex:0,pageSize:25},sortBy='',sortOrder='',isInitializing=false;
      const tableKey='${page.resource}',group='',version='v1',resource='${page.resource}',titleKind='${page.resource}';
      const listQuery=${boundary.query};
      const {data,isLoading,isError,isFetching,error,refetch}=listQuery;
      capture(listQuery);
      return <><output>{data?.items.map(item=>item.name).join(',')??''}</output>{${boundary.feedback}}</>;
    }`;
    const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    const Probe = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
    async function refresh(nextStatus: number) {
      status = nextStatus;
      await act(async () => { await latest.refetch({ cancelRefetch: false }); await new Promise(resolve => setTimeout(resolve, 20)); });
    }
    try {
      await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe))); });
      await refresh(200);
      assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-row');
      for (const denied of [403, 401]) {
        await refresh(denied);
        assert.equal(dom.window.document.querySelector('output')!.textContent, '', 'revoked resource rows must disappear');
        assert.ok(frames.filter(frame => frame.denied).every(frame => !frame.visible), 'no denied render can expose cached rows');
        assert.match(dom.window.document.body.textContent!, /当前资源内容已隐藏/);
        await refresh(200);
        assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-row');
        assert.equal(dom.window.document.querySelector('.ant-alert'), null);
      }
      await refresh(503);
      assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-row');
      assert.ok(dom.window.document.querySelector('.ant-alert-warning'), 'transient refresh failure must warn without hiding the snapshot');
      assert.match(dom.window.document.body.textContent!, /已保留最近一次成功读取的数据/);
      status = 200;
      await act(async () => {
        dom.window.document.querySelector<HTMLButtonElement>('.ant-alert button')!.click();
        await new Promise(resolve => setTimeout(resolve, 25));
      });
      assert.equal(dom.window.document.querySelector('.ant-alert'), null, 'retry must restore the list');
    } finally {
      await act(async () => root.unmount());
      client.clear();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      dom.window.close();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
}
