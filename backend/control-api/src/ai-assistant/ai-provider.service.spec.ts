import { BadRequestException } from '@nestjs/common';
import {
  AiProviderService,
  resolveAiCredentialEncryptionKey,
} from './ai-provider.service';

describe('AiProviderService', () => {
  const prisma = {
    aiProvider: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    aiAgentProfile: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('exposes supported vendor catalog without credentials', () => {
    const service = new AiProviderService(prisma);
    const catalog = service.listVendors();
    expect(catalog.map((item) => item.id)).toEqual(
      expect.arrayContaining(['openai', 'anthropic', 'gemini', 'qwen', 'volcengine', 'deepseek']),
    );
    expect(catalog[0]).not.toHaveProperty('apiKey');
  });

  it('rejects providers outside the allow-list', async () => {
    const service = new AiProviderService(prisma);
    await expect(
      service.createProvider({
        name: 'bad', vendor: 'unknown', baseUrl: 'https://example.com', modelName: 'x', apiKey: 'secret',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiProvider.create).not.toHaveBeenCalled();
  });

  it('rejects agent tools outside the allow-list', async () => {
    prisma.aiProvider.findUnique.mockResolvedValue({ id: 'provider-1' });
    const service = new AiProviderService(prisma);
    await expect(service.createAgent({ name: 'agent', providerId: 'provider-1', tools: ['exec_shell'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiAgentProfile.create).not.toHaveBeenCalled();
  });

  it('never returns provider API key in public representation', async () => {
    prisma.aiProvider.findMany.mockResolvedValue([{ id: 'p1', name: 'OpenAI', vendor: 'openai', baseUrl: 'https://api.openai.com/v1', modelName: 'gpt', apiKeyCiphertext: 'cipher', apiKeyLast4: '1234', enabled: true, isDefault: true, configJson: {}, createdAt: new Date(), updatedAt: new Date() }]);
    const service = new AiProviderService(prisma);
    const [provider] = await service.listProviders();
    expect(provider).toMatchObject({ apiKeyConfigured: true, apiKeyLast4: '1234' });
    expect(provider).not.toHaveProperty('apiKey');
    expect(provider).not.toHaveProperty('apiKeyCiphertext');
  });

  it('does not allow the development encryption fallback in production', () => {
    expect(() => resolveAiCredentialEncryptionKey(undefined, 'production')).toThrow(
      /AI_CREDENTIAL_ENCRYPTION_KEY/i,
    );
    const previousNodeEnv = process.env.NODE_ENV;
    const previousKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    try {
      expect(() => new AiProviderService(prisma)).toThrow(
        /AI_CREDENTIAL_ENCRYPTION_KEY/i,
      );
      process.env.AI_CREDENTIAL_ENCRYPTION_KEY =
        '0123456789abcdef0123456789abcdef';
      expect(() => new AiProviderService(prisma)).not.toThrow();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
      else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = previousKey;
    }
  });
});
