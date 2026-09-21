import assert from 'node:assert/strict';
import test from 'node:test';
import { getBackupStatus } from './backup';

test('backup status uses the admin-only read endpoint', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let authorization = '';
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization') ?? '';
    return new Response(JSON.stringify({ data: { configuration: { ready: false } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await getBackupStatus('session-token');
  assert.equal(requestUrl, '/api/system/backup/status');
  assert.equal(authorization, 'Bearer session-token');
});
