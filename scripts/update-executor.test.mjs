import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const key = 'a'.repeat(64);
const release = {
  downloadUrl: 'https://github.com/feize666/kubenova/releases/download/v1.2/kubenova-ubuntu.tar.gz',
  checksumUrl: 'https://github.com/feize666/kubenova/releases/download/v1.2/kubenova-ubuntu.tar.gz.sha256',
  manifestUrl: 'https://github.com/feize666/kubenova/releases/download/v1.2/release-manifest.json',
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, extra = {}) {
  await mkdir(path.join(root, 'tmp'), {recursive:true});
  const dir = await mkdtemp(path.join(root, 'tmp/updater-'));
  // Unix socket path must also fit macOS sockaddr_un's short path limit.
  const socket = path.join(dir, 's');
  await mkdir(path.join(dir, 'bin'));
  await writeFile(path.join(dir, 'compose.yml'), 'services: {}');
  await writeFile(path.join(dir, 'env'), 'KUBENOVA_IMAGE_TAG=v1.1\nPOSTGRES_USER=app\nPOSTGRES_DB=app\nPOSTGRES_PASSWORD=' + key);
  await writeFile(path.join(dir, 'compose.sh'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$FAKE_DIR/calls"\nif [[ "$*" == *"--tag v1.2"* && -f "$FAKE_DIR/fail-switch" ]]; then exit 1; fi\n');
  await writeFile(path.join(dir, 'bin/docker'), '#!' + process.execPath + '\n' + [
    'const fs=require("node:fs"); const args=process.argv.slice(2);',
    'if(args.includes("inspect") && args.includes("--format")) process.stdout.write(JSON.stringify({"kubenova_default":{}})); else if(args.includes("inspect")) process.stdout.write(JSON.stringify([{Config:{Image:"ghcr.io/feize666/kubenova-control-api:v1.1",Labels:{"com.docker.compose.project":"docker"}},RepoDigests:["ghcr.io/feize666/kubenova-control-api@sha256:"+"e".repeat(64)],State:{Running:true,Health:{Status:"healthy"}}}]));',
    'if(args.includes("pg_dump")) { if(fs.existsSync(process.env.FAKE_DIR+"/fail-backup")) process.exit(1); process.stdout.write("x".repeat(3*1024*1024)); }',
  ].join('\n'), {mode:0o755});
  await writeFile(path.join(dir,'bin/psql'), '#!/bin/sh\nexit 0\n', {mode:0o755});
  await writeFile(path.join(dir,'bin/pg_restore'), '#!/bin/sh\nexit 0\n', {mode:0o755});
  await writeFile(path.join(dir,'bin/aws'), '#!' + process.execPath + '\n' + [
    'const fs=require("node:fs"); const path=require("node:path"); const args=process.argv.slice(2); const root=path.join(process.env.FAKE_DIR,"s3");',
    'if(process.env.AWS_ACCESS_KEY_ID!=="access-id" || process.env.AWS_SECRET_ACCESS_KEY!=="secret-value") process.exit(9);',
    'const keyOf=value=>new URL(value).pathname.replace(/^\\//,""); const local=value=>path.join(root,keyOf(value));',
    'if(args[0]==="s3" && args[1]==="cp"){const source=args[2],target=args[3];if(source.startsWith("s3://")){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(local(source),target);}else{fs.mkdirSync(path.dirname(local(target)),{recursive:true});fs.copyFileSync(source,local(target));}}',
    'else if(args[0]==="s3" && args[1]==="rm"){fs.rmSync(local(args[2]),{force:true});}',
    'else if(args[0]==="s3api" && args[1]==="list-objects-v2"){const prefix=args[args.indexOf("--prefix")+1];let rows=[];const walk=(base)=>{for(const entry of fs.readdirSync(base,{withFileTypes:true})){const file=path.join(base,entry.name);if(entry.isDirectory())walk(file);else{const key=path.relative(root,file).split(path.sep).join("/");if(key.startsWith(prefix))rows.push({Key:key,LastModified:fs.statSync(file).mtime.toISOString()});}}};if(fs.existsSync(root))walk(root);process.stdout.write(JSON.stringify({Contents:rows}));}',
    'else if(args[0]==="s3api" && args[1]==="delete-object"){fs.rmSync(path.join(root,args[args.indexOf("--key")+1]),{force:true});} else process.exit(8);',
  ].join('\n'), {mode:0o755});
  await writeFile(path.join(dir, 'network.mjs'), [
    'import {createHash} from "node:crypto";',
    'const artifact=Buffer.from("release archive fixture");',
    'const manifest=JSON.stringify({version:"v1.2",repository:"feize666/kubenova",images:{frontend:"ghcr.io/feize666/kubenova-frontend@sha256:"+"b".repeat(64),controlApi:"ghcr.io/feize666/kubenova-control-api@sha256:"+"c".repeat(64),runtimeGateway:"ghcr.io/feize666/kubenova-runtime-gateway@sha256:"+"d".repeat(64)}});',
    'globalThis.fetch=async(input)=>{ const url=new URL(input);',
    'if(url.hostname==="github.com") return new Response(null,{status:302,headers:{location:process.env.REDIRECT_TARGET || "https://release-assets.githubusercontent.com/fixture/"+url.pathname.split("/").pop()}});',
    'if(url.hostname!=="release-assets.githubusercontent.com") throw Error("unexpected outbound request");',
    'return new Response(url.pathname.endsWith("release-manifest.json") ? manifest : url.pathname.endsWith("sha256") ? (process.env.BAD_CHECKSUM ? "0".repeat(64) : createHash("sha256").update(artifact).digest("hex"))+"  kubenova-ubuntu.tar.gz\\n" : artifact); };',
  ].join('\n'));
  let child;
  let output = '';
  const env = {...process.env, PATH:path.join(dir,'bin')+':'+process.env.PATH, FAKE_DIR:dir,
    KUBENOVA_UPDATE_EXECUTOR_SOCKET:socket, KUBENOVA_UPDATE_EXECUTOR_TOKEN:key,
    KUBENOVA_UPDATE_COMPOSE_FILE:path.join(dir,'compose.yml'), KUBENOVA_UPDATE_ENV_FILE:path.join(dir,'env'),
    KUBENOVA_UPDATE_COMPOSE_SCRIPT:path.join(dir,'compose.sh'), KUBENOVA_UPDATE_STATE_DIR:path.join(dir,'state'), ...extra};
  const stop = async()=>{if(child && child.exitCode===null){child.kill('SIGTERM'); await once(child,'exit');}};
  const start = async()=>{
    child=spawn(process.execPath,['--import',path.join(dir,'network.mjs'),path.join(root,'scripts/update-executor.mjs')],{env,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>output+=b); child.stderr.on('data',b=>output+=b);
    for(let i=0;i<60;i++) { try { await stat(socket); return; } catch {} if(child.exitCode!==null) break; await sleep(50); }
    assert.fail('executor did not start a Unix socket: '+output);
  };
  t.after(async()=>{await stop(); await rm(dir,{recursive:true,force:true});});
  const call=(url, body, token=key)=>new Promise((resolve,reject)=>{
    const req=request({socketPath:socket,path:url,method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'}},res=>{let data='';res.on('data',b=>data+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});
    req.on('error',reject); req.end(body?JSON.stringify(body):undefined);
  });
  await start();
  return {dir,call,stop,start,output:()=>output};
}
async function complete(f,id) {
  for(let i=0;i<150;i++){const r=await f.call('/v1/system-update/tasks/'+id); if(['succeeded','failed'].includes(r.body.status)) return r.body; await sleep(50);}
  assert.fail('task timed out');
}
test('socket authentication, pinned assets, one task at a time, streaming backup, and restart recovery',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/v1/system-update/status',null,'wrong')).status,401);
  assert.equal((await f.call('/v1/system-update/status')).body.ready,true);
  assert.equal((await f.call('/v1/system-update/tasks',{action:'install',targetVersion:'v1.3',release})).status,400);
  const replies=await Promise.all([1,2].map(()=>f.call('/v1/system-update/tasks',{action:'install',targetVersion:'v1.2',release})));
  assert.deepEqual(replies.map(x=>x.status).sort(),[202,409]);
  const task=await complete(f,replies.find(x=>x.status===202).body.taskId);
  assert.equal(task.status,'succeeded');
  assert.equal((await stat(path.join(f.dir,'state/backups','kubenova-update-'+task.taskId+'.sql'))).size,3*1024*1024);
  assert.equal((await stat(path.join(f.dir,'state/backups','kubenova-update-'+task.taskId+'.sql'))).mode & 0o777,0o600);
  await f.stop(); await f.start();
  const recovered=(await f.call('/v1/system-update/status')).body;
  assert.equal(recovered.latestTask.taskId,task.taskId);
  assert.equal(recovered.backupVersion,'v1.1');
  assert.ok(!JSON.stringify(recovered).includes(key));
  const rollback=await f.call('/v1/system-update/tasks',{action:'rollback',targetVersion:'v1.1'});
  assert.equal(rollback.status,202);
  assert.equal((await complete(f,rollback.body.taskId)).status,'succeeded');
  assert.equal((await f.call('/v1/system-update/status')).body.backupVersion,null);
});

test('preflight creates, restores, checks, and removes a temporary migration database without creating an update task', async t => {
  const command = `${process.execPath} -e "if (!process.env.DATABASE_URL.includes('kubenova_preflight_')) process.exit(2)"`;
  const f = await fixture(t, { KUBENOVA_UPDATE_MIGRATION_TEST_COMMAND: command, KUBENOVA_UPDATE_OLD_VERSION_COMPATIBILITY_COMMAND: command });
  const result = await f.call('/v1/system-update/preflight', { targetVersion: 'v1.2', backupTarget: { type: 'local', location: f.dir + '/state/backups' }, migrationTarget: { type: 'local', connection: 'postgresql://127.0.0.1/kubenova_restore_test' }, targetRelease: { manifestUrl: release.manifestUrl } });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'passed', JSON.stringify(result.body));
  assert.deepEqual(result.body.checks.map(check => check.name), ['部署健康', '备份目标', '数据库备份探测', '目标版本镜像清单', '临时测试库', '备份恢复', '目标版本迁移', '旧版本兼容', '临时测试库清理', '临时备份清理']);
  assert.equal((await f.call('/v1/system-update/status')).body.latestTask, null);
});
test('backup failure never switches or rolls back live services',async t=>{
  const f=await fixture(t); await writeFile(path.join(f.dir,'fail-backup'),'1');
  const r=await f.call('/v1/system-update/tasks',{action:'install',targetVersion:'v1.2',release});
  assert.equal((await complete(f,r.body.taskId)).status,'failed');
  await assert.rejects(readFile(path.join(f.dir,'calls')), {code:'ENOENT'});
});
test('S3 credentials are not returned or persisted in a successful task', async t => {
  const f = await fixture(t);
  const response = await f.call('/v1/system-update/tasks', {
    action: 'install', targetVersion: 'v1.2', release,
    backupTarget: { id: 'remote', type: 's3', location: 's3://bucket.example/backups', secret: { AWS_ACCESS_KEY_ID: 'access-id', AWS_SECRET_ACCESS_KEY: 'secret-value' } },
  });
  assert.equal(response.status, 202);
  assert.ok(!JSON.stringify(response.body).includes('secret-value'));
  const task = await complete(f, response.body.taskId);
  assert.equal(task.status, 'succeeded');
  const savedTasks = await readFile(path.join(f.dir, 'state/tasks.json'), 'utf8');
  assert.ok(!savedTasks.includes('secret-value'));
});
test('Compose update uploads its database backup to the selected S3 prefix', async t => {
  const f = await fixture(t);
  const response = await f.call('/v1/system-update/tasks', {
    action: 'install', targetVersion: 'v1.2', release,
    backupTarget: { id: 'remote', type: 's3', location: 's3://bucket.example/kubenova/backups', secret: { AWS_ACCESS_KEY_ID: 'access-id', AWS_SECRET_ACCESS_KEY: 'secret-value' } },
  });
  assert.equal(response.status, 202);
  const task = await complete(f, response.body.taskId);
  assert.equal(task.status, 'succeeded', task.message);
  assert.equal((await stat(path.join(f.dir, 's3/kubenova/backups/kubenova-update-' + task.taskId + '.sql'))).size, 3 * 1024 * 1024);
  assert.ok(!JSON.stringify(await readFile(path.join(f.dir, 'state/tasks.json'), 'utf8')).includes('secret-value'));
});
test('checksum mismatch never switches or rolls back services',async t=>{
  const f=await fixture(t,{BAD_CHECKSUM:'1'});
  const r=await f.call('/v1/system-update/tasks',{action:'install',targetVersion:'v1.2',release});
  const result=await complete(f,r.body.taskId);
  assert.equal(result.status,'failed');
  assert.match(result.message,/SHA256/);
  await assert.rejects(readFile(path.join(f.dir,'calls')), {code:'ENOENT'});
});
test('rejects redirect to loopback without exposing or switching services',async t=>{
  const f=await fixture(t,{REDIRECT_TARGET:'http://127.0.0.1/private'});
  const r=await f.call('/v1/system-update/tasks',{action:'install',targetVersion:'v1.2',release});
  assert.equal((await complete(f,r.body.taskId)).status,'failed');
  await assert.rejects(readFile(path.join(f.dir,'calls')), {code:'ENOENT'});
});
test('failed health switch rolls back once, only after switching began',async t=>{
  const f=await fixture(t); await writeFile(path.join(f.dir,'fail-switch'),'1');
  const r=await f.call('/v1/system-update/tasks',{action:'install',targetVersion:'v1.2',release});
  const task=await complete(f,r.body.taskId);
  assert.equal(task.status,'failed'); assert.equal(task.rolledBack,true);
  const calls=(await readFile(path.join(f.dir,'calls'),'utf8')).trim().split('\n');
  assert.equal(calls.length,2); assert.match(calls[1],/^rollback v1.1 /);
});
