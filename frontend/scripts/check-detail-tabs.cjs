const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

// Exercise the tab configuration and JSX identity passed to the YAML editor.
const source = fs.readFileSync('src/app/clusters/[clusterId]/resource/[kind]/[...id]/detail-config.tsx', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exportsObject = {};
vm.runInNewContext(code, { exports: exportsObject, require(name) {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return require(name);
  if (name === 'next/dynamic') return { default: () => () => null };
  if (name.endsWith('auth-context')) return { useAuth: () => ({ accessToken: 'test' }) };
  if (name.endsWith('resource-yaml-drawer')) return { ResourceYamlDrawer: () => null };
  return {};
} });
assert.deepEqual(Array.from(exportsObject.getDetailTabs('Pod'), t => t.key), ['overview', 'logs', 'terminal', 'yaml']);
for (const kind of ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Node', 'Service']) {
  assert(!exportsObject.getDetailTabs(kind).some(t => ['conditions', 'events', 'containers'].includes(t.key)), kind);
}
const element = exportsObject.renderTabContent('yaml', { detail: { overview: { id: 'database-id', name: 'test-pod', namespace: 'loop', clusterId: 'cluster-1', kind: 'Pod' } } });
const editor = element.type(element.props);
assert.equal(editor.props.identity.name, 'test-pod');
assert.equal(editor.props.embedded, true);
console.log('Detail tabs and YAML identity checks passed');
