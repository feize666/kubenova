import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CONTROL_API_BASE_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().min(1).default('7d'),
  RUNTIME_GATEWAY_BASE_URL: z.string().url().default('ws://localhost:4100'),
  SWAGGER_ENABLED: z.coerce.boolean().default(true),
  DEFAULT_ADMIN_EMAIL: z.string().email().default('admin@local.dev'),
  DEFAULT_ADMIN_PASSWORD: z.string().min(6).default('admin123456'),
  AI_MODEL_BASE_URL: z
    .string()
    .url()
    .optional()
    .default('https://api.openai.com/v1'),
  AI_MODEL_API_KEY: z.string().optional().default(''),
  AI_MODEL_NAME: z.string().optional().default('gpt-4o-mini'),
  AI_MODEL_MAX_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .default(2048),
  AI_MODEL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .default(30000),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  controlApiBaseUrl: string;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenExpiresIn: string;
  runtimeGatewayBaseUrl: string;
  swaggerEnabled: boolean;
  defaultAdminEmail: string;
  defaultAdminPassword: string;
  aiModelBaseUrl: string;
  aiModelApiKey: string;
  aiModelName: string;
  aiModelMaxTokens: number;
  aiModelTimeoutMs: number;
};

export function parseEnv(env: Record<string, unknown>): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    controlApiBaseUrl: parsed.data.CONTROL_API_BASE_URL,
    databaseUrl: parsed.data.DATABASE_URL,
    redisUrl: parsed.data.REDIS_URL,
    jwtSecret: parsed.data.JWT_SECRET,
    jwtExpiresIn: parsed.data.JWT_EXPIRES_IN,
    refreshTokenExpiresIn: parsed.data.REFRESH_TOKEN_EXPIRES_IN,
    runtimeGatewayBaseUrl: parsed.data.RUNTIME_GATEWAY_BASE_URL,
    swaggerEnabled: parsed.data.SWAGGER_ENABLED,
    defaultAdminEmail: parsed.data.DEFAULT_ADMIN_EMAIL,
    defaultAdminPassword: parsed.data.DEFAULT_ADMIN_PASSWORD,
    aiModelBaseUrl: parsed.data.AI_MODEL_BASE_URL,
    aiModelApiKey: parsed.data.AI_MODEL_API_KEY,
    aiModelName: parsed.data.AI_MODEL_NAME,
    aiModelMaxTokens: parsed.data.AI_MODEL_MAX_TOKENS,
    aiModelTimeoutMs: parsed.data.AI_MODEL_TIMEOUT_MS,
  };
}
