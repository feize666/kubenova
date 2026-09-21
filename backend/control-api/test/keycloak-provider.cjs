const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { mkdir, writeFile, unlink } = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const Redis = require('ioredis');
const { chromium } = require('../../../frontend/node_modules/playwright');
const { OidcProviderService } = require('../dist/src/auth/oidc-provider.service');
const { OidcFlowService } = require('../dist/src/auth/oidc-flow.service');
const { OidcTransactionStore } = require('../dist/src/auth/oidc-transaction.store');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { UsersService } = require('../dist/src/users/users.service');
const { AuthService } = require('../dist/src/auth/auth.service');
const { AuthRepository } = require('../dist/src/auth/auth.repository');
const { TokenService } = require('../dist/src/auth/token.service');
const { OidcIdentityRepository } = require('../dist/src/auth/oidc-identity.repository');

(async () => {
  assert.ok(process.env.KEYCLOAK_HOME, 'Set KEYCLOAK_HOME to a verified local distribution');
  assert.ok(process.env.JAVA_HOME, 'Set JAVA_HOME to Java 21');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL || 'postgresql://invalid').hostname), 'Use an explicit loopback test database');
  const realm = `kubenova-test-${randomUUID()}`;
  const subject = randomUUID();
  const password = randomBytes(24).toString('base64url');
  const secret = randomBytes(24).toString('base64url');
  const origin = 'http://127.0.0.1:18080';
  const issuer = `${origin}/realms/${realm}`;
  const redirectUri = 'http://127.0.0.1:3000/login/oidc';
  const directory = path.join(process.env.KEYCLOAK_HOME, 'data/import');
  const file = path.join(directory, `${realm}-realm.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({
    realm, enabled: true, sslRequired: 'none', registrationAllowed: false,
    clients: [{ clientId: 'console-test', enabled: true, protocol: 'openid-connect', publicClient: false,
      secret, standardFlowEnabled: true, directAccessGrantsEnabled: false,
      redirectUris: [redirectUri], attributes: { 'pkce.code.challenge.method': 'S256' } }],
    users: [{ id: subject, username: 'integration-user', enabled: true, emailVerified: true,
      email: 'integration-user@example.invalid', firstName: 'Integration', lastName: 'User',
      credentials: [{ type: 'password', value: password, temporary: false }] }],
  }), { mode: 0o600, flag: 'wx' });
  let browser;
  let page;
  let redis;
  const server = spawn(path.join(process.env.KEYCLOAK_HOME, 'bin/kc.sh'), [
    'start-dev', '--db=dev-mem', '--http-host=127.0.0.1', '--http-port=18080', '--import-realm',
  ], { env: { ...process.env, JAVA_OPTS_APPEND: '-Xms128m -Xmx768m' }, stdio: 'ignore' });
  const exited = once(server, 'exit');
  try {
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (server.exitCode !== null) throw new Error('Keycloak exited before readiness');
      try {
        const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'Keycloak readiness timeout');
    redis = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: 0, retryStrategy: () => null });
    redis.on('error', () => {});
    const store = new OidcTransactionStore(redis);
    const provider = new OidcProviderService(new OidcFlowService(store), store);
    const config = { enabled: true, issuer, clientId: 'console-test', redirectUri };
    const { url } = await provider.start(config, secret, 'integration-browser');
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    let resolveCallback;
    const callback = new Promise(resolve => { resolveCallback = resolve; });
    // Redirected navigation is observable even when Playwright does not route it.
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:3000' && url.pathname === '/login/oidc' && url.searchParams.has('code')) resolveCallback(url);
    });
    await page.route('**/api/v1/auth/oidc/exchange', route => route.fulfill({ status: 401, json: { message: 'Provider integration test owns the code exchange' } }));
    await page.route(url => url.origin === 'http://127.0.0.1:3000' && url.pathname === '/login/oidc', async route => {
      resolveCallback(new URL(route.request().url()));
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Test callback intercepted' });
    });
    await page.goto(url);
    await page.locator('input[name="username"]').fill('integration-user');
    await page.locator('input[name="password"]').fill(password);
    await page.locator('#kc-login').click();
    let timer;
    const callbackUrl = await Promise.race([
      callback,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Login callback timeout')), 15000); }),
    ]).finally(() => clearTimeout(timer));
    const identity = await provider.complete(config, secret, callbackUrl, 'integration-browser');
    assert.deepEqual(identity, { issuer, subject });
    await assert.rejects(provider.complete(config, secret, callbackUrl, 'integration-browser'));
    console.log('PASS real Keycloak browser code flow, PKCE, signed identity and callback replay rejection');

    const actorContext = { userId: randomUUID(), sessionId: randomUUID(), authzVersion: 1, subject, requestedAt: Math.floor(Date.now() / 1000) };
    const reauthentication = await provider.startReauthentication(config, secret, 'enrollment-browser', actorContext);
    const authorizationUrl = new URL(reauthentication.url);
    assert.equal(authorizationUrl.searchParams.get('prompt'), 'login');
    assert.equal(authorizationUrl.searchParams.get('max_age'), '0');
    const reauthenticationCallback = new Promise(resolve => { resolveCallback = resolve; });
    await page.goto(reauthentication.url);
    // The existing Keycloak SSO cookie must not silently satisfy step-up.
    await page.locator('input[name="password"]').waitFor({ timeout: 15000 });
    if (await page.locator('input[name="username"]').isVisible()) {
      await page.locator('input[name="username"]').fill('integration-user');
    }
    await page.locator('input[name="password"]').fill(password);
    await page.locator('#kc-login').click();
    const reauthenticationUrl = await Promise.race([
      reauthenticationCallback,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Reauthentication callback timeout')), 15000); }),
    ]).finally(() => clearTimeout(timer));
    const verifiedAgain = await provider.completeReauthentication(config, secret, reauthenticationUrl, 'enrollment-browser', actorContext);
    assert.deepEqual(verifiedAgain, { issuer, subject });
    await assert.rejects(provider.completeReauthentication(config, secret, reauthenticationUrl, 'enrollment-browser', actorContext));
    console.log('PASS real Keycloak explicit reauthentication, signed fresh auth_time, exact subject and single-use transaction');
    const db = new PrismaClient();
    const rollback = new Error('Expected integration rollback');
    const email = `${realm}@example.invalid`;
    try {
      await assert.rejects(db.$transaction(async tx => {
        const user = await tx.user.create({ data: { email, role: 'user' } });
        const admin = await tx.user.create({ data: { email: `admin-${email}`, role: 'admin' } });
        const bound = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => fn(tx) : target[key] });
        const users = new UsersService(bound);
        const auth = new AuthService(new AuthRepository(bound), new TokenService(new ConfigService({ jwtSecret: randomBytes(32).toString('hex') })), new OidcIdentityRepository(tx));
        await assert.rejects(auth.loginExternal(identity.issuer, identity.subject));
        const actor = { id: admin.id, role: 'admin' };
        const binding = await users.bindExternalIdentity(actor, user.id, identity);
        const session = await auth.loginExternal(identity.issuer, identity.subject);
        assert.equal(session.user.id, user.id);
        assert.equal(session.user.role, 'user');
        assert.equal((await auth.validate(session.token)).user.id, user.id);
        await users.unbindExternalIdentity(actor, user.id, binding.id);
        assert.equal(await auth.validate(session.token), null);
        assert.equal(await auth.refresh(session.refreshToken), null);
        await assert.rejects(auth.loginExternal(identity.issuer, identity.subject));
        throw rollback;
      }), error => error === rollback);
      assert.equal(await db.user.count({ where: { email: { endsWith: email } } }), 0);
      console.log('PASS real-provider identity binding, platform session and unbind revocation; database fixtures rolled back');
    } finally { await db.$disconnect(); }
  } catch (error) {
    if (page) console.error((await page.locator('body').innerText()).replaceAll(password, '[redacted]').replaceAll(secret, '[redacted]'));
    throw error;
  } finally {
    await browser?.close();
    redis?.disconnect();
    if (server.exitCode === null) server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 10000);
    await exited.finally(() => clearTimeout(timer));
    await unlink(file);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
