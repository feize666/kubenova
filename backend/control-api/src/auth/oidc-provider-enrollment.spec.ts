import { OidcProviderService } from './oidc-provider.service';
import { OidcFlowService } from './oidc-flow.service';
import { OidcTransactionStore } from './oidc-transaction.store';

describe('OIDC original enrollment freshness', () => {
  const config = { enabled: true, issuer: 'https://issuer.test', clientId: 'console', redirectUri: 'https://console.test/login/oidc' };
  const actor = { userId: 'u', sessionId: 's', authzVersion: 1, subject: 'sub' };
  async function setup(age = 0, authAge = 0, context: Record<string, unknown> = {}) {
    const values = new Map<string, string>();
    const store = new OidcTransactionStore({ set: async (k, v) => { values.set(k, v); return 'OK'; }, getdel: async k => { const v = values.get(k) ?? null; values.delete(k); return v; } } as never);
    const flow = new OidcFlowService(store);
    const requestedAt = Math.floor(Date.now() / 1000) - age;
    const { url } = await flow.begin(config, 'https://issuer.test/authorize', 'binding', { ...actor, requestedAt, ...context } as never);
    const callback = new URL(config.redirectUri);
    callback.searchParams.set('state', new URL(url).searchParams.get('state')!);
    const service = new OidcProviderService(flow, store);
    (service as any).discover = async () => ({ client: { authorizationCodeGrant: async () => ({ claims: () => ({ iss: config.issuer, sub: 'sub', auth_time: Math.floor(Date.now() / 1000) - authAge }) }) }, provider: {} });
    return { service, callback };
  }
  it('uses the stored request time without accepting one from the callback and consumes once', async () => {
    const { service, callback } = await setup();
    await expect(service.completeReauthentication(config, '', callback, 'binding', actor as never)).resolves.toEqual({ issuer: config.issuer, subject: 'sub' });
    await expect(service.completeReauthentication(config, '', callback, 'binding', actor as never)).rejects.toMatchObject({ status: 401 });
  });
  it.each([[301, 0], [0, 60]])('rejects stale stored request/authentication %s/%s', async (age, authAge) => {
    const { service, callback } = await setup(age, authAge);
    await expect(service.completeReauthentication(config, '', callback, 'binding', actor as never)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects enrollment transactions on the login endpoint', async () => {
    const { service, callback } = await setup();
    await expect(service.complete(config, '', callback, 'binding')).rejects.toMatchObject({ status: 401 });
  });
  it('rejects a changed session identity', async () => {
    const { service, callback } = await setup();
    await expect(service.completeReauthentication(config, '', callback, 'binding', { ...actor, sessionId: 'other' })).rejects.toMatchObject({ status: 401 });
  });
  const reset = { purpose: 'mfa-reset', targetUserId: 'target', targetAuthzVersion: 3, targetMfaVersion: 2 };
  it('accepts an exact reset binding and consumes it once', async () => {
    const { service, callback } = await setup(0, 0, reset);
    await expect(service.completeReauthentication(config, '', callback, 'binding', { ...actor, ...reset } as never)).resolves.toEqual({ issuer: config.issuer, subject: 'sub' });
    await expect(service.completeReauthentication(config, '', callback, 'binding', { ...actor, ...reset } as never)).rejects.toMatchObject({ status: 401 });
  });
  it.each([
    {}, { purpose: 'enrollment' }, { ...reset, targetUserId: 'other' },
    { ...reset, targetAuthzVersion: 4 }, { ...reset, targetMfaVersion: 3 },
  ])('rejects a reset callback with changed purpose or target %j', async context => {
    const { service, callback } = await setup(0, 0, reset);
    await expect(service.completeReauthentication(config, '', callback, 'binding', { ...actor, ...context } as never)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects enrollment redeemed as reset', async () => {
    const { service, callback } = await setup();
    await expect(service.completeReauthentication(config, '', callback, 'binding', { ...actor, ...reset } as never)).rejects.toMatchObject({ status: 401 });
  });
  it.each([
    { ...reset, targetUserId: '' }, { ...reset, targetAuthzVersion: 0 },
    { ...reset, targetMfaVersion: 1.5 }, { purpose: 'other' },
    { ...reset, purpose: 'enrollment' },
  ])('rejects malformed reauthentication before provider access %j', async context => {
    const { service } = await setup();
    await expect(service.startReauthentication(config, '', 'binding', { ...actor, requestedAt: Math.floor(Date.now() / 1000), ...context } as never)).rejects.toMatchObject({ status: 401 });
  });
});
