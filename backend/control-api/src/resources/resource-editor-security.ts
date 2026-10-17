import { BadRequestException } from '@nestjs/common';
import { createPrivateKey, X509Certificate } from 'node:crypto';

export const DEFAULT_INGRESS_CLASS = 'ingressclass.kubernetes.io/is-default-class';

export function validateTlsPair(certificate: unknown, privateKey: unknown) {
  if (typeof certificate !== 'string' || typeof privateKey !== 'string' ||
      Buffer.byteLength(certificate) + Buffer.byteLength(privateKey) > 900 * 1024) {
    throw new BadRequestException('证书与私钥必须是文本，合计不能超过 900 KiB');
  }
  try {
    const leaf = new X509Certificate(certificate);
    if (!leaf.checkPrivateKey(createPrivateKey(privateKey))) throw new Error('mismatch');
  } catch {
    throw new BadRequestException('证书或私钥格式无效，或二者不匹配');
  }
  return { valid: true as const };
}

export function validateSecretManifest(manifest: Record<string, any>) {
  if (manifest.kind !== 'Secret') return;
  const data = manifest.data ?? {};
  const stringData = manifest.stringData ?? {};
  if (![data, stringData].every(value => value && typeof value === 'object' && !Array.isArray(value)))
    throw new BadRequestException('Secret 数据必须为键值对象');
  const decoded: Record<string, Buffer> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
      throw new BadRequestException('Secret data 必须是有效的 Base64');
    decoded[key] = Buffer.from(value, 'base64');
  }
  for (const [key, value] of Object.entries(stringData)) {
    if (typeof value !== 'string') throw new BadRequestException('Secret stringData 必须是文本');
    decoded[key] = Buffer.from(value, 'utf8');
  }
  if (Object.values(decoded).reduce((size, value) => size + value.length, 0) > 900 * 1024)
    throw new BadRequestException('Secret 原始数据合计不能超过 900 KiB');
  if (manifest.type === 'kubernetes.io/tls')
    validateTlsPair(decoded['tls.crt']?.toString('utf8'), decoded['tls.key']?.toString('utf8'));
  if (manifest.type === 'kubernetes.io/dockerconfigjson') {
    try {
      const config = JSON.parse(decoded['.dockerconfigjson']?.toString('utf8') ?? '');
      if (!config.auths || typeof config.auths !== 'object' || Array.isArray(config.auths)) throw new Error('auths');
    } catch { throw new BadRequestException('镜像仓库凭据必须包含有效的 auths 配置'); }
  }
}

export function ingressClassReferences(name: string, ingresses: any[]) {
  return ingresses.filter(item => item.spec?.ingressClassName === name ||
    item.metadata?.annotations?.['kubernetes.io/ingress.class'] === name)
    .map(item => ({ name: String(item.metadata?.name ?? ''), namespace: String(item.metadata?.namespace ?? '') }));
}
