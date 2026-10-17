import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAntdTableSortPagination } from './use-antd-table-sort-pagination';
import { useTableState } from './use-table-state';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

test('resource page pagination inputs all inherit 25 rather than overriding the shared default with 10', () => {
  const files = [
    ...['pods','deployments','statefulsets','daemonsets','replicasets','jobs','cronjobs'].map(name=>`app/workloads/${name}/page.tsx`),
    ...['services','endpoints','endpointslices','ingress','networkpolicy','gateway-api'].map(name=>`app/network/${name}/page.tsx`),
    ...['pv','pvc','sc'].map(name=>`app/storage/${name}/page.tsx`),
    ...['configmaps','secrets','serviceaccounts'].map(name=>`app/configs/${name}/page.tsx`),
    'app/namespaces/page.tsx','app/clusters/nodes/page.tsx','app/clusters/page.tsx',
    'components/configs/dynamic-config-resource-page.tsx','components/workloads/autoscaling-console.tsx',
  ];
  for (const filename of files) {
    const file = ts.createSourceFile(filename, readFileSync(resolve('src', filename),'utf8'), ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let input:ts.Node|undefined;
    function visit(node:ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(file)==='useAntdTableSortPagination') input=node.arguments[0];
      ts.forEachChild(node,visit);
    }
    visit(file); assert.ok(input,`${filename}: production pagination boundary required`);
    const js = ts.transpile(`({searchParams,tableKey})=>(${input.getText(file)})`,{target:ts.ScriptTarget.ES2022});
    const options = new Function(`return ${js}`)()({searchParams:new URLSearchParams(),tableKey:'fixture'});
    let size = 0;
    function Probe() { size=useAntdTableSortPagination(options).pagination.pageSize; return null; }
    renderToStaticMarkup(createElement(Probe));
    assert.equal(size,25,`${filename}: initial resource request must be 25`);
  }
});

test('resource pagination initially requests 25 records and offers compatible size choices', () => {
  let result!: ReturnType<typeof useAntdTableSortPagination>;
  function Probe() {
    result = useAntdTableSortPagination({});
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.equal(result.pagination.pageIndex, 0);
  assert.equal(result.pagination.pageSize, 25);
  const config = result.getPaginationConfig(64);
  assert.equal(config.pageSize, 25);
  assert.equal(config.current, 1);
  assert.ok(config.pageSizeOptions?.includes('25'));
  assert.deepEqual(config.pageSizeOptions, ['10', '25', '50', '100']);
});

test('generic resource list query uses 25 records when no explicit size is chosen', () => {
  let result!: ReturnType<typeof useTableState>;
  function Probe() { result = useTableState(); return null; }
  renderToStaticMarkup(createElement(Probe));
  assert.equal(result.buildListQuery().pageSize, 25);
});

test('a deliberate page size remains respected for deep links and special lists', () => {
  let result!: ReturnType<typeof useAntdTableSortPagination>;
  function Probe() { result = useAntdTableSortPagination({defaultPageSize:50,defaultPage:3}); return null; }
  renderToStaticMarkup(createElement(Probe));
  assert.equal(result.pagination.pageSize, 50);
  assert.equal(result.getPaginationConfig(200).current, 3);
});
