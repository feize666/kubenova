import { AuthService } from './auth.service';
import type { AuthRepository } from './auth.repository';
import type { TokenService } from './token.service';

describe('AuthService session lifetime policy', () => {
  it('enforces the resolved account limit before checking the password', async () => {
    const repository = { findActiveUserByUsername: async () => ({ id: 'canonical-user', passwordHash: null }) };
    const limiter = { consumeAccount: jest.fn().mockRejectedValue(new Error('rate limited')) };
    const service = Reflect.construct(AuthService, [repository, {}, undefined, limiter]) as AuthService;
    await expect(service.login('alias', 'wrong')).rejects.toThrow('rate limited');
    expect(limiter.consumeAccount).toHaveBeenCalledWith('user:canonical-user');
  });
  it('fails closed when the password-login limiter is missing', async () => {
    const repository = { findActiveUserByUsername: async () => null };
    const service = new AuthService(repository as never, {} as never);
    await expect(service.login('unknown', 'wrong')).rejects.toMatchObject({ status: 503 });
  });
  it('rejects existing sessions and refresh when MFA policy requires unverified assurance', async () => {
    const session = { id: 's', authzVersion: 1, user: { id: 'u', authzVersion: 1, mfaEnabled: true }, expiresAt: new Date() };
    const repository = { findValidSessionById: async () => session, findValidSessionByRefreshTokenHash: async () => session, rotateSession: jest.fn() };
    const tokens = { resolveSessionId: () => 's', hashToken: () => 'hash', createRefreshToken: jest.fn() };
    const service = new AuthService(repository as never, tokens as never);
    await expect(service.validate('token')).resolves.toBeNull();
    await expect(service.refresh('refresh')).resolves.toBeNull();
    expect(repository.rotateSession).not.toHaveBeenCalled();
    expect(tokens.createRefreshToken).not.toHaveBeenCalled();
  });
  it('does not issue a password-only external session for an MFA-enabled account', async () => {
    const repository = { createSession: jest.fn() };
    const identities = { resolve: async () => ({ id: 'u', isActive: true, authzVersion: 1, mfaEnabled: true }) };
    const tokens = { createRefreshToken: jest.fn() };
    const service = new AuthService(repository as never, tokens as never, identities as never);
    await expect(service.loginExternal('https://issuer.test', 'subject')).resolves.toBeNull();
    expect(tokens.createRefreshToken).not.toHaveBeenCalled();
    expect(repository.createSession).not.toHaveBeenCalled();
  });
  it('issues external identity sessions with the current local role and authorization version', async () => {
    const expiresAt = new Date(Date.now() + 60000);
    const repository = { createSession: jest.fn().mockResolvedValue({ id: 'session', expiresAt }) };
    const tokens = { createRefreshToken: () => 'refresh', hashToken: () => 'hash', resolveAccessTokenExpiry: () => expiresAt, resolveRefreshTokenExpiry: () => expiresAt, createAccessToken: () => 'access' };
    const identities = { resolve: jest.fn().mockResolvedValue({ id: 'u', email: 'local', name: null, role: 'user', isActive: true, authzVersion: 7 }) };
    const result = await new AuthService(repository as never, tokens as never, identities as never).loginExternal('https://issuer.test', 'subject');
    expect(result?.user).toEqual({ id: 'u', username: 'local', displayName: 'local', role: 'user' });
    expect(repository.createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u', authzVersion: 7 }));
    expect(identities.resolve).toHaveBeenCalledWith('https://issuer.test', 'subject');
  });
  it('does not issue a session when external identity resolution fails', async () => {
    const repository = { createSession: jest.fn() };
    const identities = { resolve: jest.fn().mockRejectedValue(new Error('Unbound identity')) };
    const service = new AuthService(repository as never, {} as never, identities as never);
    await expect(service.loginExternal('https://issuer.test', 'unknown')).rejects.toThrow('Unbound identity');
    expect(repository.createSession).not.toHaveBeenCalled();
  });
  it.each([undefined, null, 0, -1, 1.5])('rejects malformed matching authorization versions %p', async authzVersion => {
    const session = { id: 's', authzVersion, user: { id: 'u', authzVersion }, expiresAt: new Date() };
    const repository = { findValidSessionById: async () => session, findValidSessionByRefreshTokenHash: async () => session, rotateSession: jest.fn() };
    const tokens = { resolveSessionId: () => 's', hashToken: () => 'hash', createRefreshToken: jest.fn() };
    const service = new AuthService(repository as never, tokens as never);
    await expect(service.validate('token')).resolves.toBeNull();
    await expect(service.refresh('refresh')).resolves.toBeNull();
    expect(tokens.createRefreshToken).not.toHaveBeenCalled();
  });
  it('rejects refresh tokens issued before a permission change', async () => {
    const repository = {
      findValidSessionByRefreshTokenHash: jest.fn().mockResolvedValue({ authzVersion: 2, user: { authzVersion: 3 } }),
      rotateSession: jest.fn(),
    };
    const tokens = { hashToken: () => 'hash', createRefreshToken: jest.fn() };
    await expect(new AuthService(repository as never, tokens as never).refresh('old')).resolves.toBeNull();
    expect(repository.rotateSession).not.toHaveBeenCalled();
    expect(tokens.createRefreshToken).not.toHaveBeenCalled();
  });
  it('creates a short-lived access session with an independent refresh expiry', async () => {
    const accessExpiresAt = new Date('2026-09-10T00:15:00.000Z');
    const refreshExpiresAt = new Date('2026-09-17T00:00:00.000Z');
    const user = {
      id: 'user-1',
      authzVersion: 3,
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      isActive: true,
      passwordHash:
        'salt:2a5c3eab9bf0abea304b889f289870b22b3f64dd05971805b8ea062345e03c5cc0699924bbc750331695ef2cbe05141c3b2707e3cdb971f985dc5eab17a1621d',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const session = {
      id: 'session-1',
      userId: user.id,
      refreshTokenHash: 'refresh-hash',
      expiresAt: accessExpiresAt,
      refreshExpiresAt,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user,
    };
    const repository = {
      findActiveUserByUsername: jest.fn().mockResolvedValue(user),
      createSession: jest.fn().mockResolvedValue(session),
    } as unknown as AuthRepository;
    const tokenService = {
      createRefreshToken: jest.fn().mockReturnValue('refresh-token'),
      hashToken: jest.fn().mockReturnValue('refresh-hash'),
      createAccessToken: jest.fn().mockReturnValue('session-1'),
      resolveAccessTokenExpiry: jest.fn().mockReturnValue(accessExpiresAt),
      resolveRefreshTokenExpiry: jest.fn().mockReturnValue(refreshExpiresAt),
    } as unknown as TokenService;

    const result = await new AuthService(repository, tokenService, undefined, { consumeAccount: async () => {} } as never).login(
      'admin@example.com',
      'admin',
    );

    expect(result).toMatchObject({
      token: 'session-1',
      refreshToken: 'refresh-token',
      expiresAt: accessExpiresAt.toISOString(),
    });
    expect(repository.createSession).toHaveBeenCalledWith({
      authzVersion: 3,
      userId: user.id,
      refreshTokenHash: 'refresh-hash',
      expiresAt: accessExpiresAt,
      refreshExpiresAt,
    });
  });

  it('rotates refresh tokens while preserving the absolute refresh-session deadline', async () => {
    const accessExpiresAt = new Date('2026-09-10T00:15:00.000Z');
    const refreshExpiresAt = new Date('2026-09-17T00:00:00.000Z');
    const user = {
      id: 'user-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      isActive: true,
      passwordHash: null,
      authzVersion: 4,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const currentSession = {
      authzVersion: 4,
      id: 'session-1',
      userId: user.id,
      refreshTokenHash: 'old-refresh-hash',
      expiresAt: new Date('2026-09-10T00:05:00.000Z'),
      refreshExpiresAt,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user,
    };
    const repository = {
      findValidSessionByRefreshTokenHash: jest
        .fn()
        .mockResolvedValue(currentSession),
      rotateSession: jest.fn().mockResolvedValue({
        ...currentSession,
        id: 'session-2',
        expiresAt: accessExpiresAt,
        refreshTokenHash: 'new-refresh-hash',
      }),
    } as unknown as AuthRepository;
    const tokenService = {
      createRefreshToken: jest.fn().mockReturnValue('new-refresh-token'),
      hashToken: jest
        .fn()
        .mockImplementation((token: string) =>
          token === 'old-refresh-token' ? 'old-refresh-hash' : 'new-refresh-hash',
        ),
      createAccessToken: jest.fn().mockReturnValue('session-2'),
      resolveAccessTokenExpiry: jest.fn().mockReturnValue(accessExpiresAt),
    } as unknown as TokenService;

    const result = await new AuthService(repository, tokenService).refresh(
      'old-refresh-token',
    );

    expect(result).toMatchObject({
      token: 'session-2',
      refreshToken: 'new-refresh-token',
      expiresAt: accessExpiresAt.toISOString(),
    });
    expect(repository.rotateSession).toHaveBeenCalledWith({
      authzVersion: 4,
      sessionId: 'session-1',
      userId: user.id,
      currentRefreshTokenHash: 'old-refresh-hash',
      nextRefreshTokenHash: 'new-refresh-hash',
      expiresAt: accessExpiresAt,
      refreshExpiresAt,
    });
  });

  it('does not create a new session when rotation loses the compare-and-set race', async () => {
    const currentSession = {
      authzVersion: 4,
      id: 'session-1',
      userId: 'user-1',
      refreshTokenHash: 'old-refresh-hash',
      expiresAt: new Date('2026-09-10T00:05:00.000Z'),
      refreshExpiresAt: new Date('2026-09-17T00:00:00.000Z'),
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        authzVersion: 4,
        id: 'user-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
        isActive: true,
        passwordHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    const repository = {
      findValidSessionByRefreshTokenHash: jest
        .fn()
        .mockResolvedValue(currentSession),
      rotateSession: jest.fn().mockResolvedValue(null),
      createSession: jest.fn(),
    } as unknown as AuthRepository;
    const tokenService = {
      createRefreshToken: jest.fn().mockReturnValue('new-refresh-token'),
      hashToken: jest.fn().mockReturnValue('old-refresh-hash'),
      resolveAccessTokenExpiry: jest
        .fn()
        .mockReturnValue(new Date('2026-09-10T00:15:00.000Z')),
    } as unknown as TokenService;

    const result = await new AuthService(repository, tokenService).refresh(
      'replayed-refresh-token',
    );

    expect(result).toBeNull();
    expect(repository.rotateSession).toHaveBeenCalledTimes(1);
    expect(repository.createSession).not.toHaveBeenCalled();
  });
});
