import { ConfigService } from '@nestjs/config';
import { MfaCredentialRepository } from './mfa-credential.repository';
import { encryptMfaSecret, hashRecoveryCode, totpCode } from './mfa-totp';

describe('MFA credential redemption', () => {
  it('prepares a challenge only from a current confirmed credential', async () => {
    const query = jest.fn(async () => [{ userId: 'u', authzVersion: 2, enrollmentVersion: 3 }]);
    const repo = new MfaCredentialRepository({ $queryRaw: query } as never, new ConfigService());
    expect(await repo.prepareChallenge('u', 2)).toEqual({ userId: 'u', authzVersion: 2, enrollmentVersion: 3 });
    query.mockResolvedValue([]);
    expect(await repo.prepareChallenge('u', 2)).toBeNull();
  });
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const key = 'test-only-mfa-key';
  const challenge = { userId: 'u', authzVersion: 2, enrollmentVersion: 3 };
  function setup() {
    const row = { encryptedSecret: encryptMfaSecret(secret, key), version: 3, lastTotpCounter: null, recoveryCodeHashes: [hashRecoveryCode('recovery-test')] };
    const db = { $queryRaw: jest.fn(async () => [row]), $executeRaw: jest.fn(async () => 1) };
    return { db, row, repo: new MfaCredentialRepository(db as never, new ConfigService({ MFA_ENCRYPTION_KEY: key })) };
  }
  it('returns assurance only after a valid TOTP was atomically consumed', async () => {
    const { repo } = setup();
    expect(await repo.redeem(challenge, totpCode(secret), 'totp')).toEqual({ mfaVersion: 3, mfaVerifiedAt: expect.any(Date) });
  });
  it('uses the validated configuration key for TOTP verification before raw environment fallback', async () => {
    const { db } = setup();
    const repo = new MfaCredentialRepository(db as never, new ConfigService({ mfaEncryptionKey: key, MFA_ENCRYPTION_KEY: 'wrong-raw-key' }));
    expect(await repo.redeem(challenge, totpCode(secret), 'totp')).toMatchObject({ mfaVersion: 3 });
  });
  it('consumes a matching recovery code without decrypting the TOTP secret', async () => {
    const { repo, row } = setup();
    row.encryptedSecret = 'unavailable';
    expect(await repo.redeem(challenge, 'recovery-test', 'recovery')).toEqual({ mfaVersion: 3, mfaVerifiedAt: expect.any(Date) });
  });
  it('rejects a lost compare-and-set race', async () => {
    const { repo, db } = setup();
    db.$executeRaw.mockResolvedValue(0);
    expect(await repo.redeem(challenge, totpCode(secret), 'totp')).toBeNull();
  });
  it('rejects a missing, disabled or stale credential', async () => {
    const { repo, db } = setup();
    db.$queryRaw.mockResolvedValue([]);
    expect(await repo.redeem(challenge, totpCode(secret), 'totp')).toBeNull();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it.each(['', 'invalid', '1234567'])('does not write for invalid code %s', async code => {
    const { repo, db } = setup();
    expect(await repo.redeem(challenge, code, 'totp')).toBeNull();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('does not create a session for a stale challenge', async () => {
    const create = jest.fn();
    const tx = { $queryRaw: async () => [], session: { create } };
    const repo = new MfaCredentialRepository({ $transaction: async (fn: any) => fn(tx) } as never, new ConfigService());
    expect(await repo.redeemAndCreateSession(challenge, '123456', 'totp', {
      refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 60000), refreshExpiresAt: new Date(Date.now() + 120000),
    })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...challenge, userId: ' u ' }, { ...challenge, enrollmentVersion: 0 }])('rejects malformed challenge before a transaction: %p', async invalid => {
    const transaction = jest.fn();
    const repo = new MfaCredentialRepository({ $transaction: transaction } as never, new ConfigService());
    expect(await repo.redeemAndCreateSession(invalid as never, '123456', 'totp', {
      refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 60000), refreshExpiresAt: new Date(Date.now() + 120000),
    })).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });
});
