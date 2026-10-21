import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyBytes(rawKey: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(rawKey))
    throw new Error('KUBENOVA_UPDATE_ENCRYPTION_KEY must be 64 hexadecimal characters');
  return Buffer.from(rawKey, 'hex');
}

export function encryptUpdateSettings(value: unknown, rawKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(rawKey), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptUpdateSettings<T>(envelope: string, rawKey: string): T {
  const [version, iv, tag, data, extra] = envelope.split('.');
  if (version !== 'v1' || !iv || !tag || !data || extra !== undefined)
    throw new Error('Invalid update settings ciphertext envelope');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(rawKey), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as T;
}
