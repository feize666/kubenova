import assert from 'node:assert/strict';
import test from 'node:test';
import { rebaseResourceDraft } from './resource-editor';
import { createResourceDraft, parseResourceDocuments, setManifestValue, getManifestValue, resourceChanges, validateResourceDraft, resourceFingerprint, sanitizeResourceManifest, buildResourceEditorHref, safeEditorReturnTo, resourceTypeForPath } from './resource-editor';

const yaml = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n  namespace: demo\n  resourceVersion: "7"\nspec:\n  customField: keep\n  template:\n    spec:\n      containers:\n      - name: main\n        image: nginx:1\n        extra: retained\n      - name: sidecar\n        image: busybox:1\n';
test('editing nested container preserves sibling and unknown fields without mutating original', () => {
  const original = parseResourceDocuments(yaml)[0];
  const next = setManifestValue(original, ['spec','template','spec','containers',0,'image'], 'nginx:2');
  assert.equal(getManifestValue(next, ['spec','template','spec','containers',0,'image']), 'nginx:2');
  assert.equal(getManifestValue(original, ['spec','template','spec','containers',0,'image']), 'nginx:1');
  assert.equal(getManifestValue(next, ['spec','template','spec','containers',0,'extra']), 'retained');
  assert.equal(getManifestValue(next, ['spec','template','spec','containers',1,'name']), 'sidecar');
  assert.equal(getManifestValue(next, ['spec','customField']), 'keep');
  assert.throws(() => setManifestValue(original, ['__proto__','polluted'], true));
});
test('YAML supports multiple resources but rejects duplicate keys, scalars and cyclic aliases', () => {
  assert.equal(parseResourceDocuments(yaml+'---\napiVersion: v1\nkind: Namespace\nmetadata: {name: demo}').length, 2);
  assert.throws(() => parseResourceDocuments('kind: Pod\nkind: Service'));
  assert.throws(() => parseResourceDocuments('not-a-resource'));
  assert.throws(() => parseResourceDocuments('apiVersion: v1\nkind: Pod\nmetadata: &a {name: x, cycle: *a}'));
});
test('edit validation locks identity and requires original version', () => {
  const original = parseResourceDocuments(yaml)[0];
  assert.deepEqual(validateResourceDraft([original], 'edit', original), []);
  assert.ok(validateResourceDraft([setManifestValue(original,['metadata','name'],'other')], 'edit', original).some(x=>x.includes('name')));
  assert.ok(validateResourceDraft([setManifestValue(original,['metadata','resourceVersion'],'8')], 'edit', original).some(x=>x.includes('resourceVersion')));
});
test('fixed resource entry rejects other kinds in every YAML document', () => {
  const deployment = parseResourceDocuments(yaml)[0];
  const service = parseResourceDocuments('apiVersion: v1\nkind: Service\nmetadata: {name: svc, namespace: demo}')[0];
  assert.deepEqual(validateResourceDraft([deployment], 'create', undefined, 'Deployment'), []);
  assert.ok(validateResourceDraft([deployment, service], 'create', undefined, 'Deployment').some(error => error.includes('Service') && error.includes('Deployment')));
});
test('diff distinguishes removals and redacts Secret content without changing submitted draft', () => {
  const before = parseResourceDocuments('apiVersion: v1\nkind: Secret\nmetadata: {name: credentials}\ndata: {password: c2VjcmV0, token: old}')[0];
  const after = setManifestValue(setManifestValue(before,['data','password'],'bmV3'), ['data','token'], undefined);
  const diff = resourceChanges(before, after);
  assert.equal(diff.length, 2);
  assert.ok(diff.some(x=>x.operation==='remove'));
  assert.ok(!JSON.stringify(diff).includes('c2VjcmV0'));
  assert.ok(!JSON.stringify(diff).includes('bmV3'));
  assert.equal(getManifestValue(after,['data','password']), 'bmV3');
});
test('fingerprint ignores key order but detects draft edits and sanitization preserves concurrency', () => {
  assert.equal(resourceFingerprint({b:2,a:1}), resourceFingerprint({a:1,b:2}));
  assert.notEqual(resourceFingerprint({a:1}), resourceFingerprint({a:2}));
  const original = parseResourceDocuments(yaml)[0];
  const cleaned = sanitizeResourceManifest({...original,status:{ready:1},metadata:{...original.metadata,uid:'uid',managedFields:[]}}, 'edit');
  assert.equal(cleaned.metadata.resourceVersion,'7');
  assert.equal(cleaned.status,undefined);
  assert.equal(cleaned.metadata.managedFields,undefined);
  assert.equal(sanitizeResourceManifest(original,'create').metadata.resourceVersion,undefined);
});
test('editor links preserve scope and reject external return URLs', () => {
  const url = buildResourceEditorHref({clusterId:'c1',kind:'Service',name:'svc',namespace:'team',mode:'yaml',returnTo:'/clusters/c1/network/services?namespace=team'});
  assert.ok(url.startsWith('/clusters/c1/resources/editor?'));
  assert.equal(new URL(url,'http://local').searchParams.get('name'),'svc');
  assert.equal(safeEditorReturnTo('//evil.example'),'/clusters');
  assert.equal(safeEditorReturnTo('/clusters/c1/network/services?namespace=team'),'/clusters/c1/network/services?namespace=team');
});
test('rebasing preserves server-side changes and refuses overlapping edits', () => {
  const original = parseResourceDocuments(yaml)[0];
  const draft = setManifestValue(original,['spec','replicas'],3);
  const latest = setManifestValue(setManifestValue(original,['metadata','resourceVersion'],'8'),['spec','customField'],'server-change');
  const result = rebaseResourceDraft(original,draft,latest);
  assert.deepEqual(result.conflicts,[]);
  assert.equal(getManifestValue(result.draft,['spec','customField']),'server-change');
  assert.equal(getManifestValue(result.draft,['spec','replicas']),3);
  assert.equal(result.draft.metadata.resourceVersion,'8');
  const conflict = rebaseResourceDraft(original,draft,setManifestValue(latest,['spec','replicas'],5));
  assert.deepEqual(conflict.conflicts,['spec.replicas']);
});
test('malformed identity fields produce validation messages rather than crashing the editor', () => {
  const invalid = parseResourceDocuments('apiVersion: v1\nkind: Service\nmetadata: {name: 5, namespace: false}')[0];
  assert.ok(validateResourceDraft([invalid], 'create').some(error=>error.includes('metadata.name')));
  assert.ok(validateResourceDraft([invalid], 'create').some(error=>error.includes('metadata.namespace')));
});
test('discovered cluster-scoped custom resources never acquire a namespace', () => {
  const clusterResource = createResourceDraft('ClusterPolicy', 'team', 'example.io/v1', false);
  assert.equal(clusterResource.metadata.namespace, undefined);
  assert.equal(createResourceDraft('TeamPolicy', 'team', 'example.io/v1', true).metadata.namespace, 'team');
});
test('resource list paths resolve to the unified editor type', () => {
  assert.equal(resourceTypeForPath('/configs/configmaps')?.kind, 'ConfigMap');
  assert.equal(resourceTypeForPath('/clusters/c1/network/services')?.kind, 'Service');
  assert.equal(resourceTypeForPath('/workloads/deployments')?.kind, 'Deployment');
  assert.equal(resourceTypeForPath('/clusters/c1/storage/pv')?.namespaced, false);
});
