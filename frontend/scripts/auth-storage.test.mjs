import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the existing persistence functions without issuing real credentials.
const source = readFileSync(new URL('../src/components/auth-context.tsx', import.meta.url), 'utf8');
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const window = { localStorage: storage(), sessionStorage: storage() };
const context = createContext({ window, exports: {}, require: () => ({ createContext: () => null }), Date, navigator: {} });
runInContext(ts.transpileModule(source + '\nexports.check = { persistAuth, readAuthSnapshot, clearPersistedAuth, isExpiringSoon };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, context);
const auth = context.exports.check;
test('remembered refresh persists while session-only login stays out of local storage', () => {
  const snapshot = { accessToken: 'test-access', refreshToken: 'test-refresh', username: 'test', role: 'user', expiresAt: new Date(Date.now() + 600_000).toISOString() };
  auth.persistAuth(snapshot, true);
  assert.equal(window.localStorage.getItem('aiops_auth_refresh'), 'test-refresh');
  auth.persistAuth({ ...snapshot, refreshToken: 'rotated-refresh' }, true);
  assert.equal(auth.readAuthSnapshot().refreshToken, 'rotated-refresh');
  auth.persistAuth(snapshot, false);
  assert.equal(window.localStorage.getItem('aiops_auth_access'), null);
  assert.equal(window.sessionStorage.getItem('aiops_auth_session_refresh'), 'test-refresh');
  assert.equal(auth.isExpiringSoon(new Date(Date.now() - 1000).toISOString()), true);
  auth.clearPersistedAuth();
  assert.equal(auth.readAuthSnapshot(), null);
});
