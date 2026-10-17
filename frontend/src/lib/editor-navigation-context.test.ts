import test from 'node:test';
import assert from 'node:assert/strict';
import { editorNavigationContext } from './editor-navigation-context';
test('editor return context uses live URL after native detail parameters were cleared',()=>{
  const result=editorNavigationContext('/pods','detailKind=Pod&detailId=old','http://localhost:3000/pods?namespace=prod');
  assert.equal(result.returnTo,'/pods?namespace=prod');
  assert.equal(result.params.get('detailId'),null);
  assert.equal(result.params.get('namespace'),'prod');
});
test('server fallback keeps original filters; browser URL must match current path',()=>{
  assert.equal(editorNavigationContext('/pods','filter=ready').returnTo,'/pods?filter=ready');
  assert.equal(editorNavigationContext('/pods','filter=ready','http://localhost:3000/login').returnTo,'/pods?filter=ready');
});
