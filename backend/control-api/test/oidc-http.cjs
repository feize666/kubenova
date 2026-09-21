const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const request = require('supertest');
const { OidcController } = require('../dist/src/auth/oidc.controller');
const { OidcProviderService } = require('../dist/src/auth/oidc-provider.service');
const { AuthService } = require('../dist/src/auth/auth.service');

(async () => {
  let enabled = false;
  let starts = 0;
  let issued = 0;
  let expectedBinding;
  const module = await Test.createTestingModule({
    controllers: [OidcController],
    providers: [
      { provide: ConfigService, useValue: { get: key => ({ oidcEnabled: enabled, oidcIssuer: 'https://issuer.test', oidcClientId: 'console', oidcRedirectUri: 'https://console.test/api/auth/oidc/callback' })[key] } },
      { provide: OidcProviderService, useValue: {
        start: async (_settings, _secret, binding) => { starts++; expectedBinding = binding; return { url: 'https://issuer.test/authorize' }; },
        complete: async (_settings, _secret, callback, binding) => {
          assert.equal(binding, expectedBinding);
          assert.equal(callback.origin, 'https://console.test');
          return { issuer: 'https://issuer.test', subject: 'bound-user' };
        },
      } },
      { provide: AuthService, useValue: { loginExternal: async () => { issued++; return { token: 'test-access', refreshToken: 'test-refresh', expiresAt: 'test-expiry', user: { id: 'local-user' } }; } } },
    ],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  try {
    await request(app.getHttpServer()).get('/api/auth/oidc/start').expect(404);
    assert.equal(starts, 0);
    enabled = true;
    const start = await request(app.getHttpServer()).get('/api/auth/oidc/start').expect(302);
    assert.equal(start.headers.location, 'https://issuer.test/authorize');
    assert.equal(start.headers['cache-control'], 'no-store');
    const cookie = start.headers['set-cookie'][0];
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api;', 'Max-Age=300']) assert.ok(cookie.includes(attribute));
    await request(app.getHttpServer()).get('/api/auth/oidc/callback?code=code&state=state').expect(401);
    assert.equal(issued, 0);
    const result = await request(app.getHttpServer()).get('/api/auth/oidc/callback?code=code&state=state').set('Cookie', cookie.split(';')[0]).set('Host', 'untrusted-host.test').expect(200);
    assert.equal(result.body.user.id, 'local-user');
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['referrer-policy'], 'no-referrer');
    assert.ok(result.headers['set-cookie'][0].includes('Expires=Thu, 01 Jan 1970'));
    assert.equal(issued, 1);
    const versioned = await request(app.getHttpServer()).post('/api/v1/auth/oidc/exchange')
      .set('Origin', 'https://console.test').set('Cookie', cookie.split(';')[0])
      .send({ callbackUrl: 'https://console.test/api/auth/oidc/callback?code=code&state=state' }).expect(200);
    assert.equal(versioned.body.user.id, 'local-user');
    await request(app.getHttpServer()).post('/api/v1/auth/oidc/exchange')
      .set('Origin', 'https://attacker.test').set('Cookie', cookie.split(';')[0])
      .send({ callbackUrl: 'https://console.test/api/auth/oidc/callback?code=code&state=state' }).expect(401);
    assert.equal(issued, 2);
    console.log('PASS HTTP disabled gate, redirect, binding cookie, missing-binding rejection and non-cacheable callback');
  } finally { await app.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
