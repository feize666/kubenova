import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const PERIOD = 30;
const DIGITS = 6;

function base32Decode(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  if (!/^[A-Z2-7]+={0,6}$/i.test(value)) throw new Error('invalid MFA secret');
  const input = value.toUpperCase().replace(/=+$/, '');
  if (![0, 2, 4, 5, 7].includes(input.length % 8) || (value.includes('=') && value.length % 8 !== 0)) throw new Error('invalid MFA secret');
  let bits = 0; let buffer = 0; const out: number[] = [];
  for (const char of input) {
    const n = alphabet.indexOf(char);
    if (n < 0) throw new Error('invalid MFA secret');
    buffer = (buffer << 5) | n; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 255); }
  }
  if (!out.length || (buffer & ((1 << bits) - 1)) !== 0) throw new Error('invalid MFA secret');
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  const bytes = randomBytes(20); const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = ''; let bits = 0; let buffer = 0;
  for (const byte of bytes) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; result += alphabet[(buffer >> bits) & 31]; } }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}

export function totpCode(secret: string, timestamp = Date.now()): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('invalid MFA timestamp');
  const counter = Math.floor(timestamp / 1000 / PERIOD); const data = Buffer.alloc(8);
  data.writeBigUInt64BE(BigInt(counter)); const digest = createHmac('sha1', base32Decode(secret)).update(data).digest();
  const offset = digest[digest.length - 1] & 15; const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(DIGITS, '0');
}

export function verifyTotp(secret: string, code: string, timestamp = Date.now(), window = 1): boolean {
  return matchTotpCounter(secret, code, timestamp, window) !== null;
}

export function matchTotpCounter(secret: string, code: string, timestamp = Date.now(), window = 1): number | null {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('invalid MFA timestamp');
  if (!Number.isInteger(window) || window < 0 || window > 10) throw new Error('invalid MFA window');
  base32Decode(secret);
  if (!/^\d{6}$/.test(code)) return null;
  // Prefer the newest collision so advancing time cannot redeem the same code again.
  for (let delta = window; delta >= -window; delta--) {
    const candidateTime = timestamp + delta * PERIOD * 1000;
    if (candidateTime < 0 || !Number.isSafeInteger(candidateTime)) continue;
    const expected = totpCode(secret, candidateTime);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return Math.floor(candidateTime / 1000 / PERIOD);
  }
  return null;
}

export function encryptMfaSecret(secret: string, key: string): string {
  if (!key.trim()) throw new Error('missing MFA encryption key');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptMfaSecret(payload: string, key: string): string {
  if (!key.trim()) throw new Error('missing MFA encryption key');
  const parts = payload.split('.');
  const [version, iv, tag, data] = parts;
  if (parts.length !== 4 || version !== 'v1' || !iv || !tag || !data ||
      [iv, tag, data].some(value => Buffer.from(value, 'base64url').toString('base64url') !== value) ||
      Buffer.from(iv, 'base64url').length !== 12 || Buffer.from(tag, 'base64url').length !== 16) throw new Error('invalid MFA secret');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export function hashRecoveryCode(code: string): string { return createHash('sha256').update(code).digest('hex'); }
