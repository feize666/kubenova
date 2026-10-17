#!/usr/bin/env node
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, rm, rename, chmod, lstat } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const socket = process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET;
const port = Number(process.env.KUBENOVA_UPDATE_EXECUTOR_PORT || 4200);
const token = (process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN || '').trim();
const repository = process.env.KUBENOVA_UPDATE_REPOSITORY || 'feize666/kubenova';
const composeFile = process.env.KUBENOVA_UPDATE_COMPOSE_FILE || join(root, 'deploy/docker/docker-compose.prod.yml');
const envFile = process.env.KUBENOVA_UPDATE_ENV_FILE || '/etc/kubenova/docker.env';
const scriptFile = process.env.KUBENOVA_UPDATE_COMPOSE_SCRIPT || join(root, 'scripts/compose-release.sh');
const stateDir = process.env.KUBENOVA_UPDATE_STATE_DIR || '/var/lib/kubenova/update-executor';
const stateFile = join(stateDir, 'tasks.json');
const tasks = new Map();
let activeTask = null;
let persistQueue = Promise.resolve();
const stableTag = value => typeof value === 'string' && /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/.test(value);
const safeReleaseUrl = (value, tag, asset) => value === 'https://github.com/' + repository + '/releases/download/' + tag + '/' + asset;

function persist() {
  const data = JSON.stringify([...tasks.values()].slice(-100));
  const operation = persistQueue.then(async () => {
    await writeFile(stateFile + '.tmp', data, { mode: 0o600 });
    await rename(stateFile + '.tmp', stateFile);
  });
  persistQueue = operation.catch(() => {});
  return operation;
}
async function setTask(task, patch) { Object.assign(task, patch); await persist(); }
async function envValues() {
  const rows = (await readFile(envFile, 'utf8')).split(/\r?\n/);
  return Object.fromEntries(rows.filter(row => /^[A-Z_][A-Z0-9_]*=/.test(row)).map(row => {
    const i = row.indexOf('='); return [row.slice(0,i),row.slice(i+1).trim().replace(/^(['"])(.*)\1$/, '$2')];
  }));
}
async function composeArgs() {
  const env = await envValues();
  const args = ['compose', '-f', composeFile];
  if (env.KUBENOVA_UPDATE_ENABLED === 'true') args.push('-f', join(dirname(composeFile), 'docker-compose.update.yml'));
  if (env.COMPOSE_PROJECT_NAME) args.push('--project-name', env.COMPOSE_PROJECT_NAME);
  return [...args, '--env-file', envFile];
}
async function run(command, args, timeout = 20*60*1000) {
  try {
    return await exec(command, args, { timeout, maxBuffer: 2*1024*1024,
      env: {...process.env, COMPOSE_FILE:composeFile, KUBENOVA_COMPOSE_ENV_FILE:envFile} });
  } catch { throw new Error(command + ' 执行失败，请检查受保护的主机日志和部署配置'); }
}
async function ready() {
  await Promise.all([stat(composeFile),stat(envFile),stat(scriptFile)]);
  await run('docker', ['info', '--format', '{{.ServerVersion}}'], 4_000);
  await run('docker', [...await composeArgs(), 'config', '--quiet'], 4_000);
}
async function currentVersion() {
  const {stdout} = await run('docker', ['inspect', 'kubenova-control-api']);
  const rows = JSON.parse(stdout);
  const version = rows[0]?.Config?.Image?.split(':').pop();
  if (!stableTag(version)) throw new Error('当前容器必须使用固定版本 tag，不能以 latest 或未知版本升级');
  return version;
}
async function backup(task) {
  await setTask(task,{phase:'backing-up',percent:10,message:'正在备份 PostgreSQL'});
  const dir=join(stateDir,'backups'); await mkdir(dir,{recursive:true,mode:0o700});
  const file=join(dir,task.taskId+'.sql'), temporary=file+'.partial';
  const env=await envValues();
  const child=spawn('docker',[...await composeArgs(),'exec','-T','-e','PGPASSWORD','postgres','pg_dump','-U',env.POSTGRES_USER || 'kubenova','-d',env.POSTGRES_DB || 'kubenova'], {
    env:{...process.env,PGPASSWORD:env.POSTGRES_PASSWORD || '',KUBENOVA_COMPOSE_ENV_FILE:envFile}, stdio:['ignore','pipe','ignore'], timeout:20*60*1000,
  });
  const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('PostgreSQL 备份失败，未切换服务')));});
  const streamed=pipeline(child.stdout,createWriteStream(temporary,{flags:'wx',mode:0o600}));
  try {
    await Promise.all([exited,streamed]);
    if (!(await stat(temporary)).size) throw new Error('数据库备份为空');
    await rename(temporary,file);
  } catch(error) { child.kill(); await Promise.allSettled([exited,streamed]); await rm(temporary,{force:true}); throw error; }
  await setTask(task,{backupFile:file,percent:25,message:'PostgreSQL 备份完成'});
}
async function downloadFile(url, file, limit = 4*1024*1024*1024) {
  // Only GitHub's release CDN is trusted; never forward executor credentials.
  const signal=AbortSignal.timeout(10*60*1000);
  for(let hop=0;hop<5;hop++) {
    const target=new URL(url);
    if(target.protocol!=='https:' || target.username || target.password || target.port || !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(target.hostname)) throw new Error('发布资产重定向地址不受信任');
    const response=await fetch(target,{redirect:'manual',signal});
    if([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location'); await response.body?.cancel();
      if(!location) throw new Error('发布资产缺少重定向地址');
      url=new URL(location,target).href; continue;
    }
    if(!response.ok || !response.body) throw new Error('发布资产下载失败（HTTP '+response.status+'）');
    let bytes=0;
    const bounded=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>limit?new Error('发布资产超过大小限制'):null,chunk);}});
    await pipeline(Readable.fromWeb(response.body),bounded,createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
    return;
  }
  throw new Error('发布资产重定向次数过多');
}
async function download(task) {
  await setTask(task,{phase:'downloading',percent:35,message:'正在下载并校验发布包'});
  const dir=join(stateDir,'downloads',task.taskId); await mkdir(dir,{recursive:true,mode:0o700});
  await downloadFile(task.release.checksumUrl,join(dir,'checksum'),4096);
  const match=(await readFile(join(dir,'checksum'),'utf8')).trim().match(/^([a-f0-9]{64})\s+\*?kubenova-ubuntu\.tar\.gz$/i);
  if(!match) throw new Error('SHA256 校验文件格式无效');
  const archive=join(dir,'kubenova-ubuntu.tar.gz');
  await downloadFile(task.release.downloadUrl,archive);
  const hash=createHash('sha256'); for await(const chunk of createReadStream(archive)) hash.update(chunk);
  if(hash.digest('hex')!==match[1].toLowerCase()) throw new Error('SHA256 校验失败，未切换服务');
  await setTask(task,{phase:'verifying',percent:50,message:'SHA256 校验通过'});
}
function backupVersion() {
  const latest=[...tasks.values()].reverse().find(task=>task.status==='succeeded');
  return latest?.action==='install' ? latest.previousVersion || null : null;
}
async function pruneBackups() {
  const dir=join(stateDir,'backups'); const files=[];
  for(const entry of await readdir(dir,{withFileTypes:true})) if(entry.isFile() && entry.name.endsWith('.sql')) {
    const file=join(dir,entry.name); files.push({file,mtime:(await stat(file)).mtimeMs});
  }
  files.sort((a,b)=>b.mtime-a.mtime);
  // Keep at least five snapshots AND everything from the last seven days.
  for(const [i,file] of files.entries()) if(i>=5 && file.mtime<Date.now()-7*86400000) await rm(file.file);
}
async function runTask(task) {
  let switching=false;
  try {
    await setTask(task,{status:'running',phase:'preparing',percent:0,startedAt:new Date().toISOString()});
    await ready();
    if(task.action==='install') {
      await setTask(task,{previousVersion:await currentVersion()});
      await backup(task); await download(task);
    }
    await setTask(task,{phase:'switching',percent:65,message:task.action==='install'?'正在切换服务并等待健康检查':'正在回滚应用镜像'});
    switching=true;
    await run('bash',[scriptFile,task.action==='install'?'up':'rollback',...(task.action==='install'?['--tag',task.targetVersion]:[task.targetVersion]),'--env-file',envFile]);
    await setTask(task,{status:'succeeded',phase:'completed',percent:100,message:'服务已通过健康检查'});
    if(task.action==='install') await pruneBackups().catch(()=>console.error('旧备份清理失败；升级结果不受影响'));
  } catch(error) {
    let message=error.message;
    if(switching && task.action==='install' && task.previousVersion) {
      await setTask(task,{phase:'rollbacking',message:'升级失败，正在回滚应用镜像'});
      try {
        await run('bash',[scriptFile,'rollback',task.previousVersion,'--env-file',envFile]);
        task.rolledBack=true; message='升级失败，应用镜像已自动回滚；数据库未回滚';
      } catch { message='升级与自动回滚均失败，请立即检查主机服务'; }
    }
    await setTask(task,{status:'failed',phase:'failed',message});
  } finally {
    await rm(join(stateDir,'downloads',task.taskId),{recursive:true,force:true});
    activeTask=null;
  }
}
function publicTask(task) {
  if(!task) return null;
  const {release,backupFile,...value}=task; return value;
}
function json(response,status,payload) {
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); response.end(JSON.stringify(payload));
}
function authorized(request) {
  const supplied=Buffer.from(request.headers.authorization || ''); const expected=Buffer.from('Bearer '+token);
  return supplied.length===expected.length && timingSafeEqual(supplied,expected);
}
async function body(request) {
  let data=''; for await(const chunk of request) {data+=chunk; if(Buffer.byteLength(data)>65536) throw new Error('请求过大');}
  return JSON.parse(data || '{}');
}
const server=createServer(async(request,response)=>{
  if(!authorized(request)) return json(response,401,{message:'unauthorized'});
  try {
    const path=request.url?.split('?')[0] || '/';
    if(request.method==='GET' && path==='/v1/system-update/status') {
      let issue=null; try {await ready();} catch {issue='执行器未就绪：请检查 Docker、Compose 文件及环境配置';}
      return json(response,200,{ready:!issue,reason:issue,backupVersion:backupVersion(),latestTask:publicTask([...tasks.values()].at(-1))});
    }
    if(request.method==='POST' && path==='/v1/system-update/tasks') {
      const input=await body(request);
      if(!['install','rollback'].includes(input.action) || !stableTag(input.targetVersion)) return json(response,400,{message:'invalid update task'});
      if(input.action==='install' && (!safeReleaseUrl(input.release?.downloadUrl,input.targetVersion,'kubenova-ubuntu.tar.gz') || !safeReleaseUrl(input.release?.checksumUrl,input.targetVersion,'kubenova-ubuntu.tar.gz.sha256'))) return json(response,400,{message:'untrusted release assets'});
      if(input.action==='rollback' && input.targetVersion!==backupVersion()) return json(response,400,{message:'no verified rollback version'});
      // Claim before the first await: concurrent submissions cannot both pass.
      if(activeTask) return json(response,409,{message:'another update task is running'});
      const task={taskId:randomUUID(),action:input.action,targetVersion:input.targetVersion,release:input.release,operator:String(input.operator || 'unknown').slice(0,200),status:'queued',phase:'queued',percent:0,message:null,createdAt:new Date().toISOString()};
      activeTask=task.taskId; tasks.set(task.taskId,task);
      try { await persist(); } catch(error) {activeTask=null; tasks.delete(task.taskId); throw error;}
      json(response,202,publicTask(task));
      void runTask(task).catch(()=>{console.error('执行器状态持久化失败，停止接受新任务');process.exit(1);});
      return;
    }
    const match=path.match(/^\/v1\/system-update\/tasks\/([^/]+)$/);
    if(request.method==='GET' && match) {const task=tasks.get(decodeURIComponent(match[1])); return json(response,task?200:404,task?publicTask(task):{message:'task not found'});}
    return json(response,404,{message:'not found'});
  } catch {return json(response,400,{message:'request failed; inspect protected host configuration'});}
});

if(token.length<32 || /replace-with|change-me|placeholder/i.test(token)) throw new Error('执行器需要至少 32 字符的非占位密钥');
if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('发布仓库格式无效');
await mkdir(stateDir,{recursive:true,mode:0o700});
try {
  for(const row of JSON.parse(await readFile(stateFile,'utf8'))) {
    if(!row?.taskId) continue;
    if(['queued','running'].includes(row.status)) Object.assign(row,{status:'failed',phase:'interrupted',message:'执行器曾中断，请核查容器和备份；不会自动重复部署'});
    tasks.set(row.taskId,row);
  }
} catch(error) {if(error.code!=='ENOENT') throw new Error('执行器状态文件损坏，拒绝覆盖，请人工核查');}
await persist();
if(socket) {
  await mkdir(dirname(socket),{recursive:true,mode:0o700});
  try {
    if(!(await lstat(socket)).isSocket()) throw new Error('socket 路径已被其他文件占用');
    await new Promise((resolve,reject)=>{const c=connect(socket);c.on('connect',()=>{c.destroy();reject(new Error('执行器已运行'));});c.on('error',e=>e.code==='ECONNREFUSED'?resolve():reject(e));});
    await rm(socket);
  } catch(error) {if(error.code!=='ENOENT') throw error;}
  server.listen(socket,async()=>{await chmod(socket,0o600);console.log('update executor listening on private Unix socket');});
} else {
  server.listen(port,'127.0.0.1',()=>console.log('update executor listening on loopback:'+port));
}
process.on('SIGTERM',()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();});
