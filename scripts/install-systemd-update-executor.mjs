#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { mkdir, lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { request } from 'node:http';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const exec = promisify(execFile);
const { values } = parseArgs({ options: {
  'prepare-only': { type: 'boolean' }, root: { type: 'string' }, 'release-base': { type: 'string' },
  'config-dir': { type: 'string' }, 'unit-dir': { type: 'string' }, 'runtime-dir': { type: 'string' }, 'state-dir': { type: 'string' },
} });
const prepareOnly = values['prepare-only'] === true;
if (!prepareOnly && (process.platform !== 'linux' || process.getuid?.() !== 0)) throw new Error('systemd 更新执行器安装需要 Linux root；可用 --prepare-only 校验配置');

const releaseBase = resolve(values['release-base'] || '/opt/kubenova');
const root = resolve(values.root || join(releaseBase, 'current'));
const configDir = resolve(values['config-dir'] || '/etc/kubenova');
const unitDir = resolve(values['unit-dir'] || '/etc/systemd/system');
const runtimeDir = resolve(values['runtime-dir'] || '/run/kubenova-update');
const stateDir = resolve(values['state-dir'] || '/var/lib/kubenova/update-executor');
const hostEnvFile = join(configDir, 'update-executor.env');
const apiEnvFile = join(configDir, 'control-api.env');
const unitFile = join(unitDir, 'kubenova-update-executor.service');
for (const path of [releaseBase, root, configDir, unitDir, runtimeDir, stateDir]) {
  if (/[\s'"\\$%]/.test(path)) throw new Error('部署路径不得包含空白、引号或 shell/systemd 特殊字符');
}

async function readRegularFile(path, optional = false) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error('配置必须是普通文件，拒绝覆盖符号链接：' + path);
    return await readFile(path, 'utf8');
  } catch (error) {
    if (optional && error.code === 'ENOENT') return '';
    throw error;
  }
}
const readValue = (content, key) => content.split(/\r?\n/).find(line => line.startsWith(key + '='))?.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2') || '';
function setValue(content, key, value) {
  const lines = content.split(/\r?\n/);
  let found = false;
  const output = lines.flatMap(line => {
    if (!line.startsWith(key + '=')) return [line];
    if (found) return [];
    found = true;
    return [key + '=' + value];
  });
  if (!found) output.push(key + '=' + value);
  return output.join('\n').replace(/\n*$/, '\n');
}
async function atomicWrite(path, content, mode) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await readRegularFile(path, true);
  const temp = path + '.' + randomBytes(6).toString('hex') + '.tmp';
  await writeFile(temp, content, { flag: 'wx', mode });
  await rename(temp, path);
}

const hostContent = await readRegularFile(hostEnvFile, true);
const apiContent = await readRegularFile(apiEnvFile, true);
const existingTokens = [readValue(hostContent, 'KUBENOVA_UPDATE_EXECUTOR_TOKEN'), readValue(apiContent, 'KUBENOVA_UPDATE_EXECUTOR_TOKEN')].filter(Boolean);
if (existingTokens.some(token => token.length < 32 || /replace-with|change-me|placeholder/i.test(token))) throw new Error('现有执行器密钥无效；拒绝覆盖，请先核对配置');
if (new Set(existingTokens).size > 1) throw new Error('执行器密钥冲突；拒绝覆盖，请先核对配置');
const token = existingTokens[0] || randomBytes(32).toString('hex');
const existingEncryptionKey = readValue(apiContent, 'KUBENOVA_UPDATE_ENCRYPTION_KEY');
if (existingEncryptionKey && !/^[a-f0-9]{64}$/i.test(existingEncryptionKey)) throw new Error('更新设置加密密钥无效；拒绝覆盖，请先核对配置');
const encryptionKey = existingEncryptionKey || randomBytes(32).toString('hex');
const socketPath = join(runtimeDir, 'executor.sock');
const repository = readValue(hostContent, 'KUBENOVA_UPDATE_REPOSITORY') || readValue(apiContent, 'KUBENOVA_UPDATE_REPOSITORY') || 'feize666/kubenova';
const hostValues = {
  KUBENOVA_UPDATE_EXECUTOR_SOCKET: socketPath,
  KUBENOVA_UPDATE_EXECUTOR_TOKEN: token,
  KUBENOVA_UPDATE_REPOSITORY: repository,
  KUBENOVA_UPDATE_RELEASE_BASE: releaseBase,
  KUBENOVA_UPDATE_CONFIG_DIR: configDir,
  KUBENOVA_UPDATE_STATE_DIR: stateDir,
  KUBENOVA_UPDATE_MIGRATION_TEST_COMMAND: readValue(hostContent, 'KUBENOVA_UPDATE_MIGRATION_TEST_COMMAND'),
  KUBENOVA_UPDATE_OLD_VERSION_COMPATIBILITY_COMMAND: readValue(hostContent, 'KUBENOVA_UPDATE_OLD_VERSION_COMPATIBILITY_COMMAND'),
};
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(hostValues.KUBENOVA_UPDATE_REPOSITORY)) throw new Error('更新仓库格式无效');
const clientValues = {
  KUBENOVA_UPDATE_EXECUTOR_SOCKET: '/run/kubenova-update/executor.sock',
  KUBENOVA_UPDATE_EXECUTOR_TOKEN: token,
  KUBENOVA_UPDATE_REPOSITORY: repository,
};
const serialize = object => Object.entries(object).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
let nextApiContent = apiContent;
for (const [key, value] of Object.entries(clientValues)) nextApiContent = setValue(nextApiContent, key, value);
nextApiContent = setValue(nextApiContent, 'KUBENOVA_UPDATE_ENCRYPTION_KEY', encryptionKey);
const unit = `[Unit]
Description=KubeNova systemd release update executor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${root}
EnvironmentFile=${hostEnvFile}
ExecStart=/usr/bin/node ${root}/scripts/systemd-update-executor.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${releaseBase} ${stateDir} ${runtimeDir}

[Install]
WantedBy=multi-user.target
`;

if (!prepareOnly) {
  await exec('test', ['-f', join(root, 'scripts/systemd-update-executor.mjs')]);
  await exec('test', ['-f', join(root, 'scripts/prod.sh')]);
}
await mkdir(configDir, { recursive: true, mode: 0o700 });
await atomicWrite(hostEnvFile, serialize(hostValues), 0o600);
await atomicWrite(apiEnvFile, nextApiContent, 0o600);
await atomicWrite(unitFile, unit, 0o644);

if (!prepareOnly) {
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await exec('systemctl', ['daemon-reload']);
  await exec('systemctl', ['enable', '--now', 'kubenova-update-executor.service']);
  const requestStatus = () => new Promise((resolveRequest, reject) => {
    const req = request({ socketPath, path: '/v1/system-update/status', headers: { authorization: 'Bearer ' + token } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try { const status = JSON.parse(body); if (response.statusCode !== 200 || status.mode !== 'systemd') throw new Error(status.reason || '执行器状态响应无效'); resolveRequest(status); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('执行器状态查询超时')));
    req.on('error', reject);
    req.end();
  });
  await requestStatus();
  let apiActive = true;
  try { await exec('systemctl', ['is-active', '--quiet', 'kubenova-control-api.service']); }
  catch { apiActive = false; }
  if (apiActive) await exec('systemctl', ['restart', 'kubenova-control-api.service']);
}

console.log(prepareOnly ? '配置已准备完成，未启动服务。' : 'systemd 一键升级执行器已安装并通过就绪检查。');
