import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { scryptSync } from 'node:crypto';

describe('administrative reset step-up', () => {
  const actor = { token: 'session', authzVersion: 2, user: { id: 'owner', role: 'admin', username: 'owner', displayName: 'Owner' }, expiresAt: '' };
  function setup() {
    const user = { id: 'owner', isActive: true, role: 'admin', authzVersion: 2, mfaEnabled: false, passwordHash: `salt:${scryptSync('correct', 'salt', 64).toString('hex')}` };
    const session = { id: 'session', userId: 'owner', authzVersion: 2, user };
    const target = { id: 'target', authzVersion: 3, mfaEnabled: true, mfaCredential: { version: 4 } };
    const repo = { findValidSessionById: jest.fn(async () => session), findMfaResetTarget: jest.fn(async () => target) };
    const limiter = { consumeAccount: jest.fn(async () => {}) };
    const factors = { prepareChallenge: jest.fn(async () => ({ userId: 'owner', authzVersion: 2, enrollmentVersion: 5 })), redeem: jest.fn(async () => ({ mfaVersion: 5 })), reset: jest.fn(async () => ({ userId: 'target', mfaEnabled: false })) };
    const store = { save: jest.fn(async (identity) => ({ token: 'opaque', identity })), consume: jest.fn(async (_token, identity) => ({ ...identity, action: 'mfa-reset', expiresAt: Date.now() + 10000 })) };
    const provider = { completeReauthentication: jest.fn(async () => ({ issuer: 'https://issuer', subject: 'subject' })) };
    const identities = { subjectForUser: jest.fn(async () => 'subject') };
    const config = new ConfigService({ superadminUserId: 'owner' });
    const service = new (AuthService as any)(repo, {}, identities, limiter, {}, factors, undefined, config, store, provider);
    return { service, repo, session, user, target, limiter, factors, store, config, provider, identities };
  }
  it('issues target-bound proof after password and recheck without a session', async () => {
    const s = setup();
    expect(await s.service.prepareMfaReset(actor, 'target', 'correct')).toEqual({ token: 'opaque', identity: { actorUserId: 'owner', actorSessionId: 'session', actorAuthzVersion: 2, targetUserId: 'target', targetAuthzVersion: 3, targetMfaVersion: 4 } });
    expect(s.limiter.consumeAccount).toHaveBeenCalledWith('user:owner');
  });
  it('derives administrative capability from live designation and role', async () => {
    const s = setup();
    expect(await s.service.mfaStatus(actor)).toMatchObject({ canManageMfa: true });
    s.user.role = 'user';
    expect(await s.service.mfaStatus(actor)).toMatchObject({ canManageMfa: false });
    s.user.role = 'admin';
    s.config.set('superadminUserId', 'another-user');
    expect(await s.service.mfaStatus(actor)).toMatchObject({ canManageMfa: false });
  });
  it.each(['wrong-password', 'missing-designation', 'demoted', 'stale-session', 'missing-target', 'midflight-change', 'factor-fails'])('fails closed: %s', async mode => {
    const s = setup();
    if (mode === 'missing-designation') s.config.set('superadminUserId', 'other');
    if (mode === 'demoted') s.user.role = 'user';
    if (mode === 'stale-session') s.session.authzVersion = 1;
    if (mode === 'missing-target') s.repo.findMfaResetTarget.mockResolvedValue(null as never);
    if (mode === 'midflight-change') s.repo.findMfaResetTarget.mockResolvedValueOnce(s.target).mockResolvedValue({ ...s.target, authzVersion: 4 });
    if (mode === 'factor-fails') { s.user.mfaEnabled = true; s.factors.redeem.mockResolvedValue(null as never); }
    await expect(s.service.prepareMfaReset(actor, 'target', mode === 'wrong-password' ? 'wrong' : 'correct', { code: '123456', method: 'totp' })).rejects.toBeDefined();
    expect(s.store.save).not.toHaveBeenCalled();
  });
  it('requires fresh second factor for an enrolled actor', async () => {
    const s = setup(); s.user.mfaEnabled = true;
    await expect(s.service.prepareMfaReset(actor, 'target', 'correct')).rejects.toBeDefined();
    await s.service.prepareMfaReset(actor, 'target', 'correct', { code: '123456', method: 'totp' });
    expect(s.factors.redeem).toHaveBeenCalledWith({ userId: 'owner', authzVersion: 2, enrollmentVersion: 5 }, '123456', 'totp');
  });
  it('consumes proof against fresh identity before atomic reset', async () => {
    const s = setup();
    expect(await s.service.confirmMfaReset(actor, 'target', 'opaque')).toEqual({ userId: 'target', mfaEnabled: false });
    s.store.consume.mockRejectedValueOnce(new Error('replayed'));
    await expect(s.service.confirmMfaReset(actor, 'target', 'opaque')).rejects.toThrow('replayed');
    expect(s.factors.reset).toHaveBeenCalledTimes(1);
  });
  it('OIDC completion invokes trusted provider with reset context and still requires factor', async () => {
    const s = setup(); s.user.mfaEnabled = true;
    await s.service.finishOidcMfaReset(actor, 'target', { issuer: 'https://issuer' }, 'secret', new URL('https://console/callback'), 'binding', { code: '123456', method: 'totp' });
    expect(s.provider.completeReauthentication).toHaveBeenCalledWith({ issuer: 'https://issuer' }, 'secret', expect.any(URL), 'binding', { userId: 'owner', sessionId: 'session', authzVersion: 2, subject: 'subject', purpose: 'mfa-reset', targetUserId: 'target', targetAuthzVersion: 3, targetMfaVersion: 4 });
    expect(s.factors.redeem).toHaveBeenCalledTimes(1);
  });
  it.each(['provider-rejection', 'wrong-issuer', 'wrong-subject', 'logout-during-provider', 'target-change-during-provider', 'missing-factor'])('OIDC rejects %s without proof', async mode => {
    const s = setup();
    s.provider.completeReauthentication.mockImplementation(async () => {
      if (mode === 'provider-rejection') throw Error('invalid signed identity');
      if (mode === 'logout-during-provider') s.repo.findValidSessionById.mockResolvedValue(null as never);
      if (mode === 'target-change-during-provider') s.repo.findMfaResetTarget.mockResolvedValue({ ...s.target, authzVersion: 9 });
      return { issuer: mode === 'wrong-issuer' ? 'https://other' : 'https://issuer', subject: mode === 'wrong-subject' ? 'other' : 'subject' };
    });
    if (mode === 'missing-factor') s.user.mfaEnabled = true;
    await expect(s.service.finishOidcMfaReset(actor, 'target', { issuer: 'https://issuer' }, 'secret', new URL('https://console/callback'), 'binding')).rejects.toBeDefined();
    expect(s.store.save).not.toHaveBeenCalled();
  });
  it('blocks password attempts when the shared account budget is exhausted', async () => {
    const s = setup(); s.limiter.consumeAccount.mockRejectedValueOnce(new Error('rate limited'));
    await expect(s.service.prepareMfaReset(actor, 'target', 'correct')).rejects.toThrow('rate limited');
    expect(s.store.save).not.toHaveBeenCalled();
  });
  it('uses recovery redemption without creating a login session', async () => {
    const s = setup(); s.user.mfaEnabled = true;
    await s.service.prepareMfaReset(actor, 'target', 'correct', { code: 'recovery', method: 'recovery' });
    expect(s.factors.redeem).toHaveBeenCalledWith({ userId: 'owner', authzVersion: 2, enrollmentVersion: 5 }, 'recovery', 'recovery');
    expect(s.store.save).toHaveBeenCalledTimes(1);
  });
  it('rejects atomic reset failure after consuming the proof', async () => {
    const s = setup(); s.factors.reset.mockResolvedValueOnce(null as never);
    await expect(s.service.confirmMfaReset(actor, 'target', 'opaque')).rejects.toMatchObject({ status: 401 });
  });
  it.each(['actor', 'target'])('rejects %s changes while the fresh factor is awaited', async changed => {
    const s = setup(); s.user.mfaEnabled = true;
    s.factors.redeem.mockImplementation(async () => {
      if (changed === 'actor') s.repo.findValidSessionById.mockResolvedValue({ ...s.session, user: { ...s.user, role: 'user' } });
      else s.repo.findMfaResetTarget.mockResolvedValue({ ...s.target, mfaCredential: { version: 8 } });
      return { mfaVersion: 5 };
    });
    await expect(s.service.prepareMfaReset(actor, 'target', 'correct', { code: '123456', method: 'totp' })).rejects.toMatchObject({ status: 401 });
    expect(s.store.save).not.toHaveBeenCalled();
  });
  it('does not use the supplied role as authority', async () => {
    const s = setup();
    await expect(s.service.prepareMfaReset({ ...actor, user: { ...actor.user, role: 'user' } }, 'target', 'correct')).resolves.toMatchObject({ token: 'opaque' });
  });
  it.each(['password-null', 'disabled', 'post-password-logout', 'post-password-change', 'limiter-unavailable'])('rejects %s', async reason => {
    const s = setup();
    if (reason === 'password-null') s.user.passwordHash = null as never;
    if (reason === 'disabled') s.user.isActive = false;
    if (reason === 'post-password-logout') s.repo.findValidSessionById.mockResolvedValueOnce(s.session).mockResolvedValue(null as never);
    if (reason === 'post-password-change') s.repo.findValidSessionById.mockResolvedValueOnce(s.session).mockResolvedValue({ ...s.session, user: { ...s.user, passwordHash: 'changed' } });
    if (reason === 'limiter-unavailable') s.service.loginLimiter = undefined;
    await expect(s.service.prepareMfaReset(actor, 'target', 'correct')).rejects.toMatchObject({ status: reason === 'limiter-unavailable' ? 503 : 401 });
    expect(s.store.save).not.toHaveBeenCalled();
  });
  it('rejects an external binding change after provider verification', async () => {
    const s = setup();
    s.identities.subjectForUser.mockResolvedValueOnce('subject').mockResolvedValue('new-subject');
    await expect(s.service.finishOidcMfaReset(actor, 'target', { issuer: 'https://issuer' }, 'secret', new URL('https://console/callback'), 'binding')).rejects.toMatchObject({ status: 401 });
    expect(s.store.save).not.toHaveBeenCalled();
  });
});
