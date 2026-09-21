import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { MfaChallengeStore } from './mfa-challenge.store';

describe('MFA challenge completion', () => {
  it('returns only a challenge for an MFA-enabled external identity', async () => {
    const createSession = jest.fn();
    const save = jest.fn(async () => 'opaque-challenge');
    const identity = { resolve: async () => ({ id: 'u', isActive: true, mfaEnabled: true, authzVersion: 2 }) };
    const prepareChallenge = jest.fn(async () => ({ userId: 'u', authzVersion: 2, enrollmentVersion: 3 }));
    const service = new AuthService({ createSession } as never, new TokenService(new ConfigService()), identity as never, undefined, { save } as never, { prepareChallenge } as never);
    expect(await service.loginExternal('https://issuer.test', 'subject')).toEqual({ mfaRequired: true, challengeToken: 'opaque-challenge', expiresIn: 300 });
    expect(createSession).not.toHaveBeenCalled();
  });
  it('routes MFA refresh exclusively through assurance-preserving rotation', async () => {
    const expiresAt = new Date(Date.now() + 60000);
    const legacyRotate = jest.fn();
    const rotateSession = jest.fn(async () => ({ id: 'new-session', expiresAt }));
    const repository = { findValidSessionByRefreshTokenHash: async () => ({ id: 'old', userId: 'u', authzVersion: 2, refreshExpiresAt: expiresAt, user: { id: 'u', email: 'reader', role: 'user', authzVersion: 2, mfaEnabled: true } }), rotateSession: legacyRotate };
    const service = new AuthService(repository as never, new TokenService(new ConfigService()), undefined, undefined, undefined, { rotateSession } as never);
    expect((await service.refresh('refresh-token'))?.token).toBe('new-session');
    expect(rotateSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'old', userId: 'u', authzVersion: 2 }));
    expect(legacyRotate).not.toHaveBeenCalled();
  });
  it.each([true, false])('validates persisted MFA assurance only when current (%s)', async current => {
    const session = { id: 's', authzVersion: 2, expiresAt: new Date(Date.now() + 60000), user: { id: 'u', email: 'reader', role: 'user', authzVersion: 2, mfaEnabled: true } };
    const hasSessionAssurance = jest.fn(async () => current);
    const service = new AuthService({ findValidSessionById: async () => session } as never, new TokenService(new ConfigService()), undefined, undefined, undefined, { hasSessionAssurance } as never);
    const result = await service.validate('s');
    expect(Boolean(result)).toBe(current);
    expect(hasSessionAssurance).toHaveBeenCalledWith('s', 'u', 2);
  });
  function setup(success = true) {
    let value: string | null = JSON.stringify({ userId: 'u', authzVersion: 2, enrollmentVersion: 1 });
    const store = new MfaChallengeStore({ getdel: async () => { const result = value; value = null; return result; } } as never);
    const redeemAndCreateSession = jest.fn(async () => success ? {
      session: { id: 'verified-session', expiresAt: new Date(Date.now() + 60000) },
      user: { id: 'u', email: 'reader', name: null, role: 'user' },
    } : null);
    const service = new (AuthService as any)({}, new TokenService(new ConfigService()), undefined, undefined, store, { redeemAndCreateSession });
    return { service, redeemAndCreateSession };
  }
  it('returns tokens only after verified atomic issuance and consumes challenge once', async () => {
    const { service, redeemAndCreateSession } = setup();
    const result = await service.completeMfa('a'.repeat(43), '123456', 'totp');
    expect(result.token).toBe('verified-session');
    expect(result.user.username).toBe('reader');
    expect(redeemAndCreateSession).toHaveBeenCalledWith({ userId: 'u', authzVersion: 2, enrollmentVersion: 1 }, '123456', 'totp', expect.objectContaining({ refreshTokenHash: expect.any(String) }));
    await expect(service.completeMfa('a'.repeat(43), '123456', 'totp')).rejects.toMatchObject({ status: 401 });
    expect(redeemAndCreateSession).toHaveBeenCalledTimes(1);
  });
  it('invalid code consumes challenge without returning a session', async () => {
    const { service, redeemAndCreateSession } = setup(false);
    expect(await service.completeMfa('a'.repeat(43), 'wrong', 'totp')).toBeNull();
    await expect(service.completeMfa('a'.repeat(43), '123456', 'totp')).rejects.toMatchObject({ status: 401 });
    expect(redeemAndCreateSession).toHaveBeenCalledTimes(1);
  });
});
