import { BadRequestException } from '@nestjs/common';
import { OidcFlowService } from './oidc-flow.service';
import { OidcTransactionStore } from './oidc-transaction.store';
import { createHash } from 'node:crypto';

describe('OidcFlowService', () => {
  it('keeps PKCE secrets server-side when starting a browser login', async () => {
    const values = new Map<string, string>();
    const store = new OidcTransactionStore({
      set: async (key: string, value: string) => { values.set(key, value); return 'OK'; },
      getdel: async (key: string) => { const value = values.get(key) ?? null; values.delete(key); return value; },
    } as never);
    const service = new OidcFlowService(store);
    const result = await service.begin({ enabled: true, issuer: 'https://sso.example.test', clientId: 'console', redirectUri: 'https://console.example.test/callback' }, 'https://sso.example.test/authorize', 'browser-binding');
    const url = new URL(result.url);
    expect(Object.keys(result)).toEqual(['url']);
    const transaction = await store.consume(url.searchParams.get('state')!, 'browser-binding');
    expect(url.searchParams.get('nonce')).toBe(transaction.nonce);
    expect(url.searchParams.has('code_verifier')).toBe(false);
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(transaction.codeVerifier).digest('base64url'));
  });
  it.each([
    { redirectUri: 'ftp://localhost/callback' },
    { redirectUri: 'https://user:password@console.example.test/callback' },
    { redirectUri: 'https://console.example.test/callback#token' },
    { issuer: 'http://sso.example.test' },
    { endpoint: 'http://sso.example.test/authorize' },
    { endpoint: 'javascript:alert(1)' },
  ])('rejects unsafe OIDC transport or redirect configuration %#', overrides => {
    const { endpoint = 'https://sso.example.test/authorize', ...config } = overrides;
    expect(() => new OidcFlowService().createAuthorizationRequest({
      enabled: true, issuer: 'https://sso.example.test', clientId: 'kubenova',
      redirectUri: 'https://console.example.test/callback', ...config,
    }, endpoint)).toThrow();
  });
  it('creates a PKCE S256 authorization request with state and nonce', () => {
    const result = new OidcFlowService().createAuthorizationRequest({ enabled: true, issuer: 'https://sso.example.test', clientId: 'kubenova', redirectUri: 'https://console.example.test/auth/callback' }, 'https://sso.example.test/authorize');
    const url = new URL(result.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(result.state);
    expect(url.searchParams.get('nonce')).toBe(result.nonce);
    expect(result.codeVerifier.length).toBeGreaterThan(40);
  });
  it('rejects disabled OIDC and insecure non-local redirect URIs', () => {
    const service = new OidcFlowService();
    expect(() => service.createAuthorizationRequest({ enabled: false, issuer: 'https://sso.example.test', clientId: 'x', redirectUri: 'https://console.example.test/cb' }, 'https://sso.example.test/authorize')).toThrow(BadRequestException);
    expect(() => service.createAuthorizationRequest({ enabled: true, issuer: 'https://sso.example.test', clientId: 'x', redirectUri: 'http://console.example.test/cb' }, 'https://sso.example.test/authorize')).toThrow(BadRequestException);
  });
});
