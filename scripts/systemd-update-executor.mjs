#!/usr/bin/env node
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, statfs, lstat, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { postgresDumpConfig } from './systemd-update-utils.mjs';
import { pruneRetainedBackups } from './update-backup-retention.mjs';
import { createS3BackupStorage } from './s3-backup-storage.mjs';
import { runPostgresMigrationRehearsal } from './update-preflight.mjs';

const exec = promisify(execFile);
const releaseBase = await realpath(resolve(process.env.KUBENOVA_UPDATE_RELEASE_BASE || '/opt/kubenova'));
const currentLink = join(releaseBase, 'current');
const configDir = resolve(process.env.KUBENOVA_UPDATE_CONFIG_DIR || '/etc/kubenova');
const controlEnvFile = join(configDir, 'control-api.env');
const stateDir = resolve(process.env.KUBENOVA_UPDATE_STATE_DIR || '/var/lib/kubenova/update-executor');
const stateFile = join(stateDir, 'tasks.json');
const token = (process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN || '').trim();
const socketPath = process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET;
const port = Number(process.env.KUBENOVA_UPDATE_EXECUTOR_PORT || 4200);
const repository = process.env.KUBENOVA_UPDATE_REPOSITORY || 'feize666/kubenova';
const packageName = process.env.KUBENOVA_UPDATE_PACKAGE_NAME || 'kubenova-ubuntu';
const tasks = new Map();
let activeTask = null;
let persistQueue = Promise.resolve();
const validTag = value => typeof value === 'string' && /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/.test(value);
const safeReleaseUrl = (value, tag, asset) => value === `https://github.com/${repository}/releases/download/${tag}/${asset}`;
const compareVersions = (left, right) => {
  const a = left.slice(1).split('.').map(Number); const b = right.slice(1).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
};
const safeTask = task => {
  if (!task) return null;
  const { release: _release, backupFile: _backupFile, ...publicValue } = task;
  if (publicValue.backupTarget) { const { secret: _secret, ...backupTarget } = publicValue.backupTarget; publicValue.backupTarget = backupTarget; }
  return publicValue;
};
const persistedTask = task => {
  if (!task.backupTarget) return task;
  const { secret: _secret, ...backupTarget } = task.backupTarget;
  return { ...task, backupTarget };
};
function s3Storage(target) {
  return createS3BackupStorage({
    location: target?.location,
    secret: target?.secret,
    run: (command, args, options = {}) => run(command, args, options),
  });
}
const parseEnv = content => Object.fromEntries(content.split(/\r?\n/).filter(line => /^[A-Z_][A-Z0-9_]*=/.test(line)).map(line => {
  const split = line.indexOf('=');
  return [line.slice(0, split), line.slice(split + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
}));

async function persist() {
  const temp = stateFile + '.tmp';
  const next = persistQueue.then(async () => {
    await writeFile(temp, JSON.stringify([...tasks.values()].slice(-100).map(persistedTask)), { mode: 0o600 });
    await rename(temp, stateFile);
  });
  persistQueue = next.catch(() => {});
  return next;
}
async function updateTask(task, fields) { Object.assign(task, fields); await persist(); }
async function currentRelease() {
  const info = await lstat(currentLink);
  if (!info.isSymbolicLink()) throw new Error('current 必须是版本目录符号链接，拒绝原地覆盖');
  const path = await realpath(currentLink);
  if (!path.startsWith(join(releaseBase, 'releases') + '/')) throw new Error('当前版本指针指向发布目录之外');
  const version = basename(path);
  if (!validTag(version)) throw new Error('当前发布目录名不是稳定版本');
  return { path, version };
}
async function releaseCandidates(currentVersion) {
  const dir = join(releaseBase, 'releases');
  const rows = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validTag(entry.name) || compareVersions(entry.name, currentVersion) >= 0) continue;
    try {
      const metadata = JSON.parse(await readFile(join(dir, entry.name, 'metadata.json'), 'utf8'));
      if (metadata.version !== entry.name || metadata.repository && metadata.repository !== repository) continue;
      await stat(join(dir, entry.name, 'runtime-gateway/runtime-gateway'));
      await stat(join(dir, entry.name, 'control-api/dist/src/main.js'));
      await stat(join(dir, entry.name, 'frontend/.next/standalone/server.js'));
      rows.push({ version: entry.name, backupAvailable: [...tasks.values()].some(task => task.targetVersion === currentVersion && task.backupFile && task.status === 'succeeded') });
    } catch { /* Incomplete directories are not rollback candidates. */ }
  }
  return rows.sort((a, b) => compareVersions(b.version, a.version)).slice(0, 3);
}
async function ready() {
  const current = await currentRelease();
  if (process.platform !== 'linux' && process.env.KUBENOVA_UPDATE_TEST_MODE !== 'true') throw new Error('原生在线升级仅支持 Linux systemd 部署');
  await exec('systemctl', ['is-active', '--quiet', 'kubenova-control-api.service']);
  await exec('systemctl', ['is-active', '--quiet', 'kubenova-runtime-gateway.service']);
  await exec('systemctl', ['is-active', '--quiet', 'kubenova-frontend.service']);
  await stat(join(current.path, 'scripts/prod.sh'));
  await stat(controlEnvFile);
  await stat(join(releaseBase, 'releases'));
  return current;
}
async function preflight(input = {}) {
  const checks = [];
  let current;
  try { current = await ready(); checks.push({ name: '部署健康', status: 'passed', message: `systemd 三项服务就绪，当前版本 ${current.version}` }); }
  catch (error) { checks.push({ name: '部署健康', status: 'failed', message: error instanceof Error ? error.message : 'systemd 执行器未就绪' }); return { status: 'failed', checks }; }
  let remoteBackup = null;
  const target = input.backupTarget?.type === 'local' && input.backupTarget.location ? input.backupTarget.location : join(stateDir, 'backups');
  let backupProbe = null;
  try {
    if (input.backupTarget?.type === 's3') remoteBackup = s3Storage(input.backupTarget);
    await mkdir(target, { recursive: true, mode: 0o700 });
    const probe = join(target, `.preflight-${randomUUID()}`);
    await writeFile(probe, 'kubenova-preflight', { flag: 'wx', mode: 0o600 }); await rm(probe, { force: true });
    if (remoteBackup) {
      await remoteBackup.verify();
      checks.push({ name: '备份目标', status: 'passed', message: 'S3 兼容存储写入、读回校验和临时对象清理均通过' });
    } else {
      const stats = await statfs(target); const minimum = Number(process.env.KUBENOVA_UPDATE_MIN_FREE_BYTES || 64 * 1024 * 1024);
      if (stats.bavail * stats.bsize < minimum) throw new Error('备份目标可用空间不足');
      checks.push({ name: '备份目标', status: 'passed', message: `本地备份目录可写，剩余 ${Math.floor(stats.bavail * stats.bsize / 1024 / 1024)} MiB` });
    }
  } catch (error) { checks.push({ name: '备份目标', status: 'failed', message: error instanceof Error ? error.message : '备份目标不可写' }); }
  try {
    const values = parseEnv(await readFile(controlEnvFile, 'utf8')); const databaseUrl = values.DATABASE_URL;
    if (!databaseUrl) throw new Error('control-api 配置缺少 PostgreSQL DATABASE_URL');
    backupProbe = join(target, `.preflight-${randomUUID()}.dump`);
    const pg = postgresDumpConfig(databaseUrl, backupProbe);
    const passwordFile = join(target, `.preflight-${randomUUID()}.pgpass`);
    if (pg.passwordLine) await writeFile(passwordFile, pg.passwordLine, { flag: 'wx', mode: 0o600 });
    try { await exec('pg_dump', pg.args, { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024, env: { ...process.env, ...(pg.passwordLine ? { PGPASSFILE: passwordFile } : {}), ...(pg.sslmode ? { PGSSLMODE: pg.sslmode } : {}) } }); }
    finally { await rm(passwordFile, { force: true }); }
    if (!(await stat(backupProbe)).size) throw new Error('PostgreSQL 备份探测为空');
    checks.push({ name: '数据库备份探测', status: 'passed', message: 'PostgreSQL 完整备份探测成功，临时文件将在预检结束时清理' });
  } catch (error) { checks.push({ name: '数据库备份探测', status: 'failed', message: error instanceof Error ? error.message : 'PostgreSQL 备份探测失败' }); }
  try {
    if (!backupProbe || !input.migrationTarget?.connection) throw new Error('迁移兼容试跑需要有效的数据库备份和迁移测试连接');
    const rehearsal = await runPostgresMigrationRehearsal({ backupFile: backupProbe, connectionString: input.migrationTarget.connection, targetVersion: input.targetVersion, migrationCommand: process.env.KUBENOVA_UPDATE_MIGRATION_TEST_COMMAND, compatibilityCommand: process.env.KUBENOVA_UPDATE_OLD_VERSION_COMPATIBILITY_COMMAND });
    checks.push(...rehearsal.checks);
    if (rehearsal.status !== 'passed') throw new Error('临时数据库迁移兼容演练未全部通过');
  } catch (error) { checks.push({ name: '迁移兼容试跑', status: 'failed', message: error instanceof Error ? error.message : '迁移兼容试跑失败' }); }
  if (backupProbe) await rm(backupProbe, { force: true }).catch(() => checks.push({ name: '临时备份清理', status: 'failed', message: '无法清理预检临时备份' }));
  if (!checks.some(check => check.name === '临时备份清理')) checks.push({ name: '临时备份清理', status: 'passed', message: '临时备份已清理' });
  return { status: checks.every(check => check.status === 'passed') ? 'passed' : 'failed', checks };
}
async function run(command, args, options = {}) {
  try { return await exec(command, args, { timeout: options.timeout ?? 20 * 60_000, maxBuffer: options.maxBuffer ?? 2 * 1024 * 1024, env: { ...process.env, ...options.env } }); }
  catch { throw new Error(options.message || `${command} 执行失败，请检查受保护的 systemd 主机日志`); }
}
async function backupDatabase(task) {
  await updateTask(task, { phase: 'backing-up', percent: 12, message: '正在备份 PostgreSQL' });
  const remoteBackup = task.backupTarget?.type === 's3' ? s3Storage(task.backupTarget) : null;
  const values = parseEnv(await readFile(controlEnvFile, 'utf8'));
  const databaseUrl = values.DATABASE_URL;
  if (!databaseUrl) throw new Error('control-api 配置缺少 PostgreSQL DATABASE_URL，未切换服务');
  const dir = task.backupTarget?.type === 'local' && task.backupTarget.location ? task.backupTarget.location : join(stateDir, 'backups');
  const file = join(dir, `kubenova-update-${task.taskId}.dump`);
  const pg = postgresDumpConfig(databaseUrl, file + '.partial');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = file + '.partial';
  const passwordFile = join(dir, `${task.taskId}.pgpass`);
  if (pg.passwordLine) await writeFile(passwordFile, pg.passwordLine, { flag: 'wx', mode: 0o600 });
  let code;
  try {
    const child = spawn('pg_dump', pg.args, {
      stdio: ['ignore', 'ignore', 'ignore'], timeout: 20 * 60_000,
      env: { ...process.env, ...(pg.passwordLine ? { PGPASSFILE: passwordFile } : {}), ...(pg.sslmode ? { PGSSLMODE: pg.sslmode } : {}) },
    });
    code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });
  } catch { code = 1; }
  finally { await rm(passwordFile, { force: true }); }
  if (code !== 0) { await rm(temporary, { force: true }); throw new Error('PostgreSQL 备份失败，未切换服务'); }
  if ((await stat(temporary)).size === 0) { await rm(temporary, { force: true }); throw new Error('PostgreSQL 备份为空，未切换服务'); }
  await rename(temporary, file);
  if (remoteBackup) {
    try {
      const name = basename(file);
      await remoteBackup.upload(file, name);
      await rm(file, { force: true });
      await updateTask(task, { backupFile: remoteBackup.objectUri(name), percent: 25, message: 'PostgreSQL 备份已上传并校验' });
    } catch (error) { await rm(file, { force: true }); throw error; }
  } else await updateTask(task, { backupFile: file, percent: 25, message: 'PostgreSQL 备份完成' });
}
async function downloadFile(rawUrl, destination, limit) {
  let url = rawUrl;
  const signal = AbortSignal.timeout(10 * 60_000);
  for (let hop = 0; hop < 5; hop += 1) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password || target.port || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname)) throw new Error('发布资产下载地址不受信任');
    const response = await fetch(target, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('发布资产缺少重定向地址');
      url = new URL(location, target).href; continue;
    }
    if (!response.ok || !response.body) throw new Error(`发布资产下载失败（HTTP ${response.status}）`);
    let size = 0;
    const bounded = new TransformStream({ transform(chunk, controller) { size += chunk.byteLength; if (size > limit) throw new Error('发布资产超过大小限制'); controller.enqueue(chunk); } });
    await pipeline(response.body, bounded, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
    return;
  }
  throw new Error('发布资产重定向次数过多');
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function stageRelease(task) {
  await updateTask(task, { phase: 'downloading', percent: 35, message: '正在下载并校验发布包' });
  const downloadDir = join(stateDir, 'downloads', task.taskId);
  await mkdir(downloadDir, { recursive: true, mode: 0o700 });
  const manifestFile = join(downloadDir, 'release-manifest.json');
  const checksumFile = join(downloadDir, 'archive.sha256');
  const archiveFile = join(downloadDir, 'release.tar.gz');
  await downloadFile(task.release.manifestUrl, manifestFile, 64 * 1024);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.version !== task.targetVersion || manifest.repository !== repository || !manifest.images?.frontend || !manifest.images?.controlApi || !manifest.images?.runtimeGateway) throw new Error('发布清单与目标版本不匹配');
  await downloadFile(task.release.checksumUrl, checksumFile, 4096);
  const checksum = (await readFile(checksumFile, 'utf8')).trim().match(/^([a-f0-9]{64})\s+\*?kubenova-ubuntu\.tar\.gz$/i);
  if (!checksum) throw new Error('SHA256 校验文件格式无效');
  await downloadFile(task.release.downloadUrl, archiveFile, 2 * 1024 * 1024 * 1024);
  if (await digest(archiveFile) !== checksum[1].toLowerCase()) throw new Error('SHA256 校验失败，未切换服务');
  await updateTask(task, { phase: 'verifying', percent: 52, message: 'SHA256 校验通过，正在检查发布目录' });
  const { stdout } = await run('tar', ['-tzf', archiveFile], { maxBuffer: 32 * 1024 * 1024, message: '发布包目录读取失败' });
  const entries = stdout.split('\n').filter(Boolean);
  if (!entries.length || entries.some(entry => entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..') || entry.split('/')[0] !== packageName)) throw new Error('发布包目录结构不安全或与预期不符');
  const releasesDir = join(releaseBase, 'releases');
  await mkdir(releasesDir, { recursive: true, mode: 0o755 });
  const destination = join(releasesDir, task.targetVersion);
  try { await lstat(destination); throw new Error('目标版本目录已存在；拒绝覆盖现有发布文件'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = join(releasesDir, `.staging-${task.taskId}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    await run('tar', ['-xzf', archiveFile, '-C', staging, '--strip-components=1', '--no-same-owner', '--no-same-permissions'], { timeout: 10 * 60_000, message: '发布包解压失败' });
    const metadata = JSON.parse(await readFile(join(staging, 'metadata.json'), 'utf8'));
    if (metadata.name !== 'kubenova' || metadata.package !== packageName || metadata.version !== task.targetVersion || metadata.target !== 'ubuntu-systemd') throw new Error('发布包元数据与目标版本或平台不匹配');
    await stat(join(staging, 'scripts/prod.sh'));
    await stat(join(staging, 'runtime-gateway/runtime-gateway'));
    await stat(join(staging, 'control-api/dist/src/main.js'));
    await stat(join(staging, 'frontend/.next/standalone/server.js'));
    await rename(staging, destination);
    task.stagedRelease = destination;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  await updateTask(task, { phase: 'switching', percent: 68, message: '发布包已校验，正在原子切换三个服务' });
}
async function switchRelease(action, version) {
  const [control, runtime, frontend] = await Promise.all([
    readFile(controlEnvFile, 'utf8'),
    readFile(join(configDir, 'runtime-gateway.env'), 'utf8').catch(() => ''),
    readFile(join(configDir, 'frontend.env'), 'utf8').catch(() => ''),
  ]).then(values => values.map(parseEnv));
  return run('bash', [join(currentLink, 'scripts/prod.sh'), action, version], {
    timeout: 20 * 60_000,
    env: {
      RELEASE_BASE: releaseBase,
      CURRENT_DIR: currentLink,
      SYSTEMD_ENV_DIR: configDir,
      CONTROL_API_PORT: control.PORT || '4000',
      RUNTIME_GATEWAY_PORT: runtime.PORT || '4100',
      FRONTEND_PORT: frontend.PORT || '3000',
      RUNTIME_TOKEN_SECRET: runtime.RUNTIME_TOKEN_SECRET || '',
    },
    message: 'systemd 服务切换失败，请检查主机健康状态和 journal 日志',
  });
}
function rollbackCandidates() {
  return [...tasks.values()].filter(task => task.action === 'install' && task.status === 'succeeded' && task.previousVersion && task.backupFile)
    .map(task => ({ version: task.previousVersion, backupAvailable: true }))
    .filter((candidate, index, all) => all.findIndex(item => item.version === candidate.version) === index)
    .slice(0, 3);
}
async function pruneBackups(dir) {
  await pruneRetainedBackups(dir);
}
async function runTask(task) {
  let activationStarted = false;
  try {
    await updateTask(task, { status: 'running', phase: 'preparing', percent: 2, startedAt: new Date().toISOString() });
    const previous = await ready();
    task.previousVersion = previous.version;
    if (task.action === 'install') {
      if (compareVersions(task.targetVersion, previous.version) <= 0) throw new Error('目标版本必须高于当前运行版本');
      await backupDatabase(task);
      await stageRelease(task);
    }
    activationStarted = true;
    await switchRelease(task.action === 'install' ? 'switch' : 'rollback', task.targetVersion);
    const active = await currentRelease();
    if (active.version !== task.targetVersion) throw new Error('服务切换后运行版本与目标版本不一致');
    await updateTask(task, { status: 'succeeded', phase: 'completed', percent: 100, message: `三个服务已通过健康检查并运行 ${task.targetVersion}`, finishedAt: new Date().toISOString() });
    if (task.action === 'install') {
      try {
        if (task.backupTarget?.type === 's3') await s3Storage(task.backupTarget).prune();
        else {
          const backupDir = task.backupTarget?.type === 'local' && task.backupTarget.location ? task.backupTarget.location : join(stateDir, 'backups');
          await pruneBackups(backupDir);
        }
      } catch { console.error('旧备份清理失败；升级结果不受影响'); }
    }
  } catch (error) {
    let message = error instanceof Error ? error.message : '升级失败';
    if (activationStarted && task.action === 'install' && task.previousVersion) {
      try {
        const active = await currentRelease();
        if (active.version !== task.previousVersion) {
          await switchRelease('rollback', task.previousVersion);
          message += '；已切回旧版本';
        } else message += '；旧版本仍保持运行';
      } catch { message += '；自动恢复失败，请立即检查三个 systemd 服务'; }
    }
    await updateTask(task, { status: 'failed', phase: 'failed', percent: null, message, finishedAt: new Date().toISOString() });
  } finally {
    await rm(join(stateDir, 'downloads', task.taskId), { recursive: true, force: true });
    activeTask = null;
  }
}
function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}
function authorized(request) {
  const supplied = Buffer.from(request.headers.authorization || ''); const expected = Buffer.from('Bearer ' + token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function readBody(request) {
  let text = '';
  for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > 64 * 1024) throw new Error('request too large'); }
  return JSON.parse(text || '{}');
}

if (token.length < 32 || /replace-with|change-me|placeholder/i.test(token)) throw new Error('执行器需要至少 32 位非占位密钥');
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('发布仓库格式无效');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
try {
  for (const task of JSON.parse(await readFile(stateFile, 'utf8'))) {
    if (!task?.taskId) continue;
    if (['queued', 'running'].includes(task.status)) Object.assign(task, { status: 'failed', phase: 'interrupted', message: '执行器曾中断；请检查版本指针和数据库备份，不会自动重复切换' });
    tasks.set(task.taskId, task);
  }
} catch (error) { if (error.code !== 'ENOENT') throw new Error('执行器任务状态损坏，拒绝覆盖'); }
await persist();

const server = createServer(async (request, response) => {
  if (!authorized(request)) return json(response, 401, { message: 'unauthorized' });
  try {
    const path = request.url?.split('?')[0] || '/';
    if (request.method === 'GET' && path === '/v1/system-update/status') {
      let reason = null; let current = null;
      try { current = await ready(); } catch (error) { reason = error instanceof Error ? error.message : 'systemd 执行器未就绪'; }
      const latestTask = [...tasks.values()].at(-1) || null;
      return json(response, 200, { ready: !reason, reason, mode: 'systemd', currentVersion: current?.version || null, backupVersion: rollbackCandidates()[0]?.version || null, rollbackCandidates: current ? await releaseCandidates(current.version) : [], latestTask: safeTask(latestTask) });
    }
    if (request.method === 'POST' && path === '/v1/system-update/preflight') return json(response, 200, await preflight(await readBody(request)));
    if (request.method === 'POST' && path === '/v1/system-update/tasks') {
      const input = await readBody(request);
      if (!['install', 'rollback'].includes(input.action) || !validTag(input.targetVersion)) return json(response, 400, { message: 'invalid update task' });
      if (input.action === 'install' && (!safeReleaseUrl(input.release?.downloadUrl, input.targetVersion, 'kubenova-ubuntu.tar.gz') || !safeReleaseUrl(input.release?.checksumUrl, input.targetVersion, 'kubenova-ubuntu.tar.gz.sha256') || !safeReleaseUrl(input.release?.manifestUrl, input.targetVersion, 'release-manifest.json'))) return json(response, 400, { message: 'untrusted release assets' });
      if (input.action === 'install' && input.backupTarget && (!['local', 's3'].includes(input.backupTarget.type) || typeof input.backupTarget.location !== 'string' || !input.backupTarget.location.trim())) return json(response, 400, { message: 'invalid backup target' });
      const current = await ready();
      if (input.action === 'install' && compareVersions(input.targetVersion, current.version) <= 0) return json(response, 400, { message: '目标版本必须高于当前运行版本' });
      if (input.action === 'rollback' && !(await releaseCandidates(current.version)).some(item => item.version === input.targetVersion)) return json(response, 400, { message: '目标回滚版本不在已验证的旧版本目录中' });
      if (activeTask) return json(response, 409, { message: '已有升级任务正在运行' });
      const task = { taskId: randomUUID(), action: input.action, targetVersion: input.targetVersion, release: input.release, backupTarget: input.action === 'install' ? input.backupTarget : undefined, operator: String(input.operator || 'unknown').slice(0, 200), status: 'queued', phase: 'queued', percent: 0, message: null, createdAt: new Date().toISOString() };
      activeTask = task.taskId; tasks.set(task.taskId, task);
      try { await persist(); } catch (error) { activeTask = null; tasks.delete(task.taskId); throw error; }
      json(response, 202, safeTask(task));
      void runTask(task).catch(() => { console.error('systemd 更新任务状态持久化失败'); process.exit(1); });
      return;
    }
    const match = path.match(/^\/v1\/system-update\/tasks\/([^/]+)$/);
    if (request.method === 'GET' && match) { const task = tasks.get(decodeURIComponent(match[1])); return json(response, task ? 200 : 404, safeTask(task) || { message: 'task not found' }); }
    return json(response, 404, { message: 'not found' });
  } catch (error) {
    return json(response, 400, { message: error instanceof Error ? error.message : 'request failed' });
  }
});

if (socketPath) {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  try { const info = await lstat(socketPath); if (!info.isSocket()) throw new Error('socket 路径已被其他文件占用'); await rm(socketPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  server.listen(socketPath, async () => { await import('node:fs/promises').then(fs => fs.chmod(socketPath, 0o600)); console.log('systemd update executor listening on private Unix socket'); });
} else {
  server.listen(port, '127.0.0.1', () => console.log('systemd update executor listening on loopback:' + port));
}
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); });
