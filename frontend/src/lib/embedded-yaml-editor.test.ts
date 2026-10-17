import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { embeddedYamlContext } from './embedded-yaml-editor';

test('embedded editing inherits the real manifest version and locked identity',()=>{
  const result=embeddedYamlContext('apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: web, namespace: prod}',{clusterId:'cluster-a',kind:'Deployment',name:'web',namespace:'prod'});
  assert.deepEqual(result,{clusterId:'cluster-a',kind:'Deployment',apiVersion:'apps/v1',name:'web',namespace:'prod',resource:'deployments',namespaced:true});
});
test('custom cluster-scoped YAML keeps dynamic resource and never gains a namespace',()=>{
  const result=embeddedYamlContext('apiVersion: example.io/v1\nkind: Widget\nmetadata: {name: global}',{clusterId:'a',kind:'widgets',name:'global',namespace:''},{clusterId:'a',group:'example.io',version:'v1',resource:'widgets',name:'global'});
  assert.equal(result?.kind,'Widget');assert.equal(result?.resource,'widgets');assert.equal(result?.namespace,'');assert.equal(result?.namespaced,false);
});
test('invalid YAML or a different server identity cannot enable inline editing',()=>{
  const identity={clusterId:'a',kind:'Deployment',name:'web',namespace:'prod'};
  assert.equal(embeddedYamlContext('kind: [',identity),null);
  assert.equal(embeddedYamlContext('apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: other, namespace: prod}',identity),null);
});

test('cluster-scoped list YAML actions supply an empty namespace',()=>{
  for(const [file,kind] of [['../app/namespaces/page.tsx','Namespace'],['../app/storage/pv/page.tsx','PersistentVolume'],['../app/storage/sc/page.tsx','StorageClass']]) {
    const source=readFileSync(new URL(file,import.meta.url),'utf8');
    const targets=[...source.matchAll(/setYamlTarget\(\{([\s\S]*?)\}\)/g)];
    assert.ok(targets.length,`${kind} must expose a YAML target`);
    for(const target of targets)assert.match(target[1],/namespace:\s*["']{2}/,`${kind} cannot carry a namespace`);
    assert.ok(embeddedYamlContext(`apiVersion: v1\nkind: ${kind}\nmetadata: {name: test}`,{clusterId:'a',kind,name:'test',namespace:''}));
  }
});
