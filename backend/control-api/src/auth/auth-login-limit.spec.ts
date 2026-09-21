import { AuthController } from './auth.controller';

describe('password login transport limit', () => {
  it('rejects a throttled socket address before password authentication, ignoring forwarded headers', async () => {
    const auth = { login: jest.fn() };
    const limiter = { consumeIp: jest.fn().mockRejectedValue(new Error('rate limited')) };
    const controller = Reflect.construct(AuthController, [auth, limiter]) as AuthController;
    const req = { headers: { 'x-forwarded-for': 'attacker-chosen' }, socket: { remoteAddress: '127.0.0.1' } };
    await expect(controller.login({ username: 'user', password: 'wrong' }, req as never, { setHeader: jest.fn() } as never)).rejects.toThrow('rate limited');
    expect(limiter.consumeIp).toHaveBeenCalledWith('127.0.0.1');
    expect(auth.login).not.toHaveBeenCalled();
  });
});
