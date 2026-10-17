import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
const root=path.resolve(import.meta.dirname,'..');
test('executor preparation shares a private key, resolves paths, and preserves existing secrets',()=>{
  mkdirSync(path.join(root,'tmp'),{recursive:true});
  const dir=mkdtempSync(path.join(root,'tmp/install-updater-'));
  try {
    const env=path.join(dir,'docker.env');
    execFileSync(process.execPath,[path.join(root,'scripts/init-compose-env.mjs'),env]);
    const original=readFileSync(env,'utf8');
    const args=[path.join(root,'scripts/install-update-executor.mjs'),'--prepare-only','--env-file',env,'--config-dir',path.join(dir,'etc'),'--systemd-dir',path.join(dir,'units'),'--runtime-dir',path.join(dir,'run'),'--state-dir',path.join(dir,'state')];
    execFileSync(process.execPath,args);
    const first=readFileSync(env,'utf8');
    const config=readFileSync(path.join(dir,'etc/update-executor.env'),'utf8');
    const value=(text,key)=>text.split('\n').find(x=>x.startsWith(key+'='))?.slice(key.length+1);
    assert.match(value(config,'KUBENOVA_UPDATE_EXECUTOR_TOKEN'),/^[a-f0-9]{64}$/);
    const client=readFileSync(path.join(dir,'etc/update-client.env'),'utf8');
    assert.equal(value(config,'KUBENOVA_UPDATE_EXECUTOR_TOKEN'),value(client,'KUBENOVA_UPDATE_EXECUTOR_TOKEN'));
    assert.equal(value(first,'KUBENOVA_UPDATE_EXECUTOR_TOKEN'),'');
    assert.equal(statSync(path.join(dir,'etc/update-client.env')).mode & 0o777,0o600);
    for(const key of ['POSTGRES_PASSWORD','JWT_SECRET','AI_CREDENTIAL_ENCRYPTION_KEY']) assert.equal(value(first,key),value(original,key));
    assert.equal(value(first,'KUBENOVA_UPDATE_ENABLED'),'true');
    assert.ok(config.includes(env));
    assert.ok(readFileSync(path.join(dir,'units/kubenova-update-executor.service'),'utf8').includes(path.join(root,'scripts/update-executor.mjs')));
    assert.equal(statSync(path.join(dir,'etc/update-executor.env')).mode & 0o777,0o600);
    execFileSync(process.execPath,args);
    assert.equal(readFileSync(env,'utf8'),first);
    if(process.env.KUBENOVA_TEST_COMPOSE==='1') {
      const rendered=JSON.parse(execFileSync('docker',['compose','-f',path.join(root,'deploy/docker/docker-compose.prod.yml'),'-f',path.join(root,'deploy/docker/docker-compose.update.yml'),'--env-file',env,'config','--format','json'],{
        encoding:'utf8',env:{...process.env,KUBENOVA_COMPOSE_ENV_FILE:env},
      }));
      const clientEnvFile=value(first,'KUBENOVA_UPDATE_CLIENT_ENV_FILE');
      const apiEnvFiles=JSON.stringify(rendered.services['control-api'].env_file ?? []);
      assert.ok(apiEnvFiles.includes(path.basename(clientEnvFile)),
        'the control API must load its executor credential from the protected client env file');
      for(const name of ['frontend','runtime-gateway']) assert.ok(!rendered.services[name].environment.KUBENOVA_UPDATE_EXECUTOR_TOKEN,'privileged key must not reach '+name);
      const mount=rendered.services['control-api'].volumes.find(v=>v.target==='/run/kubenova-update');
      assert.equal(mount.read_only,true);
      assert.equal(mount.source,path.join(dir,'run'));
    }
    writeFileSync(env,first.replace(/^KUBENOVA_UPDATE_EXECUTOR_TOKEN=.*$/m,'KUBENOVA_UPDATE_EXECUTOR_TOKEN='+ 'b'.repeat(64)));
    assert.throws(()=>execFileSync(process.execPath,args,{stdio:'pipe'}),/Command failed/);
    assert.equal(readFileSync(path.join(dir,'etc/update-executor.env'),'utf8'),config,'conflicting credentials must not overwrite host configuration');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
