import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const routes = [
  'workloads/deployments', 'workloads/statefulsets', 'workloads/daemonsets',
  'workloads/pods', 'workloads/jobs', 'workloads/cronjobs', 'workloads/replicasets',
  'network/services', 'network/ingress', 'network/networkpolicy',
  'network/endpoints', 'network/endpointslices',
  'storage/pvc', 'storage/pv', 'storage/sc', 'configs/configmaps', 'configs/secrets',
  'configs/serviceaccounts', 'namespaces',
  'network/ingressclasses',
];
for (const route of routes) {
  const source = read(`src/app/${route}/page.tsx`);
  assert.match(source, /toolbarPrimary=/, `${route}: creation must be in table toolbar`);
  assert.match(source, /label="创建"/, `${route}: primary creation label missing`);
  assert.match(source, /editorMode="yaml"/, `${route}: YAML entry missing`);
  assert.doesNotMatch(source, /extra=\{<ResourceAddButton/, `${route}: duplicate header creation`);
}
const toolbar = read('src/components/resource-table-toolbar.tsx');
assert.match(toolbar, /\{primary\}\{extra\}\{searchPanel\}/, 'creation, scope, search order');
assert.match(toolbar, /aria-label="搜索资源"/, 'search must have accessible name');
assert.doesNotMatch(toolbar, /autoFocus/, 'search must not steal focus on navigation');
console.log(`[check-list-toolbar-contracts] PASS: ${routes.length} resource list entry contracts.`);
