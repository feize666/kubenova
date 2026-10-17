import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResourceManifest } from '@/lib/resource-editor';
// These are the production modules imported by the form, not test-only copies.
import * as model from './native-model';
const resource = (kind: string, fields = {}): ResourceManifest => ({ apiVersion: 'v1', kind, metadata: { name: 'demo' }, ...fields });

test('Ingress fields update nested service paths and preserve unknown siblings', () => {
  assert.equal(typeof model.updateNativeField, 'function');
  const input = resource('Ingress', { spec: { rules: [{ host: 'old', custom: 7, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'api', port: { number: 80 } } }, extra: true }] } }] } });
  const result = model.updateNativeField(input, ['spec', 'rules', 0, 'http', 'paths', 0, 'backend', 'service', 'name'], 'web', 'create');
  assert.equal((result.spec as any).rules[0].http.paths[0].backend.service.name, 'web');
  assert.equal((result.spec as any).rules[0].custom, 7);
  assert.equal((result.spec as any).rules[0].http.paths[0].extra, true);
  assert.equal((result.spec as any).rules[0].apiGroups, undefined);
  assert.equal((input.spec as any).rules[0].http.paths[0].backend.service.name, 'api');
  const rules = model.nativeFields('Ingress').find(field => field.path.join('.') === 'spec.rules');
  assert.ok(rules?.fields?.some(field => field.path.join('.') === 'http.paths'));
});

test('subjects and RBAC have distinct fields, and roleRef is immutable in edit', () => {
  assert.equal(typeof model.updateNativeField, 'function');
  const input = resource('RoleBinding', { roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'reader' }, subjects: [{ kind: 'ServiceAccount', name: 'old', namespace: 'dev', extension: 'keep' }] });
  const next = model.updateNativeField(input, ['subjects', 0, 'name'], 'new', 'edit');
  assert.deepEqual(next.subjects, [{ kind: 'ServiceAccount', name: 'new', namespace: 'dev', extension: 'keep' }]);
  assert.equal(model.updateNativeField(input, ['roleRef', 'name'], 'admin', 'edit'), input);
  assert.equal(model.updateNativeField(input, ['subjects', 0, 'name'], 'new', 'edit', true), input);
});

test('Service named ports survive and switching ExternalName removes incompatible fields', () => {
  assert.equal(typeof model.updateNativeField, 'function');
  const input = resource('Service', { spec: { type: 'NodePort', selector: { app: 'api' }, clusterIP: '10.0.0.3', clusterIPs: ['10.0.0.3'], ports: [{ name: 'web', port: 80, targetPort: 'http', nodePort: 30123, protocol: 'UDP', extra: true }] } });
  const next = model.updateNativeField(input, ['spec', 'type'], 'ExternalName', 'create');
  assert.equal((next.spec as any).selector, undefined);
  assert.equal((next.spec as any).clusterIP, undefined);
  assert.equal((next.spec as any).ports[0].nodePort, undefined);
  assert.equal((next.spec as any).ports[0].targetPort, 'http');
  assert.equal((next.spec as any).ports[0].extra, true);
  assert.equal(model.parseIntOrString('http'), 'http');
  assert.equal(model.parseIntOrString('8080'), 8080);
});

test('PV source switching is exclusive and edit guards protect immutable fields', () => {
  assert.equal(typeof model.setVolumeSource, 'function');
  const input = resource('PersistentVolume', { spec: { nfs: { server: 'old', path: '/' }, capacity: { storage: '1Gi' }, extension: 1 } });
  const next = model.setVolumeSource(input, 'csi', 'create');
  assert.deepEqual((next.spec as any).csi, { driver: '', volumeHandle: '' });
  assert.equal((next.spec as any).nfs, undefined);
  assert.equal((next.spec as any).extension, 1);
  assert.equal(model.setVolumeSource(input, 'csi', 'edit'), input);
  assert.equal(model.updateNativeField(input, ['spec', 'nfs', 'path'], '/changed', 'edit'), input);
});

test('stable map rows retain empty and multiline values and reject duplicate keys', () => {
  assert.equal(typeof model.commitMapRows, 'function');
  const rows = [{ id: 'a', key: 'first', value: '' }, { id: 'b', key: 'second', value: 'line1\nline2' }];
  assert.deepEqual(model.commitMapRows(rows), { first: '', second: 'line1\nline2' });
  assert.throws(() => model.commitMapRows([{ ...rows[0], key: 'second' }, rows[1]]), /重复/);
  assert.throws(() => model.commitMapRows([{ id: 'x', key: '__proto__', value: 'bad' }]), /不安全/);
});

test('Secret edits preserve untouched base64 and never submit masking placeholders', () => {
  assert.equal(typeof model.updateNativeField, 'function');
  const input = resource('Secret', { data: { token: 'c2VjcmV0Cg==', untouched: 'AAEC/w==' } });
  const next = model.updateNativeField(input, ['data', 'token'], 'bmV3', 'create');
  assert.deepEqual(next.data, { token: 'bmV3', untouched: 'AAEC/w==' });
  assert.throws(() => model.updateNativeField(input, ['stringData', 'token'], '••••••（未修改）', 'create'), /占位符/);
  assert.throws(() => model.updateNativeField(input, ['data'], { token: '****' }, 'create'), /占位符/);
});

test('advanced YAML parses only on explicit apply and rejects invalid or unsafe content', () => {
  assert.equal(typeof model.parseAdvancedValue, 'function');
  assert.throws(() => model.parseAdvancedValue('rules: [', 'object'));
  assert.throws(() => model.parseAdvancedValue('__proto__: value', 'object'), /不安全/);
  assert.deepEqual(model.parseAdvancedValue('peer:\n  selector: {}', 'object'), { peer: { selector: {} } });
});

test('PV switching replaces unsupported legacy sources too, never creating two sources', () => {
  const input = resource('PersistentVolume', { spec: { awsElasticBlockStore: { volumeID: 'legacy' }, capacity: { storage: '1Gi' } } });
  const next = model.setVolumeSource(input, 'nfs', 'create');
  assert.equal((next.spec as any).awsElasticBlockStore, undefined);
  assert.deepEqual((next.spec as any).nfs, { server: '', path: '' });
  assert.deepEqual((next.spec as any).capacity, { storage: '1Gi' });
});

test('HPA changing metric and target types removes incompatible fields but preserves extensions', () => {
  const input = resource('HorizontalPodAutoscaler', { spec: { metrics: [{ type: 'Resource', extension: true, resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 80, extension: 2 } } }] } });
  const target = model.updateNativeField(input, ['spec', 'metrics', 0, 'resource', 'target', 'type'], 'AverageValue', 'edit');
  assert.deepEqual((target.spec as any).metrics[0].resource.target, { type: 'AverageValue', extension: 2 });
  const metric = model.updateNativeField(input, ['spec', 'metrics', 0, 'type'], 'External', 'edit');
  assert.deepEqual((metric.spec as any).metrics[0], { type: 'External', extension: true });
});

test('Secret ordinary text is not mistaken for a redacted marker', () => {
  const input = resource('Secret');
  assert.deepEqual(model.updateNativeField(input, ['stringData'], { token: 'R' }, 'create').stringData, { token: 'R' });
  assert.throws(() => model.updateNativeField(input, ['stringData'], { token: '[REDACTED]' }, 'create'), /占位符/);
});

test('IngressClass parameter scopes remove namespace only on explicit cluster scope', () => {
  const input = resource('IngressClass', { spec: { controller: 'example.com/controller', parameters: { apiGroup: 'example.com', kind: 'Config', name: 'config', scope: 'Namespace', namespace: 'dev', extension: true }, extension: 7 } });
  assert.equal(model.supportsNativeResourceForm('IngressClass'), true);
  const changed = model.updateNativeField(input, ['spec', 'parameters', 'scope'], 'Cluster', 'edit');
  assert.deepEqual((changed.spec as any).parameters, { apiGroup: 'example.com', kind: 'Config', name: 'config', scope: 'Cluster', extension: true });
  assert.equal((changed.spec as any).extension, 7);
  assert.equal(model.updateNativeField(input, ['spec', 'controller'], 'new', 'edit'), input);
});
