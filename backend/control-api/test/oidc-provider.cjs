const assert = require('node:assert/strict');
const http = require('node:http');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const Redis = require('ioredis');
const { OidcProviderService } = require('../dist/src/auth/oidc-provider.service');
const { OidcFlowService } = require('../dist/src/auth/oidc-flow.service');
const { OidcTransactionStore } = require('../dist/src/auth/oidc-transaction.store');

(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  let issuer;
  let tokenRequests = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') return res.end(JSON.stringify({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'],
    }));
    if (req.url === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
    if (req.url === '/token') {
      tokenRequests++;
      let body = ''; for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      const entry = codes.get(params.get('code'));
      codes.delete(params.get('code'));
      if (!entry || params.get('client_secret') !== 'test-secret' || createHash('sha256').update(params.get('code_verifier') || '').digest('base64url') !== entry.challenge) {
        res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid_grant' }));
      }
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: entry.subject || 'subject-1', auth_time: entry.authTime, aud: entry.badAudience ? 'wrong-client' : 'console', nonce: entry.badNonce ? 'wrong-nonce' : entry.nonce, iat: now, exp: entry.expired ? now - 3600 : now + 60 })).toString('base64url');
      const input = `${header}.${payload}`;
      const signature = sign('RSA-SHA256', Buffer.from(input), entry.badSignature ? wrongKey : privateKey).toString('base64url');
      return res.end(JSON.stringify({ access_token: 'test-access', token_type: 'Bearer', id_token: `${input}.${signature}` }));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;
  const redis = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: 0, retryStrategy: () => null });
  redis.on('error', () => {});
  try {
    const store = new OidcTransactionStore(redis);
    const service = new OidcProviderService(new OidcFlowService(store), store);
    const config = { enabled: true, issuer, clientId: 'console', redirectUri: 'http://127.0.0.1:3000/auth/callback' };
    for (const scenario of ['valid', 'nonce', 'audience', 'signature', 'expired']) {
      const { url } = await service.start(config, 'test-secret', 'browser');
      const authorization = new URL(url);
      codes.set(scenario, { nonce: authorization.searchParams.get('nonce'), challenge: authorization.searchParams.get('code_challenge'), badNonce: scenario === 'nonce', badAudience: scenario === 'audience', badSignature: scenario === 'signature', expired: scenario === 'expired' });
      const callback = new URL(config.redirectUri);
      callback.search = new URLSearchParams({ code: scenario, state: authorization.searchParams.get('state') });
      if (scenario === 'valid') {
        assert.deepEqual(await service.complete(config, 'test-secret', callback, 'browser'), { issuer, subject: 'subject-1' });
      } else await assert.rejects(service.complete(config, 'test-secret', callback, 'browser'));
      await assert.rejects(service.complete(config, 'test-secret', callback, 'browser'));
    }
    console.log('PASS real openid-client discovery, PKCE, nonce, audience, signature, expiry and replay rejection');
    const changed = new URL((await service.start(config, 'test-secret', 'browser')).url);
    const callback = new URL(config.redirectUri);
    callback.search = new URLSearchParams({ code: 'config-change', state: changed.searchParams.get('state') });
    const before = tokenRequests;
    await assert.rejects(service.complete({ ...config, clientId: 'replacement-client' }, 'test-secret', callback, 'browser'));
    assert.equal(tokenRequests, before, 'client configuration change must be rejected before code redemption');
    for (const scenario of ['fresh', 'old', 'missing', 'foreign']) {
      const actor = { userId: 'test-user', sessionId: 'test-session', authzVersion: 1, subject: 'subject-1', requestedAt: Math.floor(Date.now() / 1000) };
      const authorization = new URL((await service.startReauthentication(config, 'test-secret', 'browser', actor)).url);
      assert.equal(authorization.searchParams.get('prompt'), 'login');
      assert.equal(authorization.searchParams.get('max_age'), '0');
      codes.set(scenario, { nonce: authorization.searchParams.get('nonce'), challenge: authorization.searchParams.get('code_challenge'),
        authTime: scenario === 'missing' ? undefined : actor.requestedAt - (scenario === 'old' ? 3600 : 0), subject: scenario === 'foreign' ? 'another-user' : 'subject-1' });
      const callback = new URL(config.redirectUri);
      callback.search = new URLSearchParams({ code: scenario, state: authorization.searchParams.get('state') });
      if (scenario === 'fresh') assert.deepEqual(await service.completeReauthentication(config, 'test-secret', callback, 'browser', actor), { issuer, subject: 'subject-1' });
      else await assert.rejects(service.completeReauthentication(config, 'test-secret', callback, 'browser', actor));
    }
    console.log('PASS reauthentication requires a fresh auth_time and the original subject');
    for (const scenario of ['reauth-as-login', 'login-as-reauth', 'different-session', 'different-user', 'different-version']) {
      const actor = { userId: 'test-user', sessionId: 'test-session', authzVersion: 1, subject: 'subject-1', requestedAt: Math.floor(Date.now() / 1000) };
      const start = scenario === 'login-as-reauth'
        ? await service.start(config, 'test-secret', 'browser')
        : await service.startReauthentication(config, 'test-secret', 'browser', actor);
      const authorization = new URL(start.url);
      const callback = new URL(config.redirectUri);
      callback.search = new URLSearchParams({ code: scenario, state: authorization.searchParams.get('state') });
      const before = tokenRequests;
      const changedActor = { ...actor,
        ...(scenario === 'different-session' ? { sessionId: 'another-session' } : {}),
        ...(scenario === 'different-user' ? { userId: 'another-user' } : {}),
        ...(scenario === 'different-version' ? { authzVersion: 2 } : {}),
      };
      await assert.rejects(scenario === 'reauth-as-login'
        ? service.complete(config, 'test-secret', callback, 'browser')
        : service.completeReauthentication(config, 'test-secret', callback, 'browser', changedActor));
      assert.equal(tokenRequests, before, `${scenario} must fail before contacting the token endpoint`);
      await assert.rejects(service.completeReauthentication(config, 'test-secret', callback, 'browser', actor));
      assert.equal(tokenRequests, before, 'rejected transaction cannot be replayed');
    }
    console.log('PASS purpose, user, session and authorization-version isolation before token exchange; rejected transactions consumed');
  } finally {
    redis.disconnect();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
