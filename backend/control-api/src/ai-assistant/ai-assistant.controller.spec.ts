jest.mock('@kubernetes/client-node', () => ({}));

import { AiAssistantController } from './ai-assistant.controller';
import type { AiActionDescriptor } from './types';

describe('AiAssistantController', () => {
  const originalAutoBridge = process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE;

  afterEach(() => {
    if (originalAutoBridge === undefined) {
      delete process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE;
      return;
    }
    process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE = originalAutoBridge;
  });

  const adminReq = {
    user: {
      user: {
        id: 'user-admin-1',
        username: 'admin@local.dev',
        role: 'platform-admin',
      },
    },
  } as const;

  function createReply(
    descriptors: AiActionDescriptor[],
    sessionId = 'session-1',
  ) {
    return {
      user: {
        id: 'msg-user-1',
        role: 'user' as const,
        content: 'query',
        createdAt: new Date().toISOString(),
      },
      assistant: {
        id: 'msg-assistant-1',
        role: 'assistant' as const,
        content: 'assistant reply',
        createdAt: new Date().toISOString(),
        actionDescriptors: descriptors,
      },
      session: {
        id: sessionId,
        title: 'session',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      },
      actionDescriptors: descriptors,
    };
  }

  function createQueryDescriptor(clusterId = 'cluster-1'): AiActionDescriptor {
    return {
      id: 'action-query-pods',
      label: '查询 Pod 概览',
      kind: 'resource-operation',
      operation: 'query-pods-overview',
      target: {
        clusterId,
        namespace: 'kube-system',
      },
      options: {
        namespace: 'kube-system',
        limit: 20,
      },
      riskLevel: 'low',
    };
  }

  it('auto-runs low-risk query action for natural-language query intent', async () => {
    const reply = createReply([createQueryDescriptor()]);
    const refreshedSession = {
      ...reply.session,
      messages: [
        {
          id: 'msg-writeback-1',
          role: 'assistant' as const,
          content: '✅ 动作执行完成',
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const aiAssistantService = {
      appendUserAndReply: jest.fn().mockResolvedValue(reply),
      getSession: jest.fn().mockResolvedValue(refreshedSession),
    };
    const aiActionExecutorService = {
      execute: jest.fn().mockResolvedValue({
        status: 'success',
        requestId: 'req-1',
        operation: 'query-pods-overview',
      }),
    };

    const controller = new AiAssistantController(
      aiAssistantService as never,
      aiActionExecutorService as never,
    );

    const result = await controller.sendMessage(
      'session-1',
      {
        message: '请查询当前 Pod 概览',
        clusterId: 'cluster-1',
        namespace: 'kube-system',
      },
      adminReq,
    );

    expect(aiAssistantService.appendUserAndReply).toHaveBeenCalledTimes(1);
    expect(aiActionExecutorService.execute).toHaveBeenCalledTimes(1);
    const firstCall = aiActionExecutorService.execute.mock.calls[0] as [
      { userId?: string },
      {
        operation?: string;
        sessionId?: string;
        target?: { clusterId?: string; namespace?: string };
      },
    ];
    expect(firstCall[0].userId).toBe('user-admin-1');
    expect(firstCall[1].operation).toBe('query-pods-overview');
    expect(firstCall[1].sessionId).toBe('session-1');
    expect(firstCall[1].target?.clusterId).toBe('cluster-1');
    expect(firstCall[1].target?.namespace).toBe('kube-system');
    expect(aiAssistantService.getSession).toHaveBeenCalledWith(
      'user-admin-1',
      'session-1',
    );
    expect(result.session).toEqual(refreshedSession);
  });

  it('does not auto-run when prompt explicitly asks not to execute', async () => {
    const reply = createReply([createQueryDescriptor()]);

    const aiAssistantService = {
      appendUserAndReply: jest.fn().mockResolvedValue(reply),
      getSession: jest.fn(),
    };
    const aiActionExecutorService = {
      execute: jest.fn(),
    };

    const controller = new AiAssistantController(
      aiAssistantService as never,
      aiActionExecutorService as never,
    );

    const result = await controller.sendMessage(
      'session-1',
      {
        message: '请查询当前 Pod 概览，但不要执行动作',
        clusterId: 'cluster-1',
        namespace: 'kube-system',
      },
      adminReq,
    );

    expect(aiAssistantService.appendUserAndReply).toHaveBeenCalledTimes(1);
    expect(aiActionExecutorService.execute).not.toHaveBeenCalled();
    expect(aiAssistantService.getSession).not.toHaveBeenCalled();
    expect(result).toEqual(reply);
  });

  it('does not auto-run when query descriptor lacks cluster context', async () => {
    const descriptor = createQueryDescriptor('');
    delete descriptor.target?.clusterId;
    const reply = createReply([descriptor]);

    const aiAssistantService = {
      appendUserAndReply: jest.fn().mockResolvedValue(reply),
      getSession: jest.fn(),
    };
    const aiActionExecutorService = {
      execute: jest.fn(),
    };

    const controller = new AiAssistantController(
      aiAssistantService as never,
      aiActionExecutorService as never,
    );

    const result = await controller.sendMessage(
      'session-1',
      {
        message: '请查询当前 Pod 概览',
      },
      adminReq,
    );

    expect(aiAssistantService.appendUserAndReply).toHaveBeenCalledTimes(1);
    expect(aiActionExecutorService.execute).not.toHaveBeenCalled();
    expect(aiAssistantService.getSession).not.toHaveBeenCalled();
    expect(result).toEqual(reply);
  });

  it('does not auto-run when auto-query bridge is disabled by env', async () => {
    process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE = 'false';
    const reply = createReply([createQueryDescriptor()]);

    const aiAssistantService = {
      appendUserAndReply: jest.fn().mockResolvedValue(reply),
      getSession: jest.fn(),
    };
    const aiActionExecutorService = {
      execute: jest.fn(),
    };

    const controller = new AiAssistantController(
      aiAssistantService as never,
      aiActionExecutorService as never,
    );

    const result = await controller.sendMessage(
      'session-1',
      {
        message: '请查询当前 Pod 概览',
        clusterId: 'cluster-1',
        namespace: 'kube-system',
      },
      adminReq,
    );

    expect(aiAssistantService.appendUserAndReply).toHaveBeenCalledTimes(1);
    expect(aiActionExecutorService.execute).not.toHaveBeenCalled();
    expect(aiAssistantService.getSession).not.toHaveBeenCalled();
    expect(result).toEqual(reply);
  });
});
