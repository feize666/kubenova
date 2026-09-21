import { UnauthorizedException } from '@nestjs/common';
import { validatedEndpoint } from './oidc-flow.service';
import type { OidcIdentityRepository } from './oidc-identity.repository';

/** Authentication only; the gateway must authorize each request and track revocation. */
export async function createNativeAuthenticator(
  config: Parameters<typeof createNativeBearerVerifier>[0],
  identities: OidcIdentityRepository,
) {
  const verify = await createNativeBearerVerifier(config);
  return async (token: string) => {
    const claims = await verify(token);
    try {
      // Never cache account/binding state alongside the cached signing keys.
      const user = await identities.resolve(claims.issuer, claims.subject);
      return { ...claims, userId: user.id, authzVersion: user.authzVersion };
    } catch {
      throw new UnauthorizedException('Native identity unavailable');
    }
  };
}

/** Server-owned settings only; create once per configured native-access provider. */
export async function createNativeBearerVerifier(config: { issuer: string; audience: string; jwksUri: string }) {
  config = { ...config };
  const issuer = validatedEndpoint(config.issuer);
  const jwks = validatedEndpoint(config.jwksUri);
  if (issuer.search || jwks.search || issuer.origin !== jwks.origin ||
      !config.audience?.trim() || config.audience.length > 200) {
    throw new Error('Invalid native OIDC configuration');
  }
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const keySet = createRemoteJWKSet(jwks, { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 300000 });
  return async (token: string) => {
    try {
      if (typeof token !== 'string' || !token || token.length > 16384) throw new Error('Invalid token');
      const { payload } = await jwtVerify(token, keySet, {
        issuer: config.issuer, audience: config.audience,
        algorithms: ['RS256', 'PS256', 'ES256'],
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
      });
      if (!payload.sub?.trim() || payload.sub.length > 1024 ||
          !Number.isSafeInteger(payload.exp) || payload.exp! > 8640000000000 ||
          !Number.isSafeInteger(payload.iat) || payload.iat! > Math.floor(Date.now() / 1000) ||
          (payload.azp !== undefined && payload.azp !== config.audience) ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.audience)) {
        throw new Error('Invalid identity claims');
      }
      return { issuer: config.issuer, subject: payload.sub, expiresAt: new Date(payload.exp! * 1000) };
    } catch {
      throw new UnauthorizedException('Native identity unavailable');
    }
  };
}
