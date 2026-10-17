#!/usr/bin/env node
import { parseArgs, promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { request } from 'node:http';

const exec = promisify(execFile);
const root = await realpath(path.resolve(import.meta.dirname, '..'));
const {values} = parseArgs({options:{'prepare-only':{type:'boolean'},'env-file':{type:'string'},'compose-file':{type:'string'},'config-dir':{type:'string'},'systemd-dir':{type:'string'},'runtime-dir':{type:'string'},'state-dir':{type:'string'}}});
const prepare = values['prepare-only'];
if (!prepare && (process.platform !== 'linux' || process.getuid?.() !== 0)) throw new Error('正式安装要求 Linux root；本机可用 --prepare-only 校验配置，不启动服务');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或以上版本');
const envFile=path.resolve(values['env-file'] || path.join(root,'deploy/docker/.env'));
const composeFile=path.resolve(values['compose-file'] || path.join(root,'deploy/docker/docker-compose.prod.yml'));
const configDir=path.resolve(values['config-dir'] || '/etc/kubenova');
const unitDir=path.resolve(values['systemd-dir'] || '/etc/systemd/system');
const runtimeDir=path.resolve(values['runtime-dir'] || '/run/kubenova-update');
const stateDir=path.resolve(values['state-dir'] || '/var/lib/kubenova/update-executor');
for (const name of [root,envFile,composeFile,configDir,unitDir,runtimeDir,stateDir,process.execPath]) {
  if (/[\s'"\\$%]/.test(name)) throw new Error('部署路径不得包含空白、引号或 shell/systemd 特殊字符');
}
async function readConfig(file, optional=false) {
  try {if (!(await lstat(file)).isFile()) throw new Error('配置必须是普通文件，拒绝符号链接'); return await readFile(file,'utf8');}
  catch(error) {if(optional && error.code==='ENOENT') return ''; throw error;}
}
const value=(text,key)=>text.split(/\r?\n/).find(line=>line.startsWith(key+'='))?.slice(key.length+1).trim().replace(/^(['"])(.*)\1$/, '$2') || '';
const set=(text,key,val)=>new RegExp('^'+key+'=.*$','m').test(text)?text.replace(new RegExp('^'+key+'=.*$','m'),()=>key+'='+val):text.trimEnd()+'\n'+key+'='+val+'\n';
const hostFile=path.join(configDir,'update-executor.env'),clientFile=path.join(configDir,'update-client.env');
let env=await readConfig(envFile);
const host=await readConfig(hostFile,true),client=await readConfig(clientFile,true);
const tokens=[host,client,env].map(text=>value(text,'KUBENOVA_UPDATE_EXECUTOR_TOKEN')).filter(v=>v && !/replace-with|change-me|placeholder/i.test(v));
if (tokens.some(v=>v.length<32 || /[^a-zA-Z0-9._~-]/.test(v))) throw new Error('执行器密钥无效：至少32位且仅允许字母数字及 . _ ~ -');
if(new Set(tokens).size>1) throw new Error('执行器密钥冲突，保留现有文件，请先核对配置');
const token=tokens[0] || randomBytes(32).toString('hex');
let project=value(env,'COMPOSE_PROJECT_NAME');
if (!prepare) {
  await exec('docker',['info'],{timeout:10000});
  // Never restart an executor while it is changing the deployment.
  const existingSocket=value(host,'KUBENOVA_UPDATE_EXECUTOR_SOCKET');
  if(existingSocket) {
    const status=await new Promise((resolve,reject)=>{
      const req=request({socketPath:existingSocket,path:'/v1/system-update/status',headers:{authorization:'Bearer '+token}},res=>{
        let body='';res.on('data',chunk=>{body+=chunk;if(body.length>65536)req.destroy(new Error('执行器状态响应过大'));});
        res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('现有执行器鉴权失败');resolve(JSON.parse(body));}catch(e){reject(e);}});
      });
      req.setTimeout(15000,()=>req.destroy(new Error('现有执行器响应超时')));
      req.on('error',e=>['ENOENT','ECONNREFUSED'].includes(e.code)?resolve(null):reject(e));req.end();
    });
    if(['running','queued'].includes(status?.latestTask?.status)) throw new Error('已有升级任务运行，拒绝重装执行器');
  }
  const {stdout}=await exec('docker',['ps','-a','--filter','name=^/kubenova-control-api$','--format','{{.Names}}']);
  if(stdout.trim()) {
    const {stdout:label}=await exec('docker',['inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}','kubenova-control-api']);
    const actual=label.trim();
    if(!actual || actual==='<no value>') throw new Error('现有容器不是 Compose 部署，拒绝自动接管');
    if(project && project!==actual) throw new Error('Compose 项目名与现有容器不一致，拒绝切换数据卷');
    project=actual;
  }
}
project ||= path.basename(path.dirname(composeFile)).toLowerCase();
if(!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Compose 项目名无效');
const repository=value(host,'KUBENOVA_UPDATE_REPOSITORY') || value(env,'KUBENOVA_UPDATE_REPOSITORY') || 'feize666/kubenova';
if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('更新仓库无效');
for(const [key,val] of Object.entries({COMPOSE_PROJECT_NAME:project,KUBENOVA_UPDATE_ENABLED:'true',KUBENOVA_UPDATE_RUNTIME_DIR:runtimeDir,KUBENOVA_UPDATE_CLIENT_ENV_FILE:clientFile,KUBENOVA_UPDATE_EXECUTOR_TOKEN:'',KUBENOVA_UPDATE_EXECUTOR_URL:''})) env=set(env,key,val);
const serialize=obj=>Object.entries(obj).map(([key,val])=>key+'='+val).join('\n')+'\n';
const hostEnv=serialize({KUBENOVA_UPDATE_EXECUTOR_SOCKET:path.join(runtimeDir,'executor.sock'),KUBENOVA_UPDATE_EXECUTOR_TOKEN:token,KUBENOVA_UPDATE_COMPOSE_FILE:composeFile,KUBENOVA_UPDATE_ENV_FILE:envFile,KUBENOVA_UPDATE_COMPOSE_SCRIPT:path.join(root,'scripts/compose-release.sh'),KUBENOVA_UPDATE_STATE_DIR:stateDir,KUBENOVA_UPDATE_REPOSITORY:repository});
const clientEnv=serialize({KUBENOVA_UPDATE_EXECUTOR_SOCKET:'/run/kubenova-update/executor.sock',KUBENOVA_UPDATE_EXECUTOR_URL:'',KUBENOVA_UPDATE_EXECUTOR_TOKEN:token,KUBENOVA_UPDATE_REPOSITORY:repository});
let unit=await readFile(path.join(root,'deploy/systemd/kubenova-update-executor.service'),'utf8');
unit=unit.replace(/^WorkingDirectory=.*$/m,'WorkingDirectory='+root).replace(/^EnvironmentFile=.*$/m,'EnvironmentFile='+hostFile).replace(/^ExecStart=.*$/m,'ExecStart='+process.execPath+' '+path.join(root,'scripts/update-executor.mjs')).replace(/^ReadWritePaths=.*$/m,'ReadWritePaths='+stateDir+' '+runtimeDir);
for(const dir of [configDir,unitDir,runtimeDir,stateDir]) await mkdir(dir,{recursive:true,mode:0o700});
async function save(file,content,mode=0o600) {
  await readConfig(file,true); // Refuse to overwrite a symlink.
  const temporary=file+'.'+randomBytes(6).toString('hex')+'.tmp';
  await writeFile(temporary,content,{flag:'wx',mode});await rename(temporary,file);
}
await save(hostFile,hostEnv); await save(clientFile,clientEnv); await save(envFile,env);
await save(path.join(unitDir,'kubenova-update-executor.service'),unit,0o644);
if(!prepare) {
  await exec('bash',[path.join(root,'scripts/compose-release.sh'),'preflight','--env-file',envFile],{env:{...process.env,COMPOSE_FILE:composeFile}});
  await exec('systemctl',['daemon-reload']);
  await exec('systemctl',['enable','kubenova-update-executor.service']);
  await exec('systemctl',['restart','kubenova-update-executor.service']);
  await exec('systemctl',['is-active','--quiet','kubenova-update-executor.service']);
}
console.log(prepare?'配置准备完成，未启动服务。':'执行器已安装；使用 compose-release.sh up --tag <当前部署版本> --env-file <环境文件> 重建应用以接入私有 socket。');
console.log('密钥仅存储于受保护的执行器和 control-api 配置；已有数据库及应用密钥未轮换。');
