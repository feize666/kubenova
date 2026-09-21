const assert = require('node:assert/strict');
const http = require('node:http');
const { planNativeRbac } = require('../dist/src/auth/native-rbac');
const { reconcileNativeRbacPair, assertNativeRbacReady } = require('../dist/src/auth/native-rbac-sync');

(async () => {
  const k8s = await import('@kubernetes/client-node');
  const [plan] = planNativeRbac({ userId:'fixture',clusterId:'fixture-cluster',namespaces:[{name:'ai',uid:'namespace-uid'}],grants:[{
    id:'grant',userId:'fixture',groupId:null,clusterId:'fixture-cluster',role:'viewer',state:'active',validFrom:new Date(0),expiresAt:null,revokedAt:null,
    namespaces:[{namespaceName:'ai',namespaceUid:'namespace-uid'}],capabilities:[{capability:'kubeconfig'}],
  }] });
  const state = new Map(); const writes = []; let revision=0; let conflict=false; let failure;
  const server = http.createServer(async (request,response) => {
    const reply = (code,body) => { response.writeHead(code,{'content-type':'application/json'}); response.end(JSON.stringify(body)); };
    try {
      const pathname = new URL(request.url,'http://fixture').pathname;
      if (pathname==='/api/v1/namespaces/ai' && request.method==='GET') return reply(200,{apiVersion:'v1',kind:'Namespace',metadata:{name:'ai',uid:'namespace-uid'}});
      const match=pathname.match(/^\/apis\/rbac.authorization.k8s.io\/v1\/namespaces\/ai\/(roles|rolebindings)(?:\/([^/]+))?$/);
      assert.ok(match,'only expected namespaced RBAC endpoints may be called');
      const [,kind,name]=match;
      if(name) assert.equal(name,plan.role.metadata.name);
      const current=state.get(kind);
      if(request.method==='GET') return current ? reply(200,current) : reply(404,{kind:'Status',apiVersion:'v1',status:'Failure',reason:'NotFound',code:404});
      let raw=''; for await (const chunk of request) raw+=chunk;
      const body=JSON.parse(raw);
      if(request.method==='DELETE') {
        assert.ok(current); assert.deepEqual(body.preconditions,{uid:current.metadata.uid,resourceVersion:current.metadata.resourceVersion});
        state.delete(kind); writes.push(`DELETE ${kind}`); return reply(200,{kind:'Status',apiVersion:'v1',status:'Success'});
      }
      if(request.method==='PUT') {
        assert.ok(current); assert.equal(body.metadata.resourceVersion,current.metadata.resourceVersion);
        if(conflict) return reply(409,{kind:'Status',apiVersion:'v1',status:'Failure',reason:'Conflict',code:409});
      } else { assert.equal(request.method,'POST'); assert.equal(current,undefined); }
      assert.equal(body.metadata.namespace,'ai'); assert.equal(body.metadata.name,plan.role.metadata.name);
      body.metadata.uid=current?.metadata.uid || `${kind}-uid`; body.metadata.resourceVersion=String(++revision);
      state.set(kind,body); writes.push(`${request.method} ${kind}`); reply(request.method==='POST'?201:200,body);
    } catch(error) { failure=error; reply(500,{message:'fixture assertion failed'}); }
  });
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const config=new k8s.KubeConfig();
    // Client requires this flag for plaintext HTTP; confined to the credential-free loopback fixture.
    config.loadFromOptions({clusters:[{name:'fixture',server:`http://127.0.0.1:${server.address().port}`,skipTLSVerify:true}],users:[{name:'fixture'}],contexts:[{name:'fixture',cluster:'fixture',user:'fixture'}],currentContext:'fixture'});
    const api=config.makeApiClient(k8s.RbacAuthorizationV1Api),core=config.makeApiClient(k8s.CoreV1Api);
    const sync=revoke=>reconcileNativeRbacPair(api,core,plan,revoke,async()=>{});
    await assert.rejects(assertNativeRbacReady(api,core,plan),/not ready/);
    await sync(false); assert.deepEqual(writes,['POST roles','POST rolebindings']);
    await assertNativeRbacReady(api,core,plan);
    writes.length=0; await sync(false); assert.deepEqual(writes,[],'real client model deserialization must remain idempotent');
    state.get('roles').rules=[{apiGroups:[''],resources:['secrets'],verbs:['get']}];
    await assert.rejects(assertNativeRbacReady(api,core,plan),/not ready/);
    await sync(false); assert.deepEqual(writes,['DELETE rolebindings','PUT roles','POST rolebindings']);
    writes.length=0; state.get('roles').rules=[]; conflict=true;
    await assert.rejects(sync(false),error=>error.code===409);
    assert.equal(state.has('rolebindings'),false,'failed update must not restore binding');
    conflict=false; await sync(false); assert.equal(state.has('rolebindings'),true);
    writes.length=0; await sync(true); assert.deepEqual(writes,['DELETE rolebindings','DELETE roles']); assert.equal(state.size,0);
    assert.equal(failure,undefined);
    console.log('PASS real Kubernetes client HTTP: create, idempotency, unbind-before-update, version conflict fails closed, revoke deletion preconditions. Local HTTP fixture, not a real API server.');
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
