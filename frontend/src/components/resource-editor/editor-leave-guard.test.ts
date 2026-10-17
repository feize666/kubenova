import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorLeaveGuard, editorInternalLink } from './editor-leave-guard';

test('cancel keeps the draft; repeated requests and repeated acceptance navigate only once', () => {
  let accept = () => {}; let cancel = () => {}; let prompts = 0; let navigations = 0;
  const request = createEditorLeaveGuard(() => ({dirty:true,busy:false,saved:false}), (yes,no) => {accept=yes;cancel=no;prompts++;});
  request(() => navigations++); request(() => navigations++);
  assert.equal(prompts,1); assert.equal(navigations,0);
  cancel(); assert.equal(navigations,0);
  request(() => navigations++); accept(); accept(); request(() => navigations++);
  assert.equal(navigations,1); assert.equal(prompts,2);
});

test('busy blocks leaving even after a prompt opens; saved and clean drafts do not prompt', () => {
  const state = {dirty:true,busy:true,saved:false}; let accept = () => {}; let prompts = 0; let navigations = 0;
  const request = createEditorLeaveGuard(() => state,(yes) => {accept=yes;prompts++;});
  request(() => navigations++); assert.equal(prompts,0); assert.equal(navigations,0);
  state.busy=false; request(() => navigations++); state.busy=true; accept(); assert.equal(navigations,0);
  state.busy=false; state.saved=true; request(() => navigations++);
  assert.equal(prompts,1); assert.equal(navigations,1);
  let cleanNavigations = 0;
  createEditorLeaveGuard(() => ({dirty:false,busy:false,saved:false}),() => assert.fail('clean draft prompted'))(() => cleanNavigations++);
  assert.equal(cleanNavigations,1);
});

test('callbacks from a canceled prompt cannot reopen or settle a newer confirmation', () => {
  const callbacks: Array<{accept:()=>void;cancel:()=>void}> = []; let navigations = 0;
  const request = createEditorLeaveGuard(() => ({dirty:true,busy:false,saved:false}),(accept,cancel) => callbacks.push({accept,cancel}));
  request(() => navigations++); callbacks[0].cancel();
  request(() => navigations++); callbacks[0].accept(); callbacks[0].cancel();
  request(() => navigations++);
  assert.equal(callbacks.length,2); assert.equal(navigations,0);
  callbacks[1].accept(); assert.equal(navigations,1);
});

test('same-origin navigation preserves the exact href including query and hash', () => {
  const current = 'https://console.example/resources/edit?clusterId=c1';
  for (const href of ['/resources?clusterId=c2&name=a%2Fb#details','../workloads?kind=Pod','https://console.example/workloads?x=1']) {
    assert.equal(editorInternalLink({href,button:0},current),href);
  }
});

test('modified clicks, other targets, downloads, external URLs and local hashes are not rerouted', () => {
  const current = 'https://console.example/resources/edit?clusterId=c1';
  const base = {href:'/workloads?kind=Pod',button:0};
  for (const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true},{download:true},{target:'_blank'},{target:'named-frame'}]) {
    assert.equal(editorInternalLink({...base,...extra},current),null);
  }
  for (const href of ['#section','https://elsewhere.example/a','mailto:admin@example.com','javascript:alert(1)','/resources/edit?clusterId=c1#section']) {
    assert.equal(editorInternalLink({href,button:0},current),null);
  }
});
