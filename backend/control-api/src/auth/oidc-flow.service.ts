import { Injectable, BadRequestException } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { oidcConfigSchema, type OidcConfig } from './oidc-config';

export type OidcAuthorizationRequest = { url: string; state: string; nonce: string; codeVerifier: string };

function base64url(bytes: Buffer): string { return bytes.toString('base64url'); }

@Injectable()
export class OidcFlowService {
  createAuthorizationRequest(input: OidcConfig, authorizationEndpoint: string): OidcAuthorizationRequest {
    const config = oidcConfigSchema.parse(input);
    if (!config.enabled) throw new BadRequestException('OIDC 未启用');
    const endpoint = new URL(authorizationEndpoint);
    const redirect = new URL(config.redirectUri);
    if (redirect.protocol !== 'https:' && redirect.hostname !== 'localhost') throw new BadRequestException('OIDC redirect URI 必须使用 HTTPS');
    const state = base64url(randomBytes(32));
    const nonce = base64url(randomBytes(32));
    const codeVerifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(codeVerifier).digest());
    endpoint.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return { url: endpoint.toString(), state, nonce, codeVerifier };
  }
}
