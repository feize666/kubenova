import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret, hashRecoveryCode, totpCode, verifyTotp } from './mfa-totp';

describe('TOTP helpers', () => {
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  it.each([[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']])('matches RFC 6238 SHA-1 at %s seconds', (seconds, code) => {
    expect(totpCode(rfcSecret, Number(seconds) * 1000)).toBe(code);
  });

  it.each(['', ' ', 'A', 'ABC', 'AB', 'MZ======', 'M!======'])('rejects invalid base32 secret %j', secret => {
    expect(() => totpCode(secret, 59000)).toThrow();
  });

  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid timestamp %s', timestamp => {
    expect(() => totpCode(rfcSecret, timestamp)).toThrow();
    expect(() => verifyTotp(rfcSecret, '287082', timestamp)).toThrow();
  });

  it.each([-1, 0.5, NaN, Infinity, 11])('rejects invalid verification window %s', window => {
    expect(() => verifyTotp(rfcSecret, '287082', 59000, window)).toThrow();
  });

  it('verifies at the epoch without evaluating negative counters', () => {
    expect(verifyTotp(rfcSecret, '755224', 0)).toBe(true);
  });

  it('accepts canonical padded base32 and lowercase secrets', () => {
    expect(totpCode('MY======', 59000)).toBe(totpCode('MY', 59000));
    expect(totpCode(rfcSecret.toLowerCase(), 59000)).toBe('287082');
  });

  it.each(['', '   '])('rejects empty encryption key %j', key => {
    expect(() => encryptMfaSecret(rfcSecret, key)).toThrow();
    const payload = encryptMfaSecret(rfcSecret, 'test-key');
    expect(() => decryptMfaSecret(payload, key)).toThrow();
  });

  it('rejects extra envelope fields and noncanonical base64url', () => {
    const payload = encryptMfaSecret(rfcSecret, 'test-key');
    expect(() => decryptMfaSecret(`${payload}.extra`, 'test-key')).toThrow();
    expect(() => decryptMfaSecret(payload.replace('v1.', 'v1.!'), 'test-key')).toThrow();
    const parts = payload.split('.');
    parts[2] = parts[2].slice(0, 16);
    expect(() => decryptMfaSecret(parts.join('.'), 'test-key')).toThrow();
  });
  it('generates and verifies codes with clock skew', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now), now + 30_000)).toBe(true);
    expect(verifyTotp(secret, '000000', now, 0)).toBe(false);
  });

  it('round trips encrypted secrets and hashes recovery codes', () => {
    const secret = generateTotpSecret();
    expect(decryptMfaSecret(encryptMfaSecret(secret, 'local-test-key'), 'local-test-key')).toBe(secret);
    expect(() => decryptMfaSecret(encryptMfaSecret(secret, 'local-test-key'), 'wrong-key')).toThrow();
    expect(hashRecoveryCode('abc')).toHaveLength(64);
  });
});
