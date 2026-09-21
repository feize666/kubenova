const assert = require('node:assert/strict');
const http = require('node:http');
const { createNativeBearerVerifier } = require('../dist/src/auth/native-bearer');

(async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const keys = await generateKeyPair('RS256');
  const wrong = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' };
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const issuer = `http://127.0.0.1:${server.address().port}`;
    const config = { issuer, audience: 'kubenova-kubectl', jwksUri: `${issuer}/jwks` };
    const verifyNativeBearer = await createNativeBearerVerifier(config);
    const now = Math.floor(Date.now() / 1000);
    const sign = (patch = {}, key = keys.privateKey) => new SignJWT({ iss: issuer, aud: config.audience,
      sub: 'immutable-subject', iat: now, exp: now + 300, ...patch })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(key);
    assert.deepEqual(await verifyNativeBearer(await sign()), { issuer, subject: 'immutable-subject', expiresAt: new Date((now + 300) * 1000) });
    for (const patch of [{ iss: 'https://other.test' }, { aud: 'console' }, { exp: now - 1 },
      { sub: '' }, { sub: undefined }, { exp: undefined }, { exp: 1e99 }, { iat: now + 60 }, { nbf: now + 60 },
      { aud: [config.audience, 'other'] }, { azp: 'console' }]) {
      await assert.rejects(verifyNativeBearer(await sign(patch)), /Native identity unavailable/);
    }
    await assert.rejects(verifyNativeBearer(await sign({}, wrong.privateKey)), /Native identity unavailable/);
    await assert.rejects(verifyNativeBearer('not.a.jwt'), /Native identity unavailable/);
    assert.ok(requests > 0, 'actual JWKS fetch required');
    console.log('PASS native bearer: signed token and real JWKS accepted; wrong identity/audience/key, expired/missing claims and malformed token denied');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
