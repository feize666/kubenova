import { ForbiddenException } from '@nestjs/common';
jest.mock('@kubernetes/client-node', () => ({}));
import { AiAssistantAccessService } from './ai-assistant-access.service';

describe('AiAssistantAccessService', () => {
  const actor = { userId: 'user-1', username: 'reader', role: 'read-only' as const };

  it('allows platform administrators without a scoped grant', async () => {
    const service = new AiAssistantAccessService({} as never, {} as never);
    await expect(service.authorize({ ...actor, role: 'platform-admin' })).resolves.toMatchObject({ role: 'platform-admin' });
  });

  it('allows a user only when they have an AI-use grant', async () => {
    const authorization = { listEffectiveGrants: jest.fn().mockResolvedValue([{ capabilities: [{ capability: 'ai-assistant:use' }] }]) };
    const service = new AiAssistantAccessService(authorization as never, {} as never);
    await expect(service.authorize(actor)).resolves.toMatchObject({ role: 'read-only' });
    authorization.listEffectiveGrants.mockResolvedValue([]);
    await expect(service.authorize(actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns only active AI-enabled cluster and namespace scopes', async () => {
    const authorization = {
      listEffectiveGrants: jest.fn().mockResolvedValue([
        { clusterId: 'cluster-a', namespaces: [{ namespaceName: 'apps' }], capabilities: [{ capability: 'ai-assistant:use' }] },
        { clusterId: 'cluster-b', namespaces: [{ namespaceName: 'prod' }], capabilities: [{ capability: 'logs' }] },
      ]),
    };
    const service = new AiAssistantAccessService(authorization as never, {} as never);
    await expect(service.getAccess(actor)).resolves.toEqual({
      allowed: true,
      fullAccess: false,
      scopes: [{ clusterId: 'cluster-a', namespaces: ['apps'] }],
    });
  });

  it('checks the live namespace UID and requires mutation role on the same grant', async () => {
    const authorization = { authorize: jest.fn().mockResolvedValue({ allowed: true, role: 'operator' }) };
    const namespaceIdentity = { resolve: jest.fn().mockResolvedValue('uid-apps') };
    const service = new AiAssistantAccessService(authorization as never, namespaceIdentity as never);

    await expect(service.authorize(actor, { clusterId: 'cluster-1', namespace: 'apps', mutation: true })).resolves.toMatchObject({ role: 'cluster-operator' });
    expect(namespaceIdentity.resolve).toHaveBeenCalledWith('cluster-1', 'apps');
    expect(authorization.authorize).toHaveBeenCalledWith({
      userId: 'user-1', clusterId: 'cluster-1', namespaceUid: 'uid-apps', capability: 'ai-assistant:use', mutation: true,
    });
    authorization.authorize.mockResolvedValue({ allowed: false });
    await expect(service.authorize(actor, { clusterId: 'cluster-1', namespace: 'apps', mutation: true })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unscoped writes and partial cluster/namespace context', async () => {
    const service = new AiAssistantAccessService({} as never, {} as never);
    await expect(service.authorize(actor, { mutation: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.authorize(actor, { clusterId: 'cluster-1' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.authorize(actor, { requireScope: true })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
