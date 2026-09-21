const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {nativeDiscovery}=require('../dist/src/auth/native-discovery');

(async()=>{
  assert.ok(process.env.KUBECTL_BIN,'Set explicit kubectl binary');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kn-kubectl-discovery-'));
  const paths=[];
  const rows=[{group:'',version:'v1',resource:'pods',kind:'Pod',namespaced:true,verbsJson:['get','list','watch']},
    {group:'apps',version:'v1',resource:'deployments',kind:'Deployment',namespaced:true,verbsJson:['get','list','watch']}];
  const server=http.createServer((req,res)=>{
    paths.push(req.url);
    try {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(nativeDiscovery(req.url,rows,[])));}
    catch {res.end(JSON.stringify({kind:'Status',apiVersion:'v1',code:404,status:'Failure'}));}
  });
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.env.KUBECTL_BIN,['--kubeconfig=/dev/null',`--server=http://127.0.0.1:${server.address().port}`,`--cache-dir=${dir}`,'--request-timeout=10s','api-resources','-o','name'],{env:{...process.env,KUBECONFIG:'/dev/null'}});
      let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
      const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
    });
    assert.equal(result.code,0,result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n').sort(),['deployments.apps','pods']);
    assert.ok(paths.some(target=>target.includes('timeout=')),'real client timeout query required');
    console.log('PASS actual kubectl api-resources consumes filtered discovery and timeout queries. Loopback catalog fixture; not OIDC or live cluster acceptance.');
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
