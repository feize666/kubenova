const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { UsersService } = require('../dist/src/users/users.service');
const { AuthorizationService } = require('../dist/src/common/authorization.service');
const { AuthRepository } = require('../dist/src/auth/auth.repository');
const { AuthService } = require('../dist/src/auth/auth.service');
const { TokenService } = require('../dist/src/auth/token.service');
const { OidcIdentityRepository } = require('../dist/src/auth/oidc-identity.repository');
const { ConfigService } = require('@nestjs/config');
const { RuntimeRepository } = require('../dist/src/runtime/runtime.repository');
const { RuntimeSessionService } = require('../dist/src/runtime/runtime-session.service');
const { ClusterAccessService } = require('../dist/src/common/cluster-access.service');

// All fixtures live inside transactions that deliberately roll back.
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('This test requires an explicit loopback DATABASE_URL');
}
const db = new PrismaClient();
const resolver = { resolve: async () => 'integration-namespace-uid' };
const rollback = new Error('EXPECTED_TEST_ROLLBACK');

async function fixtures(tx, prefix) {
  const admin = await tx.user.create({ data: { email: `${prefix}-admin@test.invalid`, role: 'admin' } });
  const user = await tx.user.create({ data: { email: `${prefix}-member@test.invalid` } });
  const cluster = await tx.clusterRegistry.create({ data: { name: prefix, apiServer: 'https://invalid.test' } });
  return { admin, user, cluster };
}

async function successfulLifecycle() {
  const prefix = `authz-${randomUUID()}`;
  await assert.rejects(db.$transaction(async tx => {
    const { admin, user, cluster } = await fixtures(tx, prefix);
    const bound = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => fn(tx) : target[key] });
    const service = new UsersService(bound, resolver);
    const sessions = new AuthRepository(bound);
    const originalSession = await sessions.createSession({ userId: user.id, authzVersion: 1, refreshTokenHash: prefix, expiresAt: new Date(Date.now() + 60000), refreshExpiresAt: new Date(Date.now() + 120000) });
    const actor = { id: admin.id, role: 'admin' };
    const directory = await service.listUsers({ keyword: prefix }, actor);
    assert.equal(directory.total, 2);
    assert.deepEqual(directory.items.map(item => item.id).sort(), [admin.id, user.id].sort());
    const detail = await service.findById(user.id, actor);
    assert.equal(detail.id, user.id);
    for (const item of [...directory.items, detail]) {
      assert.equal(Object.hasOwn(item, 'passwordHash'), false);
      assert.equal(Object.hasOwn(item, 'externalIdentities'), false);
      assert.equal(Object.hasOwn(item, 'sessions'), false);
    }
    await assert.rejects(service.listUsers({}, { id: user.id, role: 'user' }), error => error.getStatus?.() === 403);
    await assert.rejects(service.findById(admin.id, { id: user.id, role: 'user' }), error => error.getStatus?.() === 403);
    const group = await service.createIdentityGroup(actor, { name: prefix });
    await service.setGroupMembership(actor, group.id, user.id, true);
    const grant = await service.createAccessGrant(actor, { groupId: group.id, clusterId: cluster.id, role: 'viewer', namespaces: ['test'], capabilities: ['logs'] });
    const evaluator = new AuthorizationService(tx);
    const request = { userId: user.id, clusterId: cluster.id, namespaceUid: 'integration-namespace-uid', capability: 'logs' };
    assert.equal((await evaluator.authorize(request)).allowed, true);
    assert.equal((await service.listAccessGrants(cluster.id, actor)).items[0].principal.type, 'group');
    await service.revokeAccessGrant(actor, grant.id);
    assert.equal((await evaluator.authorize(request)).allowed, false);
    assert.equal((await tx.user.findUnique({ where: { id: user.id } })).authzVersion, 4);
    const rotateInput = { sessionId: originalSession.id, userId: user.id, authzVersion: 1, currentRefreshTokenHash: prefix, nextRefreshTokenHash: `${prefix}-rotated`, expiresAt: new Date(Date.now() + 60000), refreshExpiresAt: originalSession.refreshExpiresAt };
    assert.equal(await sessions.rotateSession(rotateInput), null);
    const freshSession = await sessions.createSession({ userId: user.id, authzVersion: 4, refreshTokenHash: `${prefix}-fresh`, expiresAt: new Date(Date.now() + 60000), refreshExpiresAt: originalSession.refreshExpiresAt });
    const refreshed = await sessions.rotateSession({ ...rotateInput, sessionId: freshSession.id, authzVersion: 4, currentRefreshTokenHash: `${prefix}-fresh` });
    assert.equal(refreshed.authzVersion, 4);
    assert.equal(await sessions.rotateSession({ ...rotateInput, sessionId: freshSession.id, authzVersion: 4, currentRefreshTokenHash: `${prefix}-fresh` }), null);
    assert.equal(await tx.authorizationChange.count({ where: { actorUserId: admin.id } }), 4);
    await service.setGroupMembership(actor, group.id, user.id, false);
    assert.equal((await service.listGroupMembers(actor, group.id)).items[0].state, 'disabled');
    throw rollback;
  }, { timeout: 20000 }), error => error === rollback);
  assert.equal(await db.user.count({ where: { email: { startsWith: prefix } } }), 0);
  console.log('PASS lifecycle, inherited access, revocation, audit and fixture rollback');
}

async function auditFailureRollback() {
  const prefix = `authz-${randomUUID()}`;
  const failure = new Error('INJECTED_AUDIT_FAILURE');
  let ids;
  await assert.rejects(db.$transaction(async tx => {
    ids = await fixtures(tx, prefix);
    const failingTx = new Proxy(tx, { get: (inner, prop) => prop === 'authorizationChange' ? { create: async () => { throw failure; } } : inner[prop] });
    const scopedService = new UsersService(new Proxy(failingTx, { get: (inner, prop) => prop === '$transaction' ? async nested => nested(failingTx) : inner[prop] }), resolver);
    return scopedService.createAccessGrant({ id: ids.admin.id, role: 'admin' }, { userId: ids.user.id, clusterId: ids.cluster.id, role: 'viewer', namespaces: ['test'], capabilities: [] });
  }, { timeout: 20000 }), error => error === failure);
  assert.equal(await db.accessGrant.count({ where: { clusterId: ids.cluster.id } }), 0);
  assert.equal(await db.user.count({ where: { email: { startsWith: prefix } } }), 0);
  assert.equal(await db.authorizationChange.count({ where: { actorUserId: ids.admin.id } }), 0);
  console.log('PASS injected audit failure rolls back grant, version and fixtures');
}

async function deletedClusterRejected() {
  const prefix = `authz-${randomUUID()}`;
  await assert.rejects(db.$transaction(async tx => {
    const { admin, user, cluster } = await fixtures(tx, prefix);
    await tx.clusterRegistry.update({ where: { id: cluster.id }, data: { deletedAt: new Date() } });
    const bound = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => fn(tx) : target[key] });
    const service = new UsersService(bound, resolver);
    await assert.rejects(service.createAccessGrant({ id: admin.id, role: 'admin' }, {
      userId: user.id, clusterId: cluster.id, role: 'viewer', namespaces: ['test'], capabilities: [],
    }), error => error.getStatus?.() === 400);
    assert.equal(await tx.accessGrant.count({ where: { clusterId: cluster.id } }), 0);
    assert.equal((await tx.user.findUnique({ where: { id: user.id } })).authzVersion, 1);
    assert.equal(await tx.authorizationChange.count({ where: { actorUserId: admin.id } }), 0);
    throw rollback;
  }), error => error === rollback);
  assert.equal(await db.user.count({ where: { email: { startsWith: prefix } } }), 0);
  console.log('PASS deleted cluster cannot receive grants or invalidate sessions');
}

async function externalIdentitySession() {
  const prefix = `authz-${randomUUID()}`;
  await assert.rejects(db.$transaction(async tx => {
    const { user } = await fixtures(tx, prefix);
    const issuer = `https://${prefix}.test.invalid`;
    await tx.externalIdentity.create({ data: { issuer, subject: 'external-user', userId: user.id } });
    const bound = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => fn(tx) : target[key] });
    const service = new AuthService(new AuthRepository(bound), new TokenService(new ConfigService()), new OidcIdentityRepository(tx));
    await assert.rejects(service.loginExternal(`${issuer}/other`, 'external-user'));
    assert.equal(await tx.session.count({ where: { userId: user.id } }), 0);
    const session = await service.loginExternal(issuer, 'external-user');
    assert.equal(session.user.id, user.id);
    assert.equal(session.user.role, 'user');
    assert.equal((await service.validate(session.token)).user.id, user.id);
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    assert.equal(await service.validate(session.token), null);
    assert.equal(await service.refresh(session.refreshToken), null);
    assert.equal(await service.loginExternal(issuer, 'external-user'), null);
    assert.equal(await tx.session.count({ where: { userId: user.id } }), 1);
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false } });
    await tx.user.update({ where: { id: user.id }, data: { authzVersion: { increment: 1 } } });
    assert.equal(await service.validate(session.token), null);
    assert.equal(await service.refresh(session.refreshToken), null);
    await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
    await assert.rejects(service.loginExternal(issuer, 'external-user'));
    assert.equal(await tx.session.count({ where: { userId: user.id } }), 1);
    throw rollback;
  }), error => error === rollback);
  assert.equal(await db.user.count({ where: { email: { startsWith: prefix } } }), 0);
  console.log('PASS external identity binding, session issuance, version revocation and disabled-user rejection');
}

async function userSecurityChanges() {
  const prefix = `authz-${randomUUID()}`;
  await assert.rejects(db.$transaction(async tx => {
    const { admin, user } = await fixtures(tx, prefix);
    const bound = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => fn(tx) : target[key] });
    const users = new UsersService(bound, resolver);
    const auth = new AuthService(new AuthRepository(bound), new TokenService(new ConfigService()), new OidcIdentityRepository(tx));
    const issuer = `https://${prefix}.test.invalid`;
    await tx.externalIdentity.create({ data: { issuer, subject: 'member', userId: user.id } });
    const actor = { id: admin.id, role: 'admin' };
    const before = await tx.user.findUnique({ where: { id: user.id } });
    await assert.rejects(users.updateUser(actor, user.id, { role: 'admin' }), error => error.getStatus?.() === 400);
    const after = await tx.user.findUnique({ where: { id: user.id } });
    assert.equal(after.role, before.role, 'profile editing must not elevate platform privileges');
    assert.equal(after.authzVersion, before.authzVersion, 'rejected edit must not mutate authorization state');
    for (const change of [
      () => users.updateUser(actor, user.id, { password: 'test-only-password' }),
      () => users.updateUser(actor, user.id, { username: `${prefix}-renamed` }),
      async () => { await users.setState(actor, user.id, false); await users.setState(actor, user.id, true); },
    ]) {
      const session = await auth.loginExternal(issuer, 'member');
      await change();
      assert.equal(await auth.validate(session.token), null);
      assert.equal(await auth.refresh(session.refreshToken), null);
    }
    throw rollback;
  }), error => error === rollback);
  console.log('PASS profile role elevation rejected; password, username and disable/re-enable invalidate old sessions');
}

async function identityAdministration() {
  const prefix = `identity-admin-${randomUUID()}`;
  await assert.rejects(db.$transaction(async tx => {
    const { admin, user } = await fixtures(tx, prefix);
    const bound = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => {
      await tx.$executeRawUnsafe('SAVEPOINT identity_operation');
      try {
        const result = await fn(tx);
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT identity_operation');
        return result;
      } catch (error) {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT identity_operation');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT identity_operation');
        throw error;
      }
    } : target[key] });
    const users = new UsersService(bound);
    const actor = { id: admin.id, role: 'admin' };
    const input = { issuer: 'https://identity.test/realms/console', subject: prefix };
    await assert.rejects(users.bindExternalIdentity({ id: user.id, role: 'user' }, user.id, input), e => e.getStatus?.() === 403);
    for (const invalid of [null, {}, { ...input, subject: '' }, { ...input, issuer: 'http://remote.test' }, { ...input, issuer: 'https://identity.test/?secret=x' }]) {
      await assert.rejects(users.bindExternalIdentity(actor, user.id, invalid), e => e.getStatus?.() === 400);
    }
    const identity = await users.bindExternalIdentity(actor, user.id, input);
    assert.equal((await new OidcIdentityRepository(tx).resolve(input.issuer, input.subject)).id, user.id);
    assert.equal((await users.listExternalIdentities(actor, user.id)).items[0].id, identity.id);
    assert.equal((await tx.user.findUnique({ where: { id: user.id } })).authzVersion, 2);
    await assert.rejects(users.bindExternalIdentity(actor, admin.id, input), e => e.getStatus?.() === 409);
    assert.equal((await tx.user.findUnique({ where: { id: admin.id } })).authzVersion, 1);
    await assert.rejects(users.listExternalIdentities({ role: 'user' }, user.id), e => e.getStatus?.() === 403);
    await assert.rejects(users.unbindExternalIdentity(actor, admin.id, identity.id), e => e.getStatus?.() === 404);
    assert.equal((await tx.user.findUnique({ where: { id: admin.id } })).authzVersion, 1);
    await users.unbindExternalIdentity(actor, user.id, identity.id);
    await assert.rejects(new OidcIdentityRepository(tx).resolve(input.issuer, input.subject), e => e.getStatus?.() === 401);
    assert.equal((await tx.user.findUnique({ where: { id: user.id } })).authzVersion, 3);
    assert.equal(await tx.authorizationChange.count({ where: { affectedUserId: user.id } }), 2);
    throw rollback;
  }), e => e === rollback);
  console.log('PASS administrator identity binding, scoped removal, version invalidation and durable audit');
}

async function revokedIdentityDuringSessionCreation() {
  const prefix = `identity-race-${randomUUID()}`;
  await assert.rejects(db.$transaction(async tx => {
    const { admin, user } = await fixtures(tx, prefix);
    const bound = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => fn(tx) : target[key] });
    const users = new UsersService(bound);
    const actor = { id: admin.id, role: 'admin' };
    const identity = { issuer: 'https://identity.test/realms/race', subject: prefix };
    const binding = await users.bindExternalIdentity(actor, user.id, identity);
    const repository = new AuthRepository(bound);
    const originalCreate = repository.createSession.bind(repository);
    // Interleave revocation after identity resolution but before the session insert.
    repository.createSession = async input => {
      await users.unbindExternalIdentity(actor, user.id, binding.id);
      return originalCreate(input);
    };
    const auth = new AuthService(repository, new TokenService(new ConfigService()), new OidcIdentityRepository(tx));
    const session = await auth.loginExternal(identity.issuer, identity.subject);
    assert.equal(await auth.validate(session.token), null);
    assert.equal(await auth.refresh(session.refreshToken), null);
    assert.equal(await tx.session.count({ where: { userId: user.id } }), 1);
    await assert.rejects(auth.loginExternal(identity.issuer, identity.subject));
    throw rollback;
  }), error => error === rollback);
  assert.equal(await db.user.count({ where: { email: { startsWith: prefix } } }), 0);
  console.log('PASS revocation between identity resolution and session creation cannot restore access');
}

async function disabledRuntimeOwner() {
  const prefix = `runtime-owner-${randomUUID()}`;
  await assert.rejects(db.$transaction(async tx => {
    const { user, cluster } = await fixtures(tx, prefix);
    const repository = new RuntimeRepository(tx);
    const input = { id: randomUUID(), userId: user.id, authzVersion: user.authzVersion, clusterId: cluster.id, type: 'logs', namespace: 'default', pod: 'fixture', container: 'app', expiresAt: new Date(Date.now() + 60000) };
    const session = await repository.createSession(input);
    assert.equal((await repository.findSessionById(session.id)).id, session.id);
    await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
    assert.equal(await repository.findSessionById(session.id), null);
    await tx.user.update({ where: { id: user.id }, data: { isActive: true, authzVersion: { increment: 1 } } });
    assert.equal(await repository.findSessionById(session.id), null, 're-enabling cannot restore an old runtime session');
    await assert.rejects(repository.createSession({ ...input, id: randomUUID() }), error => error.getStatus?.() === 403);
    throw rollback;
  }), error => error === rollback);
  console.log('PASS disabled runtime owner cannot bootstrap an existing session');
}

async function runtimeGrantExpiry() {
  const prefix = `runtime-expiry-${randomUUID()}`;
  await assert.rejects(db.$transaction(async tx => {
    const { admin, user, cluster } = await fixtures(tx, prefix);
    const bound = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => fn(tx) : target[key] });
    const users = new UsersService(bound, resolver);
    const actor = { id: admin.id, role: 'admin' };
    const group = await users.createIdentityGroup(actor, { name: prefix });
    await users.setGroupMembership(actor, group.id, user.id, true);
    const grant = await users.createAccessGrant(actor, { groupId: group.id, clusterId: cluster.id, role: 'viewer', namespaces: ['test'], capabilities: ['exec'] });
    const version = (await tx.user.findUnique({ where: { id: user.id } })).authzVersion;
    const repository = new RuntimeRepository(tx);
    const sessions = new RuntimeSessionService(repository, new ClusterAccessService(tx), new AuthorizationService(tx), resolver);
    const payload = { sessionId: randomUUID(), userId: user.id, type: 'terminal', clusterId: cluster.id, namespace: 'test', pod: 'fixture', container: 'app', path: '/ws/terminal', exp: Math.floor(Date.now() / 1000) + 600 };
    await repository.createSession({ ...payload, id: payload.sessionId, authzVersion: version, expiresAt: new Date(payload.exp * 1000) });
    const input = { sessionId: payload.sessionId, runtimeToken: sessions.createRuntimeToken(payload), expectedPath: payload.path };
    assert.ok((await sessions.validateSessionTokenDetailed(input)).payload);
    await tx.groupMembership.updateMany({ where: { groupId: group.id, userId: user.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal((await sessions.validateSessionTokenDetailed(input)).payload, null, 'group membership expiry must stop existing runtime access');
    await tx.groupMembership.updateMany({ where: { groupId: group.id, userId: user.id }, data: { expiresAt: null } });
    assert.ok((await sessions.validateSessionTokenDetailed(input)).payload);
    await tx.accessGrant.update({ where: { id: grant.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal((await sessions.validateSessionTokenDetailed(input)).payload, null, 'grant expiry must stop existing runtime access');
    assert.equal((await tx.user.findUnique({ where: { id: user.id } })).authzVersion, version, 'expiry test must not depend on version invalidation');
    throw rollback;
  }, { timeout: 20000 }), error => error === rollback);
  assert.equal(await db.user.count({ where: { email: { startsWith: prefix } } }), 0);
  console.log('PASS runtime group/grant expiry invalidates signed sessions without version changes; fixtures rolled back');
}

(async () => {
  try { await runtimeGrantExpiry(); await disabledRuntimeOwner(); await revokedIdentityDuringSessionCreation(); await identityAdministration(); await successfulLifecycle(); await auditFailureRollback(); await deletedClusterRejected(); await externalIdentitySession(); await userSecurityChanges(); }
  finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
