import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret, hashRecoveryCode, totpCode, verifyTotp } from './mfa-totp';

describe('TOTP helpers', () => {
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
