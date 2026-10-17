import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';

function queryDeclaration(file: string, variable: string) {
  const path = new URL(`./${file}`, import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variable) declaration = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration, 'production query declaration is required');
  return declaration;
}

const cases = [
  ['create-grant.tsx', 'users'], ['create-grant.tsx', 'groups'],
  ['create-grant.tsx', 'clusters'], ['create-grant.tsx', 'namespaces'],
  ['group-manager.tsx', 'groups'], ['group-manager.tsx', 'users'], ['group-manager.tsx', 'members'],
] as const;

// The regression is an unprotected production query exposing its success cache
// after read revocation. Execute the real declarations; only HTTP is controlled.
for (const [file, variable] of cases) test(`${file} ${variable}: 200 -> 503 -> 403 -> 503/remount -> 200 masks revoked candidates`, async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0, gcTime: Infinity, refetchOnMount: false } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  let status = 200;
  let latest!: UseQueryResult<{ items: string[] }>;
  let requests = 0;
  const frames: Array<{ data: unknown; error: unknown }> = [];
  let generation = 0;
  const api = async () => {
    requests += 1;
    if (status !== 200) throw new ApiError('fixture failure', status);
    return { items: ['private-candidate'] };
  };
  const dependencies = { createElement, useQuery, useResourceListQuery, useLayoutEffect,
    getUsers: api, getGrantGroups: api, getClusters: api, getNamespaces: api, getGroupMembers: api,
    capture: (query: typeof latest) => { latest = query; frames.push({ data: query.data, error: query.error }); },
  };
  const code = `return function Probe() {
    const token='account-a',accessToken=token,principalType='group',clusterId='cluster-a',groupId='group-a',page=1;
    const userSearch='',groupSearch='',clusterSearch='',namespaceSearch='',search='';
    const ${queryDeclaration(file, variable)};
    useLayoutEffect(()=>capture(${variable}));
    return createElement('output',null,${variable}.data?.items.join(',') ?? 'hidden');
  }`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Probe = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  const settle = () => new Promise(resolve => setTimeout(resolve, 15));
  const render = () => act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe, { key: generation })));
    await settle();
  });
  const refresh = () => act(async () => {
    await latest.refetch();
    await settle();
  });
  try {
    await render();
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-candidate');
    status = 503;
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-candidate');
    status = 403;
    requests = 0;
    frames.length = 0;
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'hidden', 'revoked candidates must be hidden');
    assert.ok(frames.some(frame => frame.error instanceof ApiError && frame.error.status === 403));
    assert.ok(frames.filter(frame => frame.error instanceof ApiError && frame.error.status === 403).every(frame => frame.data === undefined), 'no denied commit may expose candidates');
    assert.equal(requests, 1, 'permission failure must not retry');
    status = 503;
    frames.length = 0;
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'hidden');
    assert.ok(frames.every(frame => frame.data === undefined), '503 after denial cannot revive cached candidates');
    generation += 1;
    frames.length = 0;
    await render();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'hidden');
    assert.ok(frames.every(frame => frame.data === undefined), 'remount cannot revive cached candidates');
    status = 200;
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-candidate');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    await settle();
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
