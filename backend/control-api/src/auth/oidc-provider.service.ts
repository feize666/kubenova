import { Injectable, UnauthorizedException } from '@nestjs/common';
import { oidcConfigSchema, type OidcConfig } from './oidc-config';
import { OidcFlowService, validatedEndpoint } from './oidc-flow.service';
import { OidcTransactionStore, type OidcReauthentication } from './oidc-transaction.store';

@Injectable()
export class OidcProviderService {
  constructor(private readonly flow: OidcFlowService, private readonly transactions: OidcTransactionStore) {}

  private async discover(input: OidcConfig, clientSecret: string) {
    const config = oidcConfigSchema.parse(input);
    if (!config.enabled) throw new UnauthorizedException('OIDC disabled');
    const issuer = validatedEndpoint(config.issuer);
    validatedEndpoint(config.redirectUri);
    const client = await import('openid-client');
    const execute = [client.enableNonRepudiationChecks];
    if (issuer.protocol === 'http:') execute.push(client.allowInsecureRequests);
    const provider = await client.discovery(issuer, config.clientId, clientSecret, undefined, { timeout: 5, execute });
    const metadata = provider.serverMetadata();
    for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
      if (!endpoint) throw new UnauthorizedException('Incomplete OIDC provider metadata');
      validatedEndpoint(endpoint);
    }
    return { client, provider, authorizationEndpoint: metadata.authorization_endpoint! };
  }

  async start(input: OidcConfig, clientSecret: string, browserBinding: string) {
    const { authorizationEndpoint } = await this.discover(input, clientSecret);
    return this.flow.begin(input, authorizationEndpoint, browserBinding);
  }

  async complete(input: OidcConfig, clientSecret: string, callback: URL, browserBinding: string): Promise<{ issuer: string; subject: string }> {
    return this.exchange(input, clientSecret, callback, browserBinding);
  }

  private validateReauthentication(actor: OidcReauthentication) {
    if (!actor || ![actor.userId, actor.sessionId, actor.subject].every(value => typeof value === 'string' && value.length > 0 && value.length <= 1024)
      || !Number.isSafeInteger(actor.authzVersion) || actor.authzVersion < 1 || !Number.isSafeInteger(actor.requestedAt)
      || actor.requestedAt > Math.floor(Date.now() / 1000) || actor.requestedAt < Math.floor(Date.now() / 1000) - 300) throw new UnauthorizedException('Invalid reauthentication context');
    const purpose = actor.purpose ?? 'enrollment';
    if (purpose === 'mfa-reset') {
      if (typeof actor.targetUserId !== 'string' || !actor.targetUserId || actor.targetUserId.length > 256
        || !Number.isSafeInteger(actor.targetAuthzVersion) || actor.targetAuthzVersion! < 1
        || !Number.isSafeInteger(actor.targetMfaVersion) || actor.targetMfaVersion! < 1) throw new UnauthorizedException('Invalid reset target');
    } else if (purpose !== 'enrollment' || actor.targetUserId !== undefined || actor.targetAuthzVersion !== undefined || actor.targetMfaVersion !== undefined) {
      throw new UnauthorizedException('Invalid reauthentication purpose');
    }
  }

  async startReauthentication(input: OidcConfig, clientSecret: string, browserBinding: string, actor: OidcReauthentication) {
    this.validateReauthentication(actor);
    const { authorizationEndpoint } = await this.discover(input, clientSecret);
    return this.flow.begin(input, authorizationEndpoint, browserBinding, actor);
  }

  async completeReauthentication(input: OidcConfig, clientSecret: string, callback: URL, browserBinding: string, actor: Omit<OidcReauthentication, 'requestedAt'> & { requestedAt?: number }) {
    return this.exchange(input, clientSecret, callback, browserBinding, actor);
  }

  private async exchange(input: OidcConfig, clientSecret: string, callback: URL, browserBinding: string, actor?: Omit<OidcReauthentication, 'requestedAt'> & { requestedAt?: number }): Promise<{ issuer: string; subject: string }> {
    const redirect = validatedEndpoint(input.redirectUri);
    if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || callback.hash || callback.username || callback.password || callback.searchParams.getAll('state').length !== 1) {
      throw new UnauthorizedException('Invalid OIDC callback');
    }
    const state = callback.searchParams.get('state') ?? '';
    const transaction = await this.transactions.consume(state, browserBinding);
    const original = transaction.reauthentication;
    if (original) {
      this.validateReauthentication(original);
      if (actor) this.validateReauthentication({ ...actor, requestedAt: original.requestedAt });
    }
    if (Boolean(original) !== Boolean(actor) || (actor && (!original ||
      (['userId', 'sessionId', 'authzVersion', 'subject'] as const).some(key => original[key] !== actor[key])
      || original.purpose !== (actor.purpose ?? 'enrollment')
      || (['targetUserId', 'targetAuthzVersion', 'targetMfaVersion'] as const).some(key => original[key] !== actor[key])
      || (actor.requestedAt !== undefined && original.requestedAt !== actor.requestedAt)))) {
      throw new UnauthorizedException('OIDC transaction purpose or identity changed');
    }
    if (transaction.issuer !== input.issuer || transaction.clientId !== input.clientId || transaction.redirectUri !== input.redirectUri) throw new UnauthorizedException('OIDC configuration changed');
    try {
      const { client, provider } = await this.discover(input, clientSecret);
      const tokens = await client.authorizationCodeGrant(provider, callback, {
        expectedState: state, expectedNonce: transaction.nonce,
        pkceCodeVerifier: transaction.codeVerifier, idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims?.sub || claims.iss !== transaction.issuer) throw new Error('Invalid identity');
      if (actor && (claims.sub !== actor.subject || !Number.isSafeInteger(claims.auth_time)
        || claims.auth_time! < original!.requestedAt - 30 || claims.auth_time! > Math.floor(Date.now() / 1000) + 30)) throw new Error('Fresh authentication required');
      return { issuer: claims.iss, subject: claims.sub };
    } catch {
      throw new UnauthorizedException('OIDC authentication failed');
    }
  }
}
