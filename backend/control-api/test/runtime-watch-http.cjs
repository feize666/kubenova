const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { ForbiddenException } = require('@nestjs/common');
const { RuntimeInternalController } = require('../dist/src/runtime/runtime-internal.controller');
const { RuntimeService } = require('../dist/src/runtime/runtime.service');
(async () => {
  const controller = new AbortController();
  const module = await Test.createTestingModule({ controllers: [RuntimeInternalController], providers: [{ provide: RuntimeService, useValue: {
    watchGatewaySession: async input => {
      assert.equal(input.sessionId, 'fixture'); assert.equal(input.runtimeToken, 'fixture');
      if (input.internalSecret !== 'fixture') throw new ForbiddenException();
      return { signal: controller.signal, close: () => controller.abort() };
    },
  } }] }).compile();
  const app = module.createNestApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/api/runtime/internal/sessions/fixture/watch`;
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runtimeToken: 'fixture', path: '/ws/terminal' }), signal: AbortSignal.timeout(5000) };
    const denied = await fetch(url, options); assert.equal(denied.status, 403);
    const response = await fetch(url, { ...options, headers: { ...options.headers, 'x-runtime-gateway-secret': 'fixture' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /"active":true/);
    controller.abort();
    assert.equal((await reader.read()).done, true, 'invalidation must close the actual HTTP stream');
    console.log('PASS actual Nest HTTP watch: ready frame, no-store, service rejection and invalidation EOF; authorization service doubled');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
