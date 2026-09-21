const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { RuntimeInvalidationService } = require('../dist/src/runtime/runtime-invalidation.service');
const { RuntimeInternalController } = require('../dist/src/runtime/runtime-internal.controller');
const { RuntimeService } = require('../dist/src/runtime/runtime.service');
const { RuntimeRepository } = require('../dist/src/runtime/runtime.repository');
const { RuntimeSessionService } = require('../dist/src/runtime/runtime-session.service');
const { ResponseEnvelopeInterceptor } = require('../dist/src/common/interceptors/response-envelope.interceptor');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
assert.ok(process.env.PSQL_BIN);
const schema = `watch_${randomUUID().replaceAll('-','')}`;
const admin = new PrismaClient();
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
let app, invalidation, kube, gateway, created = false;
(async () => {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    await db.$executeRawUnsafe('CREATE TABLE "User" (id text PRIMARY KEY, "authzVersion" integer, "isActive" boolean, role text)');
    await db.$executeRawUnsafe('CREATE TABLE "RuntimeSession" (LIKE public."RuntimeSession" INCLUDING DEFAULTS)');
    await db.$executeRawUnsafe('CREATE TABLE "AuthorizationChange" (id text PRIMARY KEY, "affectedUserId" text)');
    process.env.DATABASE_URL = url.toString(); process.env.RUNTIME_PUSH_REVOCATION_ENABLED = 'true';
    process.env.RUNTIME_GATEWAY_INTERNAL_SECRET = 'fixture-internal-secret';
    invalidation = new RuntimeInvalidationService(db);
    await assert.rejects(invalidation.get(), /migration required/);
    const sql = fs.readFileSync(path.join(__dirname,'../prisma/migrations/20260920010000_authz_notifications/migration.sql'),'utf8');
    const env = { ...process.env, PGDATABASE: url.pathname.slice(1), PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
    for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) delete env[key];
    const installed = spawnSync(process.env.PSQL_BIN,['-X','-v','ON_ERROR_STOP=1'],{env,input:`SET search_path TO "${schema}";\n${sql}`,encoding:'utf8'});
    assert.equal(installed.status,0,installed.stderr);
    await db.$executeRawUnsafe(`INSERT INTO "User" VALUES ('fixture',1,true,'user')`);
    process.env.RUNTIME_TOKEN_SECRET = randomUUID();
    process.env.KUBENOVA_AUTHZ_ENFORCE = 'true';
    // Grant and Kubernetes identity lookups remain fixtures; sessions and signatures are real.
    const sessions = new RuntimeSessionService(new RuntimeRepository(db),
      { assertCanRead: async () => {} },
      { authorize: async input => ({ allowed: input.userId === 'fixture' && input.namespaceUid === 'fixture-uid' && input.capability === 'logs' }) },
      { resolve: async () => 'fixture-uid' });
    const payload = { sessionId:'fixture', userId:'fixture', type:'logs', clusterId:'fixture-cluster', namespace:'ai', pod:'fixture-pod', container:'app', path:'/ws/logs', exp:Math.floor(Date.now()/1000)+60 };
    await sessions.persistSession({ ...payload, id:payload.sessionId, authzVersion:1, expiresAt:new Date(payload.exp*1000) });
    const runtimeToken = sessions.createRuntimeToken(payload);
    let startedResolve, stoppedResolve;
    const upstreamStarted = new Promise(resolve => { startedResolve = resolve; });
    const upstreamStopped = new Promise(resolve => { stoppedResolve = resolve; });
    kube = http.createServer((request, response) => {
      if (request.url.split('?')[0] !== '/api/v1/namespaces/ai/pods/fixture-pod/log') { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type':'text/plain' }); response.flushHeaders();
      startedResolve(); request.once('close', stoppedResolve);
    });
    await new Promise(resolve => kube.listen(0,'127.0.0.1',resolve));
    const kubeconfig = JSON.stringify({apiVersion:'v1',kind:'Config',clusters:[{name:'fixture',cluster:{server:`http://127.0.0.1:${kube.address().port}`}}],contexts:[{name:'fixture',context:{cluster:'fixture',user:'fixture'}}],'current-context':'fixture',users:[{name:'fixture',user:{}}]});
    const runtime = new RuntimeService(sessions, { getKubeconfig: async () => kubeconfig }, {}, invalidation);
    const module = await Test.createTestingModule({ controllers:[RuntimeInternalController], providers:[{provide:RuntimeService,useValue:runtime}] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor()); await app.listen(0,'127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/api/runtime/internal/sessions/fixture/watch`,{
      method:'POST', headers:{'content-type':'application/json','x-runtime-gateway-secret':'fixture-internal-secret'},
      body:JSON.stringify({runtimeToken,path:'/ws/logs'}), signal:AbortSignal.timeout(5000),
    });
    assert.equal(response.status,200,await (response.status!==200 ? response.text() : Promise.resolve('')));
    const reader = response.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value),/"active":true/);
    let gatewayDone;
    if (process.env.GO_BIN) {
      gateway = spawn(process.env.GO_BIN,['test','./internal/httpapi','-run','^TestPostgresRevocationExternal$','-count=1','-v'], {
        cwd:path.join(__dirname,'../../runtime-gateway'),
        env:{...process.env,CONTROL_API_BASE_URL:await app.getUrl(),KUBENOVA_TEST_RUNTIME_TOKEN:runtimeToken},
        stdio:['ignore','pipe','pipe'],
      });
      let output = '';
      gateway.stdout.on('data',chunk => { output += chunk; });
      gateway.stderr.on('data',chunk => { output += chunk; });
      gatewayDone = new Promise((resolve,reject) => {
        gateway.once('error',reject);
        gateway.once('exit',code => code === 0 ? resolve() : reject(Error(`Gateway test failed: ${output}`)));
      });
      gatewayDone.catch(() => {});
      await Promise.race([upstreamStarted,gatewayDone.then(() => { throw Error(`Gateway exited without opening upstream: ${output}`); }),new Promise((_,reject) => { const timer=setTimeout(() => reject(Error('Gateway upstream startup timeout')),30000);timer.unref(); })]);
    }
    const started = Date.now();
    await db.$executeRawUnsafe(`UPDATE "User" SET "authzVersion"=2 WHERE id='fixture'`);
    assert.equal((await reader.read()).done,true);
    assert.ok(Date.now()-started<2000,'push must not wait for the five-second polling interval');
    if (gatewayDone) {
      await gatewayDone;
      assert.ok(Date.now()-started<2000,'gateway closure must not wait for periodic polling');
      await Promise.race([upstreamStopped,new Promise((_,reject) => { const timer=setTimeout(() => reject(Error('Upstream request remained active')),2000);timer.unref(); })]);
    }
    const denied = await sessions.validateSessionTokenDetailed({sessionId:'fixture',runtimeToken,expectedPath:'/ws/logs'});
    assert.equal(denied.payload,null,'revoked authorization snapshot must reject reuse of signed token');
    assert.equal(denied.code,'RUNTIME_SESSION_NOT_FOUND');
    const disconnected = await invalidation.get();
    await disconnected.close();
    const recovered = await invalidation.get();
    assert.notEqual(recovered, disconnected);
    assert.equal(recovered.available, true, 'new requests recover the notification connection');
    const retry = await fetch(`${await app.getUrl()}/api/runtime/internal/sessions/fixture/watch`, {
      method:'POST', headers:{'content-type':'application/json','x-runtime-gateway-secret':'fixture-internal-secret'},
      body:JSON.stringify({runtimeToken,path:'/ws/logs'}), signal:AbortSignal.timeout(5000),
    });
    assert.equal(retry.status,403,'revoked signed token cannot reopen the watch');
    await retry.arrayBuffer();
    console.log(`PASS signed session + PostgreSQL -> LISTEN -> Nest HTTP${gatewayDone ? ' -> Go WebSocket and idle upstream cancellation' : ''}; revoked token reuse denied. Grant/namespace and Kubernetes server remain fixtures.`);
  } finally {
    gateway?.kill();
    await invalidation?.onModuleDestroy(); await app?.close();
    if (kube) { kube.closeAllConnections(); await new Promise(resolve => kube.close(resolve)); }
    await db.$disconnect();
    try { if(created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.$disconnect(); }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
