jest.mock('@kubernetes/client-node', () => ({}));
import { ServiceUnavailableException } from '@nestjs/common';
import { AiAssistantService } from './ai-assistant.service';

describe('AI failure and context isolation', () => {
  function build() {
    const now = new Date();
    const session = { id: 's1', ownerUserId: 'u1', title: 'test', surface: 'mini', clusterContextJson: null, createdAt: now, updatedAt: now };
    const records = [{ id: 'm1', role: 'user', content: '检查镜像失败', createdAt: now }];
    const prisma = {
      aiConversationSession: { findFirst: jest.fn().mockResolvedValue(session), update: jest.fn().mockResolvedValue(session) },
      aiConversationMessage: { findMany: jest.fn().mockResolvedValue(records), create: jest.fn(({ data }) => Promise.resolve({ id: 'new', ...data })) },
      clusterRegistry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const providers = { chat: jest.fn().mockRejectedValue(new ServiceUnavailableException('模型超时')), chatStream: jest.fn().mockRejectedValue(new ServiceUnavailableException('模型超时')) };
    return { prisma, providers, service: new AiAssistantService(prisma as never, {} as never, providers as never) };
  }

  it('returns a real failure instead of persisting a fabricated assistant reply', async () => {
    const { service, prisma } = build();
    await expect(service.generateAssistantMessage('u1', 's1')).rejects.toThrow('模型超时');
    expect(prisma.aiConversationMessage.create).not.toHaveBeenCalled();
  });

  it('does not emit fallback diagnosis as successful stream output', async () => {
    const { service, prisma } = build();
    const onDelta = jest.fn();
    await expect(service.appendUserAndReplyStream('u1', 's1', '检查镜像失败', { onDelta })).rejects.toThrow('模型超时');
    expect(onDelta).not.toHaveBeenCalled();
    expect(prisma.aiConversationMessage.create.mock.calls.every(([{ data }]) => data.role === 'user')).toBe(true);
  });

  it('keeps a global conversation independent of the last cluster conversation', async () => {
    const { service, prisma, providers } = build();
    prisma.aiConversationSession.findFirst.mockImplementation(({ where }) => Promise.resolve(where.id ? { id: 's1', ownerUserId: 'u1', surface: 'mini', clusterContextJson: null, createdAt: new Date(), updatedAt: new Date() } : { clusterContextJson: { clusterId: 'old-cluster' } }));
    providers.chat.mockResolvedValue({ content: '正常' } as never);
    await service.generateAssistantMessage('u1', 's1');
    expect(providers.chat.mock.calls[0][1][0].content).not.toContain('old-cluster');
  });
});
