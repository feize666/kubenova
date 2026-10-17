import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, useMemo } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseResourceSearchInput, matchLabelExpressions } from '../../../components/resource-action-bar.tsx';
import { getClusterDisplayName } from '../../../lib/cluster-display-name.ts';

const source = readFileSync('src/app/network/gateway-api/page.tsx', 'utf8');
const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = file.statements.filter(node => ts.isFunctionDeclaration(node) && ['getTextFilter', 'textMatches'].includes(node.name?.text)).map(node => node.getText(file));
let initializer, changeHandler, searchHandler;
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'tableData') initializer = node.initializer.getText(file);
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleGlobalSearchChange') changeHandler = node.initializer.getText(file);
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleSearch') searchHandler = node.initializer.getText(file);
  ts.forEachChild(node, walk);
}
walk(file);
assert.ok(initializer);
const compiled = ts.transpile(`(env) => { with(env) { ${helpers.join('\n')} return ${initializer}; } }`, { target: ts.ScriptTarget.ES2022 });
const consume = new Function(`return ${compiled}`)();
const rows = [
  { name: 'exact', labels: { app: 'detail', env: 'prod' } },
  { name: 'suffix', labels: { app: 'detail-matrix', env: 'prod' } },
  { name: 'case', labels: { App: 'DETAIL', env: 'PROD' } },
  { name: 'key-suffix', labels: { 'myapp': 'detail', env: 'prod' } },
  { name: 'other-env', labels: { app: 'detail', env: 'dev' } },
];
function shown(input) {
  const mergedFilters = parseResourceSearchInput(input).labelExpressions;
  let actual;
  function Probe() {
    actual = consume({ useMemo, rows, mergedFilters, tableFilters: {}, clusterMap: {}, getClusterDisplayName, matchLabelExpressions }).map(row => row.name);
    return createElement('output', null, JSON.stringify(actual));
  }
  renderToStaticMarkup(createElement(Probe));
  return actual;
}
for (const [input, expected] of [
  ['app=detail', ['exact', 'other-env']],
  ['app=DETAIL', []],
  ['App=DETAIL', ['case']],
  ['app=detail env=prod', ['exact']],
]) {
  test(`Gateway actual tableData honors exact case-sensitive label expressions: ${input}`, () => {
    assert.deepEqual(shown(input), expected);
  });
}
for (const [name, expression] of [['change', changeHandler], ['submit', searchHandler]]) {
  test(`Gateway ${name} search separates name keyword from label expressions`, () => {
    assert.ok(expression);
    let keyword, labels, resets = 0;
    const env = { parseResourceSearchInput, keywordInput: 'gw-a app=detail env=prod', resetPage: () => resets++, setKeywordInput: () => {}, setKeyword: value => keyword = value, setMergedFilters: value => labels = value };
    const js = ts.transpile(`(env) => { with(env) { return ${expression}; } }`, { target: ts.ScriptTarget.ES2022 });
    const handler = new Function(`return ${js}`)()(env);
    handler('gw-a app=detail env=prod');
    assert.equal(keyword, 'gw-a');
    assert.deepEqual(labels, ['app=detail', 'env=prod']);
    assert.equal(resets, 1);
  });
}
