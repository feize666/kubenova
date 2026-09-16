import { BadRequestException } from '@nestjs/common';
import { OidcFlowService } from './oidc-flow.service';

describe('OidcFlowService', () => {
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
