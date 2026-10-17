jest.mock('@kubernetes/client-node', () => ({}));

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AiClusterController } from './ai-cluster.controller';

describe('AiClusterController cluster access', () => {
  function build() {
    const providers = {
      chat: jest.fn().mockResolvedValue({
        content: 'ok',
        providerId: 'provider-1',
        agentId: 'agent-1',
      }),
    };
    const clusterAccessService = {
      assertCanRead: jest.fn().mockResolvedValue({
        clusterId: 'canonical-cluster',
        accessRole: 'viewer',
        source: 'role-binding',
      }),
      assertPlatformAdmin: jest.fn(),
    };
    const aiAssistantAccess = { authorize: jest.fn().mockResolvedValue({ allowed: true }) };
    return {
      controller: new AiClusterController(
        providers as never,
        clusterAccessService as never,
        undefined,
        aiAssistantAccess as never,
      ),
      providers,
      clusterAccessService,
      aiAssistantAccess,
    };
  }

  it('rejects an unauthenticated chat request before invoking the provider', async () => {
    const { controller, providers, clusterAccessService } = build();
    clusterAccessService.assertCanRead.mockRejectedValue(
      new UnauthorizedException(),
    );

    await expect(
      controller.chat('cluster-a', { message: '检查状态' }, { headers: {} }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clusterAccessService.assertCanRead).toHaveBeenCalledWith(
      undefined,
      'cluster-a',
    );
    expect(providers.chat).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized analysis before invoking the provider', async () => {
    const { controller, providers, clusterAccessService } = build();
    clusterAccessService.assertCanRead.mockRejectedValue(
      new NotFoundException({ code: 'CLUSTER_NOT_FOUND_OR_INACCESSIBLE' }),
    );

    await expect(
      controller.analyze(
        'cluster-a',
        { evidence: { alerts: 1 } },
        { user: { user: { id: 'viewer-a', role: 'user' } } },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(providers.chat).not.toHaveBeenCalled();
  });

  it('authorizes chat and uses the canonical cluster id in the prompt', async () => {
    const { controller, providers, clusterAccessService, aiAssistantAccess } = build();

    await controller.chat(
      ' cluster-alias ',
      { message: '检查状态', context: { namespace: 'default' } },
      { user: { user: { id: 'operator-a', role: 'user' } } },
    );

    expect(clusterAccessService.assertCanRead).toHaveBeenCalledWith(
      { id: 'operator-a', role: 'user' },
      ' cluster-alias ',
    );
    expect(providers.chat).toHaveBeenCalledWith(undefined, expect.anything());
    expect(aiAssistantAccess.authorize).toHaveBeenCalledWith(
      { userId: 'operator-a', username: undefined, role: 'user' },
      { clusterId: 'canonical-cluster', namespace: 'default', requireScope: true },
    );
  });

  it('rejects cluster chat without an explicit namespace for scoped grants', async () => {
    const { controller, providers, aiAssistantAccess } = build();
    aiAssistantAccess.authorize.mockRejectedValue(new ForbiddenException());

    await expect(controller.chat(
      'cluster-a',
      { message: '检查状态' },
      { user: { user: { id: 'operator-a', role: 'user' } } },
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(providers.chat).not.toHaveBeenCalled();
  });

  it('rejects scoped roles from cluster-wide analysis context', async () => {
    const { controller, providers, clusterAccessService } = build();

    await expect(controller.analyze(
      'cluster-a',
      { agentId: 'agent-1', evidence: { status: 'healthy' } },
      { user: { user: { id: 'operator-a', role: 'operator' } } },
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(clusterAccessService.assertCanRead).toHaveBeenCalledWith(
      { id: 'operator-a', role: 'operator' },
      'cluster-a',
    );
    expect(providers.chat).not.toHaveBeenCalled();
  });

  it('validates the chat message after cluster authorization', async () => {
    const { controller, providers } = build();

    await expect(
      controller.chat(
        'cluster-a',
        { message: '   ' },
        { user: { user: { id: 'operator-a', role: 'operator' } } },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(providers.chat).not.toHaveBeenCalled();
  });

  it('uses server-side aggregated context and returns only sanitized evidence', async () => {
    const { providers, clusterAccessService } = build();
    const contextAggregator = {
      collect: jest.fn().mockResolvedValue({
        schemaVersion: '1.0',
        generatedAt: '2026-09-11T00:00:00.000Z',
        cluster: { id: 'canonical-cluster', name: 'prod' },
        supplementalEvidence: { symptom: 'slow', apiKey: '[REDACTED]' },
        degradedSources: [],
      }),
    };
    const controller = new AiClusterController(
      providers as never,
      clusterAccessService as never,
      contextAggregator as never,
    );

    const result = await controller.analyze(
      'cluster-a',
      { evidence: { symptom: 'slow', apiKey: 'do-not-return' } },
      { user: { user: { id: 'admin-a', role: 'platform-admin' } } },
    );

    expect(contextAggregator.collect).toHaveBeenCalledWith(
      'canonical-cluster',
      { evidence: { symptom: 'slow', apiKey: '[REDACTED]' } },
    );
    expect(providers.chat).toHaveBeenCalledWith(undefined, [
      expect.objectContaining({
        content: expect.stringContaining('观测上下文'),
      }),
    ]);
    expect(result.evidence).toEqual({ symptom: 'slow', apiKey: '[REDACTED]' });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
  });
});
