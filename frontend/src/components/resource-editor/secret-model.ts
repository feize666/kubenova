import { getManifestValue, setManifestValue, type ResourceManifest } from '@/lib/resource-editor';
import { isRecord } from './native-model';

export const SECRET_TYPES = ['Opaque', 'kubernetes.io/dockerconfigjson', 'kubernetes.io/tls'];
export type SecretFile = { name: string; bytes: Uint8Array };
export type FileDecision = { action: 'overwrite' | 'skip' | 'rename'; key?: string };
const encoder = new TextEncoder();

export function encodeSecretBytes(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(text);
}

export function secretText(value: ResourceManifest, key: string): string {
  const plain = getManifestValue(value, ['stringData', key]);
  if (typeof plain === 'string') return plain;
  const encoded = getManifestValue(value, ['data', key]);
  if (typeof encoded !== 'string') return '';
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), character => character.charCodeAt(0))); }
  catch { throw new Error('已有数据不是有效的文本，请使用 YAML 保留原始二进制内容'); }
}

export function secretRawBytes(value: ResourceManifest): number {
  const data = isRecord(value.data) ? value.data : {};
  const plain = isRecord(value.stringData) ? value.stringData : {};
  let total = 0;
  for (const [key, item] of Object.entries(data)) {
    if (Object.hasOwn(plain, key)) continue;
    if (typeof item !== 'string') throw new Error('Secret data 必须是 base64 字符串映射');
    try { total += atob(item).length; } catch { throw new Error('Secret data 包含无效 base64'); }
  }
  for (const item of Object.values(plain)) {
    if (typeof item !== 'string') throw new Error('Secret stringData 必须是字符串映射');
    total += encoder.encode(item).length;
  }
  return total;
}

export function validateSecretSize(value: ResourceManifest): void {
  if (secretRawBytes(value) > 900 * 1024) throw new Error('Secret 原始数据总量不能超过 900 KiB');
}

export function applySecretFiles(value: ResourceManifest, files: SecretFile[], decisions: Record<string, FileDecision> = {}): ResourceManifest {
  if (files.length > 50) throw new Error('每次最多上传 50 个文件');
  let next = value;
  for (const file of files) {
    if (file.bytes.length > 1024 * 1024) throw new Error('单文件大小不能超过 1 MiB');
    const decision = decisions[file.name];
    if (decision?.action === 'skip') continue;
    const key = decision?.action === 'rename' ? decision.key ?? '' : file.name;
    if (!/^[A-Za-z0-9._-]+$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('文件键名只能包含字母、数字、点、下划线和短横线');
    const exists = getManifestValue(next, ['data', key]) !== undefined || getManifestValue(next, ['stringData', key]) !== undefined;
    if (exists && decision?.action !== 'overwrite') throw new Error(`键 ${key} 已存在，请选择覆盖、跳过或重命名`);
    next = setManifestValue(next, ['data', key], encodeSecretBytes(file.bytes));
    next = setManifestValue(next, ['stringData', key], undefined);
  }
  validateSecretSize(next);
  return next;
}

export function dockerConfig(value: ResourceManifest): Record<string, unknown> {
  const text = secretText(value, '.dockerconfigjson');
  if (!text) return { auths: {} };
  let config: unknown;
  try { config = JSON.parse(text); } catch { throw new Error('Docker 配置文件不是有效 JSON'); }
  if (!isRecord(config) || !isRecord(config.auths)) throw new Error('Docker 配置必须包含 auths 对象');
  return config;
}

export function setDockerCredentials(value: ResourceManifest, registry: string, username: string, password: string): ResourceManifest {
  if (!registry.trim()) throw new Error('请填写镜像仓库地址');
  if (!username || username.includes(':')) throw new Error('请填写有效用户名，用户名不能包含冒号');
  if (!password) throw new Error('请填写镜像仓库密码');
  if (['__proto__', 'constructor', 'prototype'].includes(registry.trim())) throw new Error('镜像仓库地址无效');
  const config = dockerConfig(value);
  const auths = config.auths as Record<string, unknown>;
  const entry: Record<string, unknown> = isRecord(auths[registry.trim()]) ? auths[registry.trim()] as Record<string, unknown> : {};
  const text = JSON.stringify({ ...config, auths: { ...auths, [registry.trim()]: { ...entry, username, password, auth: encodeSecretBytes(encoder.encode(`${username}:${password}`)) } } });
  const next = setManifestValue(value, ['stringData', '.dockerconfigjson'], text);
  validateSecretSize(next);
  return next;
}

export function validatePem(certificate: string, privateKey: string): void {
  if (!/^-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----/.test(certificate.trim())) throw new Error('证书需要 PEM CERTIFICATE 格式');
  if (!/^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+-----END (?:RSA |EC )?PRIVATE KEY-----$/.test(privateKey.trim())) throw new Error('私钥需要 PEM PRIVATE KEY 格式');
}
