import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, chmod, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('systemd executor authenticates status requests and reports the active release without touching host services', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubenova-systemd-executor-'));
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const releaseBase = join(dir, 'opt/kubenova');
  const release = join(releaseBase, 'releases/v1.1');
  const configDir = join(dir, 'etc/kubenova');
  const stateDir = join(dir, 'var/lib/kubenova-update');
  const binDir = join(dir, 'bin');
  const calls = join(dir, 'systemctl.log');
  let child;
  try {
    await mkdir(join(release, 'scripts'), { recursive: true });
    await mkdir(configDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(release, 'scripts/prod.sh'), '#!/bin/sh\n');
    await writeFile(join(configDir, 'control-api.env'), 'DATABASE_URL=postgresql://127.0.0.1/kubenova\n');
    await symlink(release, join(releaseBase, 'current'));
    const systemctl = join(binDir, 'systemctl');
    await writeFile(systemctl, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SYSTEMCTL_CALL_LOG"\nexit 0\n');
    await chmod(systemctl, 0o755);
    const token = 'test-token-' + 'a'.repeat(40);
    child = spawn(process.execPath, [join(root, 'scripts/systemd-update-executor.mjs')], {
      env: {
        ...process.env,
        PATH: binDir + ':' + process.env.PATH,
        KUBENOVA_UPDATE_EXECUTOR_TOKEN: token,
        KUBENOVA_UPDATE_EXECUTOR_PORT: String(port),
        KUBENOVA_UPDATE_RELEASE_BASE: releaseBase,
        KUBENOVA_UPDATE_CONFIG_DIR: configDir,
        KUBENOVA_UPDATE_STATE_DIR: stateDir,
        SYSTEMCTL_CALL_LOG: calls,
        NODE_ENV: 'test',
        KUBENOVA_UPDATE_TEST_MODE: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    for (let i = 0; i < 100 && !output.includes('listening'); i += 1) await new Promise(resolve => setTimeout(resolve, 25));
    assert.match(output, /listening/);

    const denied = await fetch(`http://127.0.0.1:${port}/v1/system-update/status`);
    assert.equal(denied.status, 401);
    const response = await fetch(`http://127.0.0.1:${port}/v1/system-update/status`, { headers: { authorization: 'Bearer ' + token } });
    const status = await response.json();
    assert.equal(response.status, 200);
    assert.equal(status.ready, true, status.reason);
    assert.deepEqual({ ready: status.ready, mode: status.mode, currentVersion: status.currentVersion }, { ready: true, mode: 'systemd', currentVersion: 'v1.1' });
    assert.match(await import('node:fs/promises').then(fs => fs.readFile(calls, 'utf8')), /is-active --quiet kubenova-frontend\.service/);
  } finally {
    child?.kill('SIGTERM');
    if (child) await new Promise(resolve => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('systemd executor verifies a Release package, backs up the database and switches the active version', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubenova-systemd-upgrade-'));
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const releaseBase = join(dir, 'opt/kubenova');
  const currentRelease = join(releaseBase, 'releases/v1.1');
  const configDir = join(dir, 'etc/kubenova');
  const stateDir = join(dir, 'var/lib/kubenova-update');
  const binDir = join(dir, 'bin');
  const fixtures = join(dir, 'fixtures');
  const packageRoot = join(fixtures, 'kubenova-ubuntu');
  const socketFile = join(dir, 'systemctl.log');
  const token = 'test-token-' + 'b'.repeat(40);
  let child;
  try {
    await mkdir(join(currentRelease, 'scripts'), { recursive: true });
    await mkdir(join(configDir), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(join(packageRoot, 'scripts'), { recursive: true });
    await mkdir(join(packageRoot, 'runtime-gateway'), { recursive: true });
    await mkdir(join(packageRoot, 'control-api/dist/src'), { recursive: true });
    await mkdir(join(packageRoot, 'frontend/.next/standalone'), { recursive: true });
    await mkdir(join(releaseBase, 'releases'), { recursive: true });
    await writeFile(join(currentRelease, 'scripts/prod.sh'), `#!/bin/sh\nset -eu\nbase="$RELEASE_BASE"\nln -s "$base/releases/$2" "$base/current.next"\nnode -e 'require("node:fs").renameSync(process.argv[1],process.argv[2])' "$base/current.next" "$base/current"\n`);
    await writeFile(join(packageRoot, 'metadata.json'), JSON.stringify({ name: 'kubenova', package: 'kubenova-ubuntu', version: 'v1.2', target: 'ubuntu-systemd' }));
    await writeFile(join(packageRoot, 'scripts/prod.sh'), '#!/bin/sh\n');
    await writeFile(join(packageRoot, 'runtime-gateway/runtime-gateway'), 'gateway');
    await writeFile(join(packageRoot, 'control-api/dist/src/main.js'), 'api');
    await writeFile(join(packageRoot, 'frontend/.next/standalone/server.js'), 'frontend');
    await writeFile(join(configDir, 'control-api.env'), 'DATABASE_URL=postgresql://backup-user:secret@127.0.0.1/kubenova\nPORT=4000\n');
    await writeFile(join(configDir, 'runtime-gateway.env'), 'PORT=4100\nRUNTIME_TOKEN_SECRET=test-secret\n');
    await writeFile(join(configDir, 'frontend.env'), 'PORT=3002\n');
    await symlink(currentRelease, join(releaseBase, 'current'));

    const systemctl = join(binDir, 'systemctl');
    const pgDump = join(binDir, 'pg_dump');
    await writeFile(systemctl, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SYSTEMCTL_CALL_LOG"\nexit 0\n');
    await writeFile(pgDump, '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --file ]; then shift; printf dump > "$1"; exit 0; fi; shift; done\nexit 2\n');
    await chmod(systemctl, 0o755);
    await chmod(pgDump, 0o755);
    const archive = join(fixtures, 'kubenova-ubuntu.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', fixtures, 'kubenova-ubuntu']);
    const archiveBytes = await import('node:fs/promises').then(fs => fs.readFile(archive));
    const { createHash } = await import('node:crypto');
    const checksum = createHash('sha256').update(archiveBytes).digest('hex') + '  kubenova-ubuntu.tar.gz\n';
    const manifest = JSON.stringify({ version: 'v1.2', repository: 'feize666/kubenova', images: { frontend: 'image@sha256:' + 'a'.repeat(64), controlApi: 'image@sha256:' + 'b'.repeat(64), runtimeGateway: 'image@sha256:' + 'c'.repeat(64) } });
    const mockFetch = join(dir, 'mock-fetch.mjs');
    await writeFile(mockFetch, `import { readFile } from 'node:fs/promises';\nconst root=${JSON.stringify(fixtures)};\nglobalThis.fetch=async input=>{const name=new URL(input).pathname.split('/').pop();const map={'release-manifest.json':[${JSON.stringify(manifest)},'application/json'],'kubenova-ubuntu.tar.gz.sha256':[${JSON.stringify(checksum)},'text/plain'],'kubenova-ubuntu.tar.gz':[await readFile(root+'/kubenova-ubuntu.tar.gz'),'application/gzip']};const item=map[name];return item?new Response(item[0],{headers:{'content-type':item[1]}}):new Response('missing',{status:404})};\n`);
    child = spawn(process.execPath, [join(root, 'scripts/systemd-update-executor.mjs')], {
      env: {
        ...process.env,
        PATH: binDir + ':' + process.env.PATH,
        NODE_OPTIONS: '--import=' + mockFetch,
        NODE_ENV: 'test',
        KUBENOVA_UPDATE_TEST_MODE: 'true',
        KUBENOVA_UPDATE_EXECUTOR_TOKEN: token,
        KUBENOVA_UPDATE_EXECUTOR_PORT: String(port),
        KUBENOVA_UPDATE_RELEASE_BASE: releaseBase,
        KUBENOVA_UPDATE_CONFIG_DIR: configDir,
        KUBENOVA_UPDATE_STATE_DIR: stateDir,
        SYSTEMCTL_CALL_LOG: socketFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    for (let i = 0; i < 100 && !output.includes('listening'); i += 1) await new Promise(resolve => setTimeout(resolve, 25));
    assert.match(output, /listening/);
    const release = {
      downloadUrl: 'https://github.com/feize666/kubenova/releases/download/v1.2/kubenova-ubuntu.tar.gz',
      checksumUrl: 'https://github.com/feize666/kubenova/releases/download/v1.2/kubenova-ubuntu.tar.gz.sha256',
      manifestUrl: 'https://github.com/feize666/kubenova/releases/download/v1.2/release-manifest.json',
    };
    const queued = await fetch(`http://127.0.0.1:${port}/v1/system-update/tasks`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'install', targetVersion: 'v1.2', release, operator: 'admin' }),
    });
    assert.equal(queued.status, 202, await queued.clone().text());
    const task = await queued.json();
    let completed;
    for (let i = 0; i < 200; i += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/v1/system-update/tasks/${task.taskId}`, { headers: { authorization: 'Bearer ' + token } });
      completed = await response.json();
      if (['succeeded', 'failed'].includes(completed.status)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(completed.status, 'succeeded', completed.message);
    assert.equal(completed.targetVersion, 'v1.2');
    assert.equal(await import('node:fs/promises').then(fs => fs.realpath(join(releaseBase, 'current'))), await import('node:fs/promises').then(fs => fs.realpath(join(releaseBase, 'releases/v1.2'))));
  } finally {
    child?.kill('SIGTERM');
    if (child) await new Promise(resolve => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('systemd preflight runs disposable database and migration checks without changing the active release', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubenova-systemd-preflight-'));
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const releaseBase = join(dir, 'opt/kubenova');
  const release = join(releaseBase, 'releases/v1.1');
  const configDir = join(dir, 'etc/kubenova');
  const stateDir = join(dir, 'var/lib/kubenova-update');
  const binDir = join(dir, 'bin');
  const token = 'test-token-' + 'c'.repeat(40);
  let child;
  try {
    await mkdir(join(release, 'scripts'), { recursive: true });
    await mkdir(configDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(release, 'scripts/prod.sh'), '#!/bin/sh\n');
    await writeFile(join(configDir, 'control-api.env'), 'DATABASE_URL=postgresql://127.0.0.1/kubenova\n');
    await symlink(release, join(releaseBase, 'current'));
    await writeFile(join(binDir, 'systemctl'), '#!/bin/sh\nexit 0\n');
    await writeFile(join(binDir, 'pg_dump'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --file ]; then shift; printf dump > "$1"; exit 0; fi; shift; done\nexit 2\n');
    await writeFile(join(binDir, 'psql'), '#!/bin/sh\nexit 0\n');
    await writeFile(join(binDir, 'pg_restore'), '#!/bin/sh\nexit 0\n');
    await chmod(join(binDir, 'systemctl'), 0o755);
    await chmod(join(binDir, 'pg_dump'), 0o755);
    await chmod(join(binDir, 'psql'), 0o755);
    await chmod(join(binDir, 'pg_restore'), 0o755);
    const migrationCommand = `${process.execPath} -e "if (!process.env.DATABASE_URL.includes('kubenova_preflight_')) process.exit(2)"`;
    child = spawn(process.execPath, [join(root, 'scripts/systemd-update-executor.mjs')], { env: { ...process.env, PATH: binDir + ':' + process.env.PATH, KUBENOVA_UPDATE_EXECUTOR_TOKEN: token, KUBENOVA_UPDATE_EXECUTOR_PORT: String(port), KUBENOVA_UPDATE_RELEASE_BASE: releaseBase, KUBENOVA_UPDATE_CONFIG_DIR: configDir, KUBENOVA_UPDATE_STATE_DIR: stateDir, KUBENOVA_UPDATE_TEST_MODE: 'true', KUBENOVA_UPDATE_MIGRATION_TEST_COMMAND: migrationCommand, KUBENOVA_UPDATE_OLD_VERSION_COMPATIBILITY_COMMAND: migrationCommand }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    for (let i = 0; i < 100 && !output.includes('listening'); i += 1) await new Promise(resolve => setTimeout(resolve, 25));
    assert.match(output, /listening/);
    const response = await fetch(`http://127.0.0.1:${port}/v1/system-update/preflight`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ targetVersion: 'v1.2', backupTarget: { type: 'local', location: stateDir + '/backups' }, migrationTarget: { type: 'local', connection: 'postgresql://127.0.0.1/kubenova_restore_test' } }) });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.deepEqual(result.checks.map(check => check.name), ['部署健康', '备份目标', '数据库备份探测', '临时测试库', '备份恢复', '目标版本迁移', '旧版本兼容', '临时测试库清理', '临时备份清理']);
    assert.equal(await import('node:fs/promises').then(fs => fs.realpath(join(releaseBase, 'current'))), await import('node:fs/promises').then(fs => fs.realpath(release)));
  } finally {
    child?.kill('SIGTERM');
    if (child) await new Promise(resolve => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
