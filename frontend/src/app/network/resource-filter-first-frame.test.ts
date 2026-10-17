import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { act, createElement, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';
import { useScopedDeferredValue } from '@/hooks/use-scoped-deferred-value';
import { scopedPlaceholder } from '@/lib/query/scoped-placeholder';
import { isResourceAccessDenied } from '@/lib/query/visible-resource-data';
import { QUERY_CACHE_TIMINGS } from '@/lib/query';
import { getClusterDisplayName } from '@/lib/cluster-display-name';
import { matchLabelExpressions } from '@/components/resource-action-bar';

type Page = 'services' | 'pods';
type Row = { name: string; [key: string]: unknown };
type Snapshot = { rows: Row[]; sourceItems: Row[] };
type Controls = {
  accessToken: string; clusterId: string; namespace: string; keyword: string;
  mergedFilters: string[]; tableFilters: Record<string, string>;
  pagination: { pageIndex: number; pageSize: number };
};

// Execute the page's dependency chain ending at ResourceTable.dataSource. Only
// external controls and the HTTP boundary are supplied by this React fixture.
function pageConsumer(page: Page) {
  const filename = resolve(`src/app/${page === 'services' ? 'network/services' : 'workloads/pods'}/page.tsx`);
  const file = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = file.statements.find(node => ts.isFunctionDeclaration(node) &&
    node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword));
  assert.ok(component && ts.isFunctionDeclaration(component) && component.body);
  const definitions = new Map<string, ts.Node>();
  function bindingNames(name: ts.BindingName): string[] {
    return ts.isIdentifier(name) ? [name.text] : name.elements.flatMap(element =>
      ts.isBindingElement(element) ? bindingNames(element.name) : []);
  }
  for (const statement of [...file.statements, ...component.body.statements]) {
    if (ts.isFunctionDeclaration(statement) && statement !== component && statement.name) {
      definitions.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      for (const name of bindingNames(declaration.name)) definitions.set(name, declaration);
    }
  }
  let consumer: ts.Expression | undefined;
  function findConsumer(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'ResourceTable') {
      const attribute = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(file) === 'dataSource');
      if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
        consumer = attribute.initializer.expression;
      }
    }
    ts.forEachChild(node, findConsumer);
  }
  findConsumer(component);
  assert.ok(consumer, `${page} table consumer was not found`);
  const external = new Set(['accessToken', 'clusterId', 'namespace', 'keyword', 'mergedFilters', 'tableFilters', 'pagination', 'sortBy', 'sortOrder', 'isInitializing', 'clusterMap']);
  const selected = new Set<ts.Node>();
  function selectDependencies(node: ts.Node) {
    if (ts.isIdentifier(node) && !external.has(node.text)) {
      const definition = definitions.get(node.text);
      if (definition && !selected.has(definition)) {
        selected.add(definition);
        selectDependencies(definition);
      }
    }
    ts.forEachChild(node, selectDependencies);
  }
  selectDependencies(consumer);
  const statements = [...selected].sort((left, right) => left.pos - right.pos).map(node =>
    ts.isVariableDeclaration(node) ? `const ${node.getText(file)};` : node.getText(file));
  const data = page === 'services' ? 'data' : 'podsQuery.data';
  const js = ts.transpile(`(env) => { with (env) { ${statements.join('\n')} return { rows: ${consumer.getText(file)}, sourceItems: ${data}?.items ?? [] }; } }`, { target: ts.ScriptTarget.ES2022 });
  return new Function(`return ${js}`)() as (env: Record<string, unknown>) => Snapshot;
}

function response(params: Record<string, unknown>, token: string) {
  const page = Number(params.page ?? 1);
  const namespace = String(params.namespace ?? 'prod');
  const clusterId = String(params.clusterId ?? 'cluster-a');
  const suffix = page === 1 ? '' : '-page2';
  const items = ['old', 'new'].map((label, index) => ({
    id: `${token}/${clusterId}/${namespace}/${label}${suffix}`,
    name: `${label}-row${suffix}`, clusterId, namespace,
    kind: 'Pod', labels: { app: label, team: 'ops' }, annotations: {},
    spec: { type: index === 0 ? 'ClusterIP' : 'NodePort' },
    statusJson: { phase: index === 0 ? 'Running' : 'Pending', podIP: `10.0.0.${index + 1}`, nodeName: `node-${label}`, restartCount: 0, containerNames: [], containerImages: [] },
    replicas: 1, readyReplicas: index === 0 ? 1 : 0, state: 'active',
    status: index === 0 ? 'Running' : 'Pending',
    createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
  }));
  return { items, total: 4, page, pageSize: 2 };
}

async function withPage(page: Page, run: (harness: Awaited<ReturnType<typeof mountPage>>) => Promise<void>) {
  const harness = await mountPage(page);
  try { await run(harness); } finally { await harness.close(); }
}

async function mountPage(page: Page) {
  const consume = pageConsumer(page);
  const dom = new JSDOM('<div id="root"></div>');
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const controls: Controls = {
    accessToken: 'account-a', clusterId: 'cluster-a', namespace: 'prod', keyword: '',
    mergedFilters: [], tableFilters: {}, pagination: { pageIndex: 0, pageSize: 2 },
  };
  const frames: Snapshot[] = [];
  const clusterMap = { 'cluster-a': 'Alpha', 'cluster-b': 'Beta' };
  let holdRequests = false;
  const pending: Array<() => void> = [];
  function fetchResources(params: Record<string, unknown>, token: string) {
    const data = response(params, token);
    return holdRequests ? new Promise(resolve => pending.push(() => resolve(data))) : Promise.resolve(data);
  }
  function Probe() {
    const snapshot = consume({
      ...controls, useMemo, useResourceListQuery, useScopedDeferredValue,
      scopedPlaceholder, isResourceAccessDenied, QUERY_CACHE_TIMINGS,
      getClusterDisplayName, matchLabelExpressions,
      clusterMap,
      isInitializing: false, sortBy: undefined, sortOrder: undefined,
      getNetworkResources: fetchResources,
      getWorkloadsByKind: (_kind: string, params: Record<string, unknown>, token: string) => fetchResources(params, token),
    });
    frames.push(snapshot);
    return createElement('output', null, JSON.stringify(snapshot.rows.map(row => row.name)));
  }
  const render = () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe)));
  async function settle() {
    for (let attempt = 0; attempt < 40; attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      if (!client.isFetching() && frames.at(-1)?.sourceItems.length) return;
    }
    assert.fail('controlled resource request did not settle');
  }
  async function update(patch: Partial<Controls>) {
    Object.assign(controls, patch);
    frames.length = 0;
    await act(async () => { render(); });
    assert.ok(frames.length > 0, 'the consumer must render after changing controls');
  }
  async function release() {
    holdRequests = false;
    await act(async () => { for (const resolveRequest of pending.splice(0)) resolveRequest(); });
    await settle();
  }
  async function close() {
    await act(async () => root.unmount());
    await client.cancelQueries();
    for (const resolveRequest of pending.splice(0)) resolveRequest();
    client.clear(); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
  try {
    await act(async () => { render(); });
    await settle();
    assert.equal(dom.window.document.querySelector('output')!.textContent, '["old-row","new-row"]');
  } catch (error) { await close(); throw error; }
  return { controls, frames, update, release, close, hold: () => { holdRequests = true; }, shown: () => JSON.parse(dom.window.document.querySelector('output')!.textContent!) as string[] };
}

function assertEveryFrame(frames: Snapshot[], expected: string[], message: string) {
  assert.ok(frames.length > 0, 'the assertion must observe at least one React render');
  for (const frame of frames) assert.deepEqual(frame.rows.map(row => row.name), expected, message);
}

for (const page of ['services', 'pods'] as const) {
  // Removing label expressions from the view/list scope must expose old-row
  // here, even when the destination label query already has a cached result.
  test(`${page}: label changes never show old matches, including cached label return`, async () => withPage(page, async harness => {
    await harness.update({ mergedFilters: ['app=old'] });
    await harness.release();
    assert.deepEqual(harness.shown(), ['old-row']);
    harness.hold();
    await harness.update({ mergedFilters: ['app=new'] });
    assertEveryFrame(harness.frames, page === 'services' ? ['new-row'] : [], 'new label first frame must not show old-label rows');
    await harness.release();
    assert.deepEqual(harness.shown(), ['new-row']);
    harness.hold();
    await harness.update({ mergedFilters: ['app=old'] });
    assertEveryFrame(harness.frames, ['old-row'], 'cached label return must be filtered in its first render');
    assert.deepEqual(harness.shown(), ['old-row']);
  }));

  const columns: Array<Record<string, string>> = page === 'services'
    ? [{ name: 'new' }, { namespace: 'missing' }, { clusterId: 'beta' }, { type: 'nodeport' }]
    : [{ name: 'new' }, { namespace: 'missing' }, { clusterId: 'beta' }, { podIP: '10.0.0.2' }, { nodeName: 'node-new' }];
  for (const filters of columns) test(`${page}: ${Object.keys(filters)[0]} column filter applies on the first render`, async () => withPage(page, async harness => {
    // Removing tableFilters from the view scope would retain the unfiltered page.
    const expected = 'name' in filters || 'type' in filters || 'podIP' in filters || 'nodeName' in filters ? ['new-row'] : [];
    await harness.update({ tableFilters: filters });
    assertEveryFrame(harness.frames, expected, 'column filtering must not defer the previous filter result');
    assert.deepEqual(harness.shown(), expected);
  }));

  for (const [scope, patch] of Object.entries({
    namespace: { namespace: 'dev' }, cluster: { clusterId: 'cluster-b' },
    account: { accessToken: 'account-b' }, keyword: { keyword: 'new-query' },
  })) test(`${page}: uncached ${scope} scope hides prior records in every render`, async () => withPage(page, async harness => {
    // Omitting the changed scope from query/deferred isolation exposes prior rows.
    harness.hold();
    await harness.update(patch);
    assertEveryFrame(harness.frames, [], `${scope} first frame must not carry prior-scope records`);
    assert.deepEqual(harness.shown(), []);
    await harness.release();
    assert.deepEqual(harness.shown(), ['old-row', 'new-row']);
  }));

  for (const [scope, patch, restore] of [
    ['namespace', { namespace: 'dev' }, { namespace: 'prod' }],
    ['account', { accessToken: 'account-b' }, { accessToken: 'account-a' }],
  ] as const) test(`${page}: cached ${scope} return never defers a different resource identity`, async () => withPage(page, async harness => {
    await harness.update(patch);
    await harness.release();
    harness.hold();
    await harness.update(restore);
    assertEveryFrame(harness.frames, ['old-row', 'new-row'], 'cached scope returns show its matching snapshot immediately');
    for (const frame of harness.frames) assert.deepEqual(frame.rows.map(row => row.id), [
      'account-a/cluster-a/prod/old', 'account-a/cluster-a/prod/new',
    ], 'matching names must not conceal a stale account/namespace identity');
  }));

  test(`${page}: same-scope pagination retains rows and still defers the new page`, async () => withPage(page, async harness => {
    // Including page in isolation scope would clear the existing page; replacing
    // scoped deferral with identity would skip the old-data/new-query render.
    harness.hold();
    await harness.update({ pagination: { pageIndex: 1, pageSize: 2 } });
    assertEveryFrame(harness.frames, ['old-row', 'new-row'], 'same-scope page requests retain the visible snapshot');
    harness.frames.length = 0;
    await harness.release();
    assert.ok(harness.frames.some(frame => frame.sourceItems[0]?.name === 'old-row-page2' && frame.rows[0]?.name === 'old-row'), 'new query data should first retain the deferred previous-page rows');
    assert.deepEqual(harness.shown(), ['old-row-page2', 'new-row-page2']);
  }));
}

test('pods: phase column changes hide prior phase rows before the request and on cached return', async () => withPage('pods', async harness => {
  harness.hold();
  await harness.update({ tableFilters: { phase: 'Pending' } });
  assertEveryFrame(harness.frames, [], 'an uncached phase query must not show old Running rows');
  await harness.release();
  assert.deepEqual(harness.shown(), ['new-row']);
  harness.hold();
  await harness.update({ tableFilters: {} });
  assertEveryFrame(harness.frames, ['old-row', 'new-row'], 'cached phase reset must not retain the Pending-only result');
}));
