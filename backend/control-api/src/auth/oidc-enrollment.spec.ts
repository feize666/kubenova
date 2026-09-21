import { AuthService } from './auth.service';

describe('OIDC enrollment session handoff', () => {
  const actor = { token: 'session', user: { id: 'user' }, authzVersion: 3 } as never;
  function setup() {
    const session = { id: 'session', userId: 'user', authzVersion: 3, user: { authzVersion: 3, mfaEnabled: false } };
    const repository = { findValidSessionById: jest.fn().mockResolvedValue(session) };
    const external = { subjectForUser: jest.fn().mockResolvedValue('subject') };
    const limiter = { consumeAccount: jest.fn().mockResolvedValue(undefined) };
    const enrollments = { save: jest.fn().mockResolvedValue({ token: 'pending', secret: 'secret' }) };
    const service = new AuthService(repository as never, {} as never, external as never, limiter as never, undefined, undefined, enrollments as never) as any;
    return { service, repository, external, limiter, enrollments, session };
  }
  it('derives the external identity from a live session and rate limits starts', async () => {
    const { service, limiter } = setup();
    expect(await service.oidcEnrollmentContext(actor, 'https://issuer', true)).toEqual({ userId: 'user', sessionId: 'session', authzVersion: 3, subject: 'subject' });
    expect(limiter.consumeAccount).toHaveBeenCalledWith('user:user');
  });
  it('returns only pending enrollment after matching the freshly rechecked identity', async () => {
    const { service } = setup();
    expect(await service.finishOidcEnrollment(actor, 'https://issuer', { userId: 'user', sessionId: 'session', authzVersion: 3, subject: 'subject' })).toEqual({ token: 'pending', secret: 'secret', expiresIn: 300 });
  });
  it.each(['revoked', 'subject', 'version'])('rejects a %s session or identity after exchange', async reason => {
    const { service, repository, external, session, enrollments } = setup();
    if (reason === 'revoked') repository.findValidSessionById.mockResolvedValue(null);
    if (reason === 'subject') external.subjectForUser.mockResolvedValue('changed');
    if (reason === 'version') session.user.authzVersion = 4;
    await expect(service.finishOidcEnrollment(actor, 'https://issuer', { userId: 'user', sessionId: 'session', authzVersion: 3, subject: 'subject' })).rejects.toMatchObject({ status: 401 });
    expect(enrollments.save).not.toHaveBeenCalled();
  });
});
