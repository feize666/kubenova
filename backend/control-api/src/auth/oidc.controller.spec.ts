import { OidcController } from './oidc.controller';

describe('OIDC HTTP flow', () => {
  function enrollmentSetup() {
    const result = setup();
    const context = { userId: 'u', sessionId: 's', authzVersion: 1, subject: 'sub' };
    const auth = result.auth as any;
    const provider = result.provider as any;
    auth.oidcEnrollmentContext = jest.fn().mockResolvedValue(context);
    auth.finishOidcEnrollment = jest.fn().mockResolvedValue({ token: 'pending', secret: 'secret', expiresIn: 300 });
    provider.startReauthentication = jest.fn().mockResolvedValue({ url: 'https://sso.test/authorize' });
    provider.completeReauthentication = jest.fn().mockResolvedValue({ issuer: 'https://sso.test', subject: 'sub' });
    const request = { user: { token: 's', user: { id: 'u' }, authzVersion: 1 }, headers: { origin: 'https://console.test', cookie: `kn_oidc_enrollment_binding=${'b'.repeat(43)}` } };
    return { ...result, auth, provider, context, request };
  }
  it('uses an independent cookie and server context for enrollment without issuing a login', async () => {
    const { controller, response, request, provider, context, auth } = enrollmentSetup();
    await controller.prepareEnrollment(request as never, response as never);
    expect(response.cookie).toHaveBeenCalledWith('kn_oidc_enrollment_binding', expect.any(String), expect.objectContaining({ httpOnly: true, secure: true, maxAge: 300000 }));
    expect(provider.startReauthentication.mock.calls[0][3]).toEqual({ ...context, requestedAt: expect.any(Number) });
    const result = await controller.exchangeEnrollment({ callbackUrl: 'https://console.test/api/auth/oidc/callback?code=c&state=s', requestedAt: 999999, subject: 'attacker' } as never, request as never, response as never);
    expect(result).toEqual({ token: 'pending', secret: 'secret', expiresIn: 300 });
    expect(provider.completeReauthentication.mock.calls[0][4]).toEqual(context);
    expect(auth.loginExternal).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalledWith('kn_oidc_enrollment_binding', expect.anything());
  });
  it.each(['origin', 'session', 'binding', 'provider'])('denies invalid %s before enrollment issuance', async reason => {
    const { controller, response, request, provider, auth } = enrollmentSetup();
    if (reason === 'origin') request.headers.origin = 'https://attacker.test';
    if (reason === 'session') auth.oidcEnrollmentContext.mockRejectedValue(new Error('revoked'));
    if (reason === 'binding') request.headers.cookie = `kn_oidc_binding=${'b'.repeat(43)}`;
    if (reason === 'provider') provider.completeReauthentication.mockRejectedValue(new Error('invalid'));
    await expect(controller.exchangeEnrollment({ callbackUrl: 'https://console.test/api/auth/oidc/callback?code=c&state=s' }, request as never, response as never)).rejects.toThrow();
    expect(auth.finishOidcEnrollment).not.toHaveBeenCalled();
    expect(auth.loginExternal).not.toHaveBeenCalled();
  });
  it('rejects cross-origin MFA reauthentication without contacting the provider', async () => {
    const { controller, provider, response } = setup();
    await expect((controller as any).prepareEnrollment({ headers: { origin: 'https://attacker.test' } }, response)).rejects.toMatchObject({ status: 401 });
    expect(provider.start).not.toHaveBeenCalled();
  });
  it('exposes only availability and hides legacy JSON callback configurations', () => {
    const { controller } = setup();
    expect(controller.status()).toEqual({ enabled: false });
    const config = { get: (key: string) => ({ ...settings, oidcRedirectUri: 'https://console.test/login/oidc' })[key] };
    expect(new OidcController(config as never, {} as never, {} as never).status()).toEqual({ enabled: true });
    expect(setup(false).controller.status()).toEqual({ enabled: false });
  });
  const settings = { oidcEnabled: true, oidcIssuer: 'https://sso.test', oidcClientId: 'console', oidcRedirectUri: 'https://console.test/api/auth/oidc/callback' };
  function setup(enabled = true) {
    const config = { get: (key: string) => ({ ...settings, oidcEnabled: enabled })[key] };
    const provider = { start: jest.fn().mockResolvedValue({ url: 'https://sso.test/authorize' }), complete: jest.fn().mockResolvedValue({ issuer: 'https://sso.test', subject: 'u' }) };
    const auth = { loginExternal: jest.fn().mockResolvedValue({ token: 'access', refreshToken: 'refresh', expiresAt: 'expiry', user: { id: 'u' } }) };
    const response = { cookie: jest.fn(), clearCookie: jest.fn(), setHeader: jest.fn(), redirect: jest.fn() };
    return { controller: new OidcController(config as never, provider as never, auth as never), provider, auth, response };
  }
  it('sets a secure HttpOnly binding cookie and redirects to the provider', async () => {
    const { controller, response } = setup();
    await controller.start(response as never);
    expect(response.cookie).toHaveBeenCalledWith('kn_oidc_binding', expect.any(String), expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', maxAge: 300000 }));
    expect(response.redirect).toHaveBeenCalledWith('https://sso.test/authorize');
  });
  it('rejects disabled login without contacting the provider', async () => {
    const { controller, provider, response } = setup(false);
    await expect(controller.start(response as never)).rejects.toThrow();
    expect(provider.start).not.toHaveBeenCalled();
  });
  it('returns a non-cacheable generic unavailable error without a cookie or redirect when provider startup fails', async () => {
    const { controller, provider, response } = setup();
    provider.start.mockRejectedValue(new Error('https://internal-provider.test/token?client_secret=sensitive'));
    await expect(controller.start(response as never)).rejects.toMatchObject({ status: 503, message: 'Enterprise login temporarily unavailable' });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.cookie).not.toHaveBeenCalled();
    expect(response.redirect).not.toHaveBeenCalled();
  });
  it('rejects callbacks without browser binding before exchanging the code', async () => {
    const { controller, provider, response } = setup();
    await expect(controller.callback({ headers: {}, originalUrl: '/api/auth/oidc/callback?code=x&state=y' } as never, response as never)).rejects.toThrow();
    expect(provider.complete).not.toHaveBeenCalled();
  });
  it('uses configured callback origin and returns a non-cacheable platform session', async () => {
    const { controller, provider, auth, response } = setup();
    const result = await controller.callback({ headers: { cookie: `kn_oidc_binding=${'a'.repeat(43)}`, host: 'attacker.test' }, originalUrl: '/api/auth/oidc/callback?code=x&state=y' } as never, response as never);
    expect(provider.complete.mock.calls[0][2].origin).toBe('https://console.test');
    expect(auth.loginExternal).toHaveBeenCalledWith('https://sso.test', 'u');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.clearCookie).toHaveBeenCalled();
    expect(result).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresAt: 'expiry', user: { id: 'u' } });
  });
  it('never issues a local session after provider validation fails', async () => {
    const { controller, provider, auth, response } = setup();
    provider.complete.mockRejectedValue(new Error('Invalid token'));
    await expect(controller.callback({ headers: { cookie: `kn_oidc_binding=${'a'.repeat(43)}` }, originalUrl: '/api/auth/oidc/callback?code=x&state=y' } as never, response as never)).rejects.toThrow();
    expect(auth.loginExternal).not.toHaveBeenCalled();
  });
  it('rejects cross-origin browser exchanges before consuming a login transaction', async () => {
    const { controller, provider, response } = setup();
    await expect(controller.exchange({ callbackUrl: 'https://console.test/api/auth/oidc/callback?code=x&state=y' }, { headers: { origin: 'https://attacker.test' } } as never, response as never)).rejects.toThrow();
    expect(provider.complete).not.toHaveBeenCalled();
  });
  it('prepares a browser login only for the configured console origin', async () => {
    const { controller, provider, response } = setup();
    await expect(controller.prepare({ headers: { origin: 'https://attacker.test' } } as never, response as never)).rejects.toThrow();
    expect(provider.start).not.toHaveBeenCalled();
    await expect(controller.prepare({ headers: { origin: 'https://console.test' } } as never, response as never)).resolves.toEqual({ url: 'https://sso.test/authorize' });
    expect(response.cookie).toHaveBeenCalled();
    expect(response.redirect).not.toHaveBeenCalled();
  });
});
