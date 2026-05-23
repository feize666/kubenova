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
    });
  });

  it('throws when required env vars are missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/i);
  });
});
