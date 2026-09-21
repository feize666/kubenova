const assert=require('node:assert/strict');
const https=require('node:https');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {forwardNativeRead}=require('../dist/src/auth/native-transport');

(async()=>{
  const k8s=await import('@kubernetes/client-node');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kn-native-tls-'));
  let server, failure, requests=0, stopped;
  const subject='kubenova:native:'+'a'.repeat(40);
  try {
    const key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');
    const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(request,response)=>{
      requests++;
      try {
        assert.equal(request.headers.authorization,'Bearer fixture-token');
        assert.equal(request.headers['impersonate-user'],subject);
        assert.equal(request.headers['impersonate-group'],undefined);
        assert.equal(request.method,'GET');
        assert.ok(request.url.startsWith('/prefix/api/v1/namespaces/ai/pods'));
        if(request.url.includes('redirect=true')) { response.writeHead(302,{location:'https://example.invalid/'}).end(); return; }
        response.writeHead(200,{'content-type':'application/json'}); response.flushHeaders();
        response.once('close',()=>stopped?.());
      } catch(error) { failure=error;response.writeHead(500).end(); }
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const config=new k8s.KubeConfig();
    config.loadFromOptions({clusters:[{name:'fixture',server:`https://127.0.0.1:${server.address().port}/prefix`,caData:fs.readFileSync(cert).toString('base64')}],users:[{name:'fixture',token:'fixture-token'}],contexts:[{name:'fixture',cluster:'fixture',user:'fixture'}],currentContext:'fixture'});
    const abort=new AbortController();
    const response=await forwardNativeRead(config,'/api/v1/namespaces/ai/pods?watch=true',subject,abort.signal);
    assert.equal(response.statusCode,200);
    response.on('error',()=>{});
    const closed=new Promise(resolve=>{stopped=resolve;});
    abort.abort();
    await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Upstream survived revocation')),2000);timer.unref();})]);
    await assert.rejects(forwardNativeRead(config,'/api/v1/namespaces/ai/pods?redirect=true',subject,new AbortController().signal),/redirect denied/);
    assert.equal(requests,2,'redirect must not be followed');
    delete config.clusters[0].caData;
    await assert.rejects(forwardNativeRead(config,'/api/v1/namespaces/ai/pods',subject,new AbortController().signal),/upstream unavailable/);
    assert.equal(requests,2,'untrusted TLS must not send credentials');
    assert.equal(failure,undefined);
    console.log('PASS native TLS transport: trusted CA, server-owned impersonation, prefix preservation, redirect denial, stream cancellation, untrusted CA rejected before credentials. Isolated HTTPS fixture.');
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
