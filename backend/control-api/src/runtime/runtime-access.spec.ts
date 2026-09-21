import { ForbiddenException } from '@nestjs/common';
import { RuntimeController } from './runtime.controller';
import { LogsController } from '../logs/logs.controller';

jest.mock('@kubernetes/client-node', () => ({}));

describe('runtime HTTP authorization boundaries', () => {
  const actor = { id: 'authenticated-user', username: 'reader', role: 'read-only' };
  const request = { user: { user: actor, authzVersion: 7 }, headers: {} };
  const target = { clusterId: 'cluster-a', namespace: 'dev', pod: 'app', type: 'terminal' as const };
  function setup() {
    const service = { createSession: jest.fn().mockResolvedValue({ sessionId: 's1' }) };
    const access = { assertCanRead: jest.fn(), assertCanMutate: jest.fn() };
    return { service, access, controller: new RuntimeController(service as never, access as never) };
  }

  it('refuses terminal creation before issuing a token for a read-only actor', async () => {
    const { controller, access, service } = setup();
    access.assertCanMutate.mockRejectedValue(new ForbiddenException());
    await expect(controller.createSession(target, request as never)).rejects.toThrow(ForbiddenException);
    expect(access.assertCanMutate).toHaveBeenCalledWith(actor, 'cluster-a');
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it('ignores a forged userId and binds the session to the authenticated actor', async () => {
    const { controller, access, service } = setup();
    await controller.createSession({ ...target, userId: 'administrator', authzVersion: 999 }, request as never);
    expect(access.assertCanMutate).toHaveBeenCalledWith(actor, 'cluster-a');
    expect(service.createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: actor.id, authzVersion: 7 }), expect.any(Object));
  });

  it('checks read permission for runtime log sessions', async () => {
    const { controller, access } = setup();
    await controller.createSession({ ...target, type: 'logs' }, request as never);
    expect(access.assertCanRead).toHaveBeenCalledWith(actor, 'cluster-a');
    expect(access.assertCanMutate).not.toHaveBeenCalled();
  });

  it('rejects cross-cluster log queries including the legacy cluster alias', async () => {
    const service = { query: jest.fn(), createStreamSession: jest.fn() };
    const access = { assertCanRead: jest.fn().mockRejectedValue(new ForbiddenException()) };
    const controller = new LogsController(service as never, access as never);
    await expect(controller.query({ cluster: 'cluster-b', namespace: 'dev', pod: 'app' }, request as never)).rejects.toThrow(ForbiddenException);
    await expect(controller.createStreamSession({ ...target, clusterId: 'cluster-b' }, request as never)).rejects.toThrow(ForbiddenException);
    expect(access.assertCanRead).toHaveBeenCalledWith(actor, 'cluster-b');
    expect(service.query).not.toHaveBeenCalled();
    expect(service.createStreamSession).not.toHaveBeenCalled();
  });

  it('passes authenticated ownership through log stream bootstrap', async () => {
    const service = { createStreamSession: jest.fn() };
    const access = { assertCanRead: jest.fn() };
    const controller = new LogsController(service as never, access as never);
    await controller.createStreamSession(target, request as never);
    expect(service.createStreamSession).toHaveBeenCalledWith(target, expect.objectContaining({ userId: actor.id, authzVersion: 7 }));
  });
});
