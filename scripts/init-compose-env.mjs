#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, chmod } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const file = path.resolve(process.argv[2] || path.join(root, 'deploy/docker/.env'));
let existing;
try { existing = await lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing) {
  if (!existing.isFile()) throw new Error('环境文件必须是普通文件，拒绝符号链接');
  await chmod(file, 0o600);
  console.log('保留已有环境配置和密钥；未重新生成或覆盖任何值。');
} else {
  let content = await readFile(path.join(root, 'deploy/docker/.env.example'), 'utf8');
  for (const name of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'RUNTIME_TOKEN_SECRET', 'RUNTIME_GATEWAY_INTERNAL_SECRET', 'AI_CREDENTIAL_ENCRYPTION_KEY', 'DEFAULT_ADMIN_PASSWORD']) {
    content = content.replace(new RegExp('^' + name + '=.*$', 'm'), name + '=' + randomBytes(32).toString('hex'));
  }
  const version = (await readFile(path.join(root, 'VERSION'), 'utf8')).trim().replace(/^v/, '');
  content = content.replace(/^KUBENOVA_IMAGE_TAG=.*$/m, 'KUBENOVA_IMAGE_TAG=v' + version);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, content, { flag: 'wx', mode: 0o600 });
  console.log('已生成私有环境文件：' + file + '；包含随机初始管理员密码和独立服务密钥，请安全保管。域名和第三方凭据仍需填写。');
}
