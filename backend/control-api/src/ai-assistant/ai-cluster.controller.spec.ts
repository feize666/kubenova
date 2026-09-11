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
    };
    return {
      controller: new AiClusterController(
        providers as never,
        clusterAccessService as never,
      ),
      providers,
      clusterAccessService,
    };
  }

  it('rejects an unauthenticated chat request before invoking the provider', async () => {
    const { controller, providers, clusterAccessService } = build();
    clusterAccessService.assertCanRead.mockRejectedValue(
      new UnauthorizedException(),
    );

    await expect(
      controller.chat(
        'cluster-a',
        { message: '检查状态' },
        { headers: {} },
      ),
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
    const { controller, providers, clusterAccessService } = build();

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
  });

  it('authorizes analysis and returns the canonical cluster id', async () => {
    const { controller, providers, clusterAccessService } = build();

    const result = await controller.analyze(
      'cluster-a',
      { agentId: 'agent-1', evidence: { status: 'healthy' } },
      { user: { user: { id: 'operator-a', role: 'operator' } } },
    );

    expect(clusterAccessService.assertCanRead).toHaveBeenCalledWith(
      { id: 'operator-a', role: 'operator' },
      'cluster-a',
    );
    expect(providers.chat).toHaveBeenCalledWith(
      'agent-1',
      [expect.objectContaining({ content: expect.stringContaining('canonical-cluster') })],
    );
    expect(result).toEqual(
      expect.objectContaining({ clusterId: 'canonical-cluster', evidence: { status: 'healthy' } }),
    );
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
});
