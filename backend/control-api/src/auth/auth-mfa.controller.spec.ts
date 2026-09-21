import { AuthController } from './auth.controller';

describe('MFA completion HTTP boundary', () => {
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const res = { setHeader: jest.fn() };
  it('applies IP throttling before redeeming a challenge', async () => {
    const completeMfa = jest.fn();
    const controller = new AuthController({ completeMfa } as never, { consumeIp: async () => { throw new Error('limited'); } } as never);
    await expect(controller.completeMfa({ challengeToken: 'a'.repeat(43), code: '123456', method: 'totp' }, req, res as never)).rejects.toThrow('limited');
    expect(completeMfa).not.toHaveBeenCalled();
  });
  it('rejects failed verification rather than returning token fields', async () => {
    const controller = new AuthController({ completeMfa: async () => null } as never, { consumeIp: async () => {} } as never);
    await expect(controller.completeMfa({ challengeToken: 'a'.repeat(43), code: '123456', method: 'totp' }, req, res as never)).rejects.toMatchObject({ status: 401 });
  });
  it('returns only the verified session response with no challenge or code', async () => {
    const user = { id: 'u', username: 'reader' };
    const completeMfa = jest.fn(async () => ({ token: 'access', refreshToken: 'refresh', expiresAt: 'expiry', user }));
    const controller = new AuthController({ completeMfa } as never, { consumeIp: async () => {} } as never);
    const response = await controller.completeMfa({ challengeToken: 'a'.repeat(43), code: '123456', method: 'totp' }, req, res as never);
    expect(response).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresAt: 'expiry', user, requestId: expect.any(String) });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
