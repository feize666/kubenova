import { parseEnv } from './env.schema';

describe('parseEnv', () => {
  it('returns validated app config with defaults', () => {
    const result = parseEnv({
      DATABASE_URL: 'postgresql://localhost:5432/k8s_aiops',
      JWT_SECRET: 'super-secret-value',
      REDIS_URL: 'redis://localhost:6379',
    });

    expect(result).toEqual({
      nodeEnv: 'development',
      port: 4000,
      controlApiBaseUrl: 'http://localhost:4000',
      databaseUrl: 'postgresql://localhost:5432/k8s_aiops',
      redisUrl: 'redis://localhost:6379',
      jwtSecret: 'super-secret-value',
      jwtExpiresIn: '15m',
      refreshTokenExpiresIn: '7d',
      runtimeGatewayBaseUrl: 'ws://localhost:4100',
      swaggerEnabled: true,
      defaultAdminEmail: 'admin@local.dev',
      defaultAdminPassword: 'admin123456',
      aiModelBaseUrl: 'https://api.openai.com/v1',
      aiModelApiKey: '',
      aiModelName: 'gpt-4o-mini',
      aiModelMaxTokens: 2048,
      aiModelTimeoutMs: 30000,
      aiCredentialEncryptionKey: undefined,
      oidcEnabled: false,
      oidcIssuer: undefined,
      oidcClientId: undefined,
      oidcRedirectUri: undefined,
    });
  });

  it('throws when required env vars are missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/i);
  });
  it('requires complete OIDC settings only when enabled', () => {
    const base = { DATABASE_URL: 'postgresql://localhost:5432/k8s_aiops', JWT_SECRET: 'super-secret-value', REDIS_URL: 'redis://localhost:6379' };
    expect(() => parseEnv({ ...base, OIDC_ENABLED: true })).toThrow(/OIDC requires/i);
    expect(() => parseEnv({ ...base, OIDC_ENABLED: true, OIDC_ISSUER: 'https://sso.example.com/realms/ops', OIDC_CLIENT_ID: 'kubenova', OIDC_REDIRECT_URI: 'https://console.example.com/auth/callback' })).not.toThrow();
  });

  it('requires a strong AI credential key in production', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/k8s_aiops',
      JWT_SECRET: 'super-secret-value',
      REDIS_URL: 'redis://localhost:6379',
    };

    expect(() => parseEnv(base)).toThrow(/AI_CREDENTIAL_ENCRYPTION_KEY/i);
    expect(() =>
      parseEnv({ ...base, AI_CREDENTIAL_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow(/at least 32 characters/i);
    expect(() =>
      parseEnv({
        ...base,
        AI_CREDENTIAL_ENCRYPTION_KEY:
          'replace-with-at-least-32-random-characters',
      }),
    ).toThrow(/non-placeholder/i);
    expect(() =>
      parseEnv({
        ...base,
        AI_CREDENTIAL_ENCRYPTION_KEY:
          '0123456789abcdef0123456789abcdef',
      }),
    ).not.toThrow();
  });
});
