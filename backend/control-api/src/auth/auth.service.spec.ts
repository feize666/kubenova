import { AuthService } from './auth.service';
import type { AuthRepository } from './auth.repository';
import type { TokenService } from './token.service';

describe('AuthService session lifetime policy', () => {
  it('creates a short-lived access session with an independent refresh expiry', async () => {
    const accessExpiresAt = new Date('2026-09-10T00:15:00.000Z');
    const refreshExpiresAt = new Date('2026-09-17T00:00:00.000Z');
    const user = {
      id: 'user-1',
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

    const result = await new AuthService(repository, tokenService).login(
      'admin@example.com',
      'admin',
    );

    expect(result).toMatchObject({
      token: 'session-1',
      refreshToken: 'refresh-token',
      expiresAt: accessExpiresAt.toISOString(),
    });
    expect(repository.createSession).toHaveBeenCalledWith({
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const currentSession = {
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
      id: 'session-1',
      userId: 'user-1',
      refreshTokenHash: 'old-refresh-hash',
      expiresAt: new Date('2026-09-10T00:05:00.000Z'),
      refreshExpiresAt: new Date('2026-09-17T00:00:00.000Z'),
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
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
