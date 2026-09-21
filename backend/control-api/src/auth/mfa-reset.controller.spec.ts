import { MfaResetController } from './mfa-reset.controller';
import { ConfigService } from '@nestjs/config';

describe('reset request security boundary', () => {
  function setup() {
    const auth = { prepareMfaReset: jest.fn(), confirmMfaReset: jest.fn(), oidcMfaResetContext: jest.fn().mockResolvedValue({ purpose: 'mfa-reset', targetUserId: 'target' }), finishOidcMfaReset: jest.fn() };
    const limiter = { consumeIp: jest.fn() };
    const provider = { startReauthentication: jest.fn().mockResolvedValue({ url: 'https://issuer/authorize' }) };
    const config = new ConfigService({ oidcEnabled: true, oidcIssuer: 'https://issuer', oidcClientId: 'console', oidcRedirectUri: 'http://127.0.0.1:3000/login/oidc' });
    const controller = new MfaResetController(auth as never, limiter as never, config, provider as never);
    const request = { user: { token: 'session' }, headers: { origin: 'http://127.0.0.1:3000', 'x-forwarded-for': 'forged' }, socket: { remoteAddress: '127.0.0.1' } };
    const response = { setHeader: jest.fn(), cookie: jest.fn(), clearCookie: jest.fn() };
    return { auth, limiter, controller, request, response, provider };
  }
  const previous = process.env.CORS_ORIGINS;
  beforeEach(() => { process.env.CORS_ORIGINS = 'http://127.0.0.1:3000'; });
  afterAll(() => { if (previous === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = previous; });
  it('uses socket IP and forwards only bounded operation data', async () => {
    const s = setup();
    await s.controller.prepare({ targetUserId: 'target', password: 'password', code: '123456', method: 'totp' }, s.request as never, s.response as never);
    expect(s.limiter.consumeIp).toHaveBeenCalledWith('127.0.0.1');
    expect(s.auth.prepareMfaReset).toHaveBeenCalledWith(s.request.user, 'target', 'password', { code: '123456', method: 'totp' });
    expect(s.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it.each(['https://attacker.invalid', 'null', '', undefined])('rejects origin %s before proof consumption', async origin => {
    const s = setup(); s.request.headers.origin = origin as string;
    await expect(s.controller.confirm({ targetUserId: 'target', token: 'a'.repeat(43) }, s.request as never, s.response as never)).rejects.toMatchObject({ status: 401 });
    expect(s.auth.confirmMfaReset).not.toHaveBeenCalled();
  });
  it('does not consume proof when IP limit storage fails', async () => {
    const s = setup(); s.limiter.consumeIp.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(s.controller.confirm({ targetUserId: 'target', token: 'a'.repeat(43) }, s.request as never, s.response as never)).rejects.toThrow('storage unavailable');
    expect(s.auth.confirmMfaReset).not.toHaveBeenCalled();
  });
  it('uses a separate HttpOnly reset binding and target context', async () => {
    const s = setup();
    await s.controller.prepareOidc({ targetUserId: 'target' }, s.request as never, s.response as never);
    expect(s.auth.oidcMfaResetContext).toHaveBeenCalledWith(s.request.user, 'target', 'https://issuer', true);
    expect(s.response.cookie).toHaveBeenCalledWith('kn_oidc_reset_binding', expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 300000 }));
  });
  it.each(['missing-binding', 'enrollment-binding', 'foreign-callback', 'callback-fragment'])('rejects %s before reset verification', async mode => {
    const s = setup();
    const headers = s.request.headers as Record<string, string>;
    if (mode !== 'missing-binding') headers.cookie = `${mode === 'enrollment-binding' ? 'kn_oidc_enrollment_binding' : 'kn_oidc_reset_binding'}=${'a'.repeat(43)}`;
    const callbackUrl = mode === 'foreign-callback' ? 'https://attacker/login/oidc' : `http://127.0.0.1:3000/login/oidc${mode === 'callback-fragment' ? '#bad' : ''}`;
    await expect(s.controller.exchangeOidc({ targetUserId: 'target', callbackUrl }, s.request as never, s.response as never)).rejects.toMatchObject({ status: 401 });
    expect(s.auth.finishOidcMfaReset).not.toHaveBeenCalled();
  });
  it('passes callback and fresh factor to the verified service, clearing binding', async () => {
    const s = setup();
    (s.request.headers as Record<string, string>).cookie = `kn_oidc_reset_binding=${'a'.repeat(43)}`;
    await s.controller.exchangeOidc({ targetUserId: 'target', callbackUrl: 'http://127.0.0.1:3000/login/oidc?state=s', code: '123456', method: 'totp' }, s.request as never, s.response as never);
    expect(s.auth.finishOidcMfaReset).toHaveBeenCalledWith(s.request.user, 'target', expect.objectContaining({ issuer: 'https://issuer' }), expect.any(String), expect.any(URL), 'a'.repeat(43), { code: '123456', method: 'totp' });
    expect(s.response.clearCookie).toHaveBeenCalledWith('kn_oidc_reset_binding', expect.objectContaining({ path: '/api' }));
  });
});
