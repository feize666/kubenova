import test from 'node:test';
import assert from 'node:assert/strict';
import { drawerWrapperWidth } from './drawer-width';
test('fullscreen fills viewport and resource mode returns to its original width',()=>{
  assert.equal(drawerWrapperWidth('resource',960,true),'100vw');
  assert.equal(drawerWrapperWidth('resource',1120,false),'min(100vw, 1120px)');
});
test('existing inspector and constrained drawer sizes remain intact',()=>{
  assert.equal(drawerWrapperWidth('inspector',800,false),'min(100vw, clamp(384px, 32vw, 460px))');
  assert.equal(drawerWrapperWidth('detail',960,false),'min(100vw, 960px, max(50vw, 720px))');
});
