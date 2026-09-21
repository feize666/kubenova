const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { OidcIdentityRepository } = require('../dist/src/auth/oidc-identity.repository');
const { createNativeAuthenticator } = require('../dist/src/auth/native-bearer');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
const schema = `native_identity_${randomUUID().replaceAll('-', '')}`;
const admin = new PrismaClient();
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
let created = false;
let server;
(async () => {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    for (const table of ['User', 'ExternalIdentity']) {
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
    const keys = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture', alg: 'RS256' };
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const issuer = `http://127.0.0.1:${server.address().port}`;
    const config = { issuer, jwksUri: `${issuer}/jwks`, audience: 'kubectl' };
    const authenticate = await createNativeAuthenticator(config, new OidcIdentityRepository(db));
    const user = await db.user.create({ data: { email: 'fixture@invalid.test', role: 'viewer' } });
    const token = await new SignJWT({ email: user.email, role: 'admin' }).setIssuer(issuer).setAudience('kubectl')
      .setSubject('immutable-subject').setIssuedAt().setExpirationTime('5m')
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(keys.privateKey);
    await assert.rejects(authenticate(token), /Native identity unavailable/, 'email claim must not auto-bind');
    const binding = await db.externalIdentity.create({ data: { issuer, subject: 'immutable-subject', userId: user.id } });
    let actor = await authenticate(token);
    assert.equal(actor.userId, user.id);
    assert.equal(actor.authzVersion, 1);
    assert.equal(actor.role, undefined, 'token roles must not become authorization');
    await db.user.update({ where: { id: user.id }, data: { isActive: false, authzVersion: { increment: 1 } } });
    await assert.rejects(authenticate(token), /Native identity unavailable/);
    await db.user.update({ where: { id: user.id }, data: { isActive: true } });
    actor = await authenticate(token);
    assert.equal(actor.authzVersion, 2, 'must reload current authorization version');
    await db.externalIdentity.delete({ where: { id: binding.id } });
    await assert.rejects(authenticate(token), /Native identity unavailable/, 'removed identity must invalidate the same token');
    console.log('PASS signed native token + real PostgreSQL identity: explicit binding required, disable/unbind denied, authorization version refreshed');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await db.$disconnect();
    try { if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await admin.$disconnect(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
