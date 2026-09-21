import { Injectable, BadRequestException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { oidcConfigSchema, type OidcConfig } from './oidc-config';
import { OidcTransactionStore, type OidcReauthentication } from './oidc-transaction.store';

export type OidcAuthorizationRequest = { url: string; state: string; nonce: string; codeVerifier: string };

function base64url(bytes: Buffer): string { return bytes.toString('base64url'); }

export function validatedEndpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new BadRequestException('Invalid OIDC URL'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.hash) {
    throw new BadRequestException('OIDC URL requires HTTPS without credentials or fragments');
  }
  return url;
}

@Injectable()
export class OidcFlowService {
  constructor(@Optional() private readonly transactions?: OidcTransactionStore) {}

  async begin(input: OidcConfig, authorizationEndpoint: string, browserBinding: string, reauthentication?: OidcReauthentication): Promise<{ url: string }> {
    if (!this.transactions) throw new ServiceUnavailableException('OIDC login transaction storage unavailable');
    const request = this.createAuthorizationRequest(input, authorizationEndpoint);
    const state = await this.transactions.save({
      nonce: request.nonce, codeVerifier: request.codeVerifier,
      issuer: input.issuer, clientId: input.clientId, redirectUri: input.redirectUri,
      ...(reauthentication ? { reauthentication: { ...reauthentication, purpose: reauthentication.purpose ?? 'enrollment' } } : {}),
    }, browserBinding);
    const url = new URL(request.url);
    url.searchParams.set('state', state);
    if (reauthentication) {
      url.searchParams.set('prompt', 'login');
      url.searchParams.set('max_age', '0');
    }
    return { url: url.toString() };
  }

  createAuthorizationRequest(input: OidcConfig, authorizationEndpoint: string): OidcAuthorizationRequest {
    const config = oidcConfigSchema.parse(input);
    if (!config.enabled) throw new BadRequestException('OIDC 未启用');
    validatedEndpoint(config.issuer);
    const endpoint = validatedEndpoint(authorizationEndpoint);
    validatedEndpoint(config.redirectUri);
    const state = base64url(randomBytes(32));
    const nonce = base64url(randomBytes(32));
    const codeVerifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(codeVerifier).digest());
    endpoint.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return { url: endpoint.toString(), state, nonce, codeVerifier };
  }
}
