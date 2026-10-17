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
      {} as never,
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
      getSession: jest.fn().mockResolvedValue({
        ...reply.session,
        surface: 'console',
        clusterContext: { clusterId: 'cluster-1', namespace: 'kube-system' },
      }),
    };
    const aiActionExecutorService = {
      execute: jest.fn(),
    };

    const controller = new AiAssistantController(
      aiAssistantService as never,
      aiActionExecutorService as never,
      {} as never,
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
    expect(aiAssistantService.getSession).toHaveBeenCalledWith(
      'user-admin-1',
      'session-1',
    );
    expect(result).toEqual(reply);
  });

  it('does not auto-run when query descriptor lacks cluster context', async () => {
    const descriptor = createQueryDescriptor('');
    delete descriptor.target?.clusterId;
    const reply = createReply([descriptor]);

    const aiAssistantService = {
      appendUserAndReply: jest.fn().mockResolvedValue(reply),
      getSession: jest.fn().mockResolvedValue({
        ...reply.session,
        surface: 'console',
        clusterContext: { clusterId: 'cluster-1', namespace: 'kube-system' },
      }),
    };
    const aiActionExecutorService = {
      execute: jest.fn(),
    };

    const controller = new AiAssistantController(
      aiAssistantService as never,
      aiActionExecutorService as never,
      {} as never,
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
    expect(aiAssistantService.getSession).toHaveBeenCalledWith(
      'user-admin-1',
      'session-1',
    );
    expect(result).toEqual(reply);
  });

  it('does not auto-run when auto-query bridge is disabled by env', async () => {
    process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE = 'false';
    const reply = createReply([createQueryDescriptor()]);

    const aiAssistantService = {
      appendUserAndReply: jest.fn().mockResolvedValue(reply),
      getSession: jest.fn().mockResolvedValue({
        ...reply.session,
        surface: 'console',
        clusterContext: { clusterId: 'cluster-1', namespace: 'kube-system' },
      }),
    };
    const aiActionExecutorService = {
      execute: jest.fn(),
    };

    const controller = new AiAssistantController(
      aiAssistantService as never,
      aiActionExecutorService as never,
      {} as never,
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
    expect(aiAssistantService.getSession).toHaveBeenCalledWith(
      'user-admin-1',
      'session-1',
    );
    expect(result).toEqual(reply);
  });

  it('routes write execution through the server-side approval gate', async () => {
    const aiActionExecutorService = { execute: jest.fn() };
    const aiActionApprovalService = { execute: jest.fn().mockResolvedValue({ status: 'success' }) };
    const controller = new AiAssistantController(
      {} as never,
      aiActionExecutorService as never,
      {} as never,
      aiActionApprovalService as never,
    );

    await controller.executeAction(adminReq as never, {
      action: { operation: 'restart-workload', target: { clusterId: 'cluster-1', namespace: 'apps', kind: 'Deployment', name: 'web' } },
      approvalId: 'approval-1',
    });

    expect(aiActionApprovalService.execute).toHaveBeenCalledWith(
      { userId: 'user-admin-1', username: 'admin@local.dev', role: 'platform-admin' },
      { operation: 'restart-workload', target: { clusterId: 'cluster-1', namespace: 'apps', kind: 'Deployment', name: 'web' } },
      'approval-1',
    );
    expect(aiActionExecutorService.execute).not.toHaveBeenCalled();
  });

  it('authorizes every target of a batch action before dispatch', async () => {
    const aiActionExecutorService = { execute: jest.fn() };
    const aiAssistantAccessService = {
      authorize: jest.fn()
        .mockResolvedValueOnce({ userId: 'user-admin-1', role: 'cluster-operator' })
        .mockRejectedValueOnce(new Error('scope denied')),
    };
    const controller = new AiAssistantController(
      {} as never,
      aiActionExecutorService as never,
      {} as never,
      {} as never,
      aiAssistantAccessService as never,
    );

    await expect(controller.executeAction(adminReq as never, {
      action: {
        operation: 'batch-enable',
        targets: [
          { clusterId: 'cluster-1', namespace: 'apps' },
          { clusterId: 'cluster-2', namespace: 'prod' },
        ],
      },
      approvalId: 'approval-1',
    })).rejects.toThrow('scope denied');
    expect(aiAssistantAccessService.authorize).toHaveBeenCalledTimes(2);
    expect(aiActionExecutorService.execute).not.toHaveBeenCalled();
  });

  it.each(['preview', 'execute'])('rejects conflicting namespace parameters before %s dispatch', async endpoint => {
    const executor = { execute: jest.fn(), preview: jest.fn() };
    const approvals = { execute: jest.fn(), preview: jest.fn() };
    const access = { authorize: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'read-only' }) };
    const controller = new AiAssistantController({} as never, executor as never, {} as never, approvals as never, access as never);
    const body = { action: {
      operation: 'query-pods-overview' as const,
      target: { clusterId: 'cluster-1', namespace: 'allowed' },
      options: { namespace: 'forbidden' },
    } };
    const request = endpoint === 'preview'
      ? controller.previewAction(body, adminReq as never)
      : controller.executeAction(adminReq as never, body);
    await expect(request).rejects.toThrow('命名空间参数不一致');
    expect(access.authorize).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
    expect(approvals.execute).not.toHaveBeenCalled();
    expect(approvals.preview).not.toHaveBeenCalled();
  });

  it('rechecks current access after preview and refuses execution after grant revocation', async () => {
    const executor = { execute: jest.fn() };
    const approvals = { preview: jest.fn().mockResolvedValue({ status: 'ok', approvalId: 'approval-1' }), execute: jest.fn() };
    const access = { authorize: jest.fn()
      .mockResolvedValueOnce({ userId: 'user-1', role: 'cluster-operator' })
      .mockRejectedValueOnce(new Error('grant revoked')) };
    const controller = new AiAssistantController({} as never, executor as never, {} as never, approvals as never, access as never);
    const body = { action: { operation: 'restart-workload' as const,
      target: { clusterId: 'cluster-1', namespace: 'apps', kind: 'Deployment', name: 'web' } } };
    await expect(controller.previewAction(body, adminReq as never)).resolves.toMatchObject({ approvalId: 'approval-1' });
    await expect(controller.executeAction(adminReq as never, { ...body, approvalId: 'approval-1' })).rejects.toThrow('grant revoked');
    expect(access.authorize).toHaveBeenCalledTimes(2);
    expect(approvals.execute).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('forces a scoped user-created floating session to the non-global context surface', async () => {
    const aiAssistantService = { createSession: jest.fn().mockResolvedValue({ id: 'session-2' }) };
    const aiAssistantAccessService = { authorize: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'read-only' }) };
    const controller = new AiAssistantController(
      aiAssistantService as never,
      {} as never,
      {} as never,
      {} as never,
      aiAssistantAccessService as never,
    );

    await controller.createSession({ surface: 'mini', clusterId: 'cluster-1', namespace: 'apps' }, {
      user: { user: { id: 'user-1', role: 'read-only' } },
    } as never);

    expect(aiAssistantService.createSession).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'user-1',
      surface: 'console',
      clusterId: 'cluster-1',
      namespace: 'apps',
    }));
  });

  it('omits historical mini sessions from scoped-user session lists', async () => {
    const sessions = [
      { id: 'full-cluster-session', surface: 'mini', clusterContext: { clusterId: 'cluster-1', namespace: 'apps' } },
      { id: 'scoped-session', surface: 'console', clusterContext: { clusterId: 'cluster-1', namespace: 'apps' } },
    ];
    const aiAssistantService = { listSessions: jest.fn().mockResolvedValue(sessions) };
    const aiAssistantAccessService = { authorize: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'read-only' }) };
    const controller = new AiAssistantController(
      aiAssistantService as never,
      {} as never,
      {} as never,
      {} as never,
      aiAssistantAccessService as never,
    );

    await expect(controller.listSessions({
      user: { user: { id: 'user-1', role: 'read-only' } },
    } as never)).resolves.toEqual([sessions[1]]);
  });
});
