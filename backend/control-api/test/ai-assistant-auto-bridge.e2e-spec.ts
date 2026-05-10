import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AiAssistantController } from '../src/ai-assistant/ai-assistant.controller';
import { AiAssistantService } from '../src/ai-assistant/ai-assistant.service';
import { AiActionExecutorService } from '../src/ai-assistant/ai-action-executor.service';
import { AuthGuard } from '../src/common/auth.guard';

jest.mock('@kubernetes/client-node', () => ({}));

type MockAiAssistantService = {
  appendUserAndReply: jest.Mock;
  getSession: jest.Mock;
};

type MockAiActionExecutorService = {
  execute: jest.Mock;
};

class AdminPassGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      user?: { user?: { id?: string; username?: string; role?: string } };
    }>();
    req.user = {
      user: {
        id: 'admin-user-1',
        username: 'admin@local.dev',
        role: 'platform-admin',
      },
    };
    return true;
  }
}

function buildReply() {
  return {
    user: {
      id: 'msg-user-1',
      role: 'user' as const,
      content: '请查询当前 Pod 概览',
      createdAt: new Date().toISOString(),
    },
    assistant: {
      id: 'msg-assistant-1',
      role: 'assistant' as const,
      content: 'assistant reply',
      createdAt: new Date().toISOString(),
      actionDescriptors: [
        {
          id: 'action-query-pods',
          label: '查询 Pod 概览',
          kind: 'resource-operation',
          operation: 'query-pods-overview',
          target: { clusterId: 'cluster-1', namespace: 'kube-system' },
          options: { namespace: 'kube-system', limit: 20 },
          riskLevel: 'low',
        },
      ],
    },
    session: {
      id: 'session-1',
      title: 'session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    },
    actionDescriptors: [
      {
        id: 'action-query-pods',
        label: '查询 Pod 概览',
        kind: 'resource-operation',
        operation: 'query-pods-overview',
        target: { clusterId: 'cluster-1', namespace: 'kube-system' },
        options: { namespace: 'kube-system', limit: 20 },
        riskLevel: 'low',
      },
    ],
  };
}

describe('AI Assistant Auto Query Bridge (e2e)', () => {
  let app: INestApplication;
  let aiAssistantService: MockAiAssistantService;
  let aiActionExecutorService: MockAiActionExecutorService;
  const originalFlag = process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE;

  beforeAll(async () => {
    aiAssistantService = {
      appendUserAndReply: jest.fn(),
      getSession: jest.fn(),
    };
    aiActionExecutorService = {
      execute: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AiAssistantController],
      providers: [
        { provide: AiAssistantService, useValue: aiAssistantService },
        { provide: AiActionExecutorService, useValue: aiActionExecutorService },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(AdminPassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (originalFlag === undefined) {
      delete process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE;
    } else {
      process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE = originalFlag;
    }
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE;
  });

  it('auto executes query action and returns refreshed session', async () => {
    const reply = buildReply();
    const refreshedSession = {
      ...reply.session,
      messages: [
        {
          id: 'msg-writeback-1',
          role: 'assistant',
          content: '✅ 动作执行完成',
          createdAt: new Date().toISOString(),
        },
      ],
    };
    aiAssistantService.appendUserAndReply.mockResolvedValue(reply);
    aiAssistantService.getSession.mockResolvedValue(refreshedSession);
    aiActionExecutorService.execute.mockResolvedValue({
      status: 'success',
      requestId: 'req-1',
      operation: 'query-pods-overview',
    });

    const res = await request(app.getHttpServer())
      .post('/api/ai-assistant/sessions/session-1/messages')
      .send({
        message: '请查询当前 Pod 概览',
        clusterId: 'cluster-1',
        namespace: 'kube-system',
      })
      .expect(201);

    expect(aiAssistantService.appendUserAndReply).toHaveBeenCalledTimes(1);
    expect(aiActionExecutorService.execute).toHaveBeenCalledTimes(1);
    expect(aiAssistantService.getSession).toHaveBeenCalledWith(
      'admin-user-1',
      'session-1',
    );
    expect(res.body.session).toEqual(refreshedSession);
  });

  it('does not auto execute when feature flag is disabled', async () => {
    process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE = 'false';
    const reply = buildReply();
    aiAssistantService.appendUserAndReply.mockResolvedValue(reply);

    const res = await request(app.getHttpServer())
      .post('/api/ai-assistant/sessions/session-1/messages')
      .send({
        message: '请查询当前 Pod 概览',
        clusterId: 'cluster-1',
        namespace: 'kube-system',
      })
      .expect(201);

    expect(aiAssistantService.appendUserAndReply).toHaveBeenCalledTimes(1);
    expect(aiActionExecutorService.execute).not.toHaveBeenCalled();
    expect(aiAssistantService.getSession).not.toHaveBeenCalled();
    expect(res.body).toEqual(reply);
  });
});
