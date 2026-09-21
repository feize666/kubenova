jest.mock('@kubernetes/client-node', () => ({}));
import { NotFoundException } from '@nestjs/common';
import { RuntimeController } from './runtime.controller';
import { LogsController } from '../logs/logs.controller';

describe('explicit runtime capabilities without legacy cluster bindings', () => {
  const req = { user: { user: { id: 'u', role: 'user' }, authzVersion: 2 }, headers: {} };
  const body = { clusterId: 'c', namespace: 'ai', pod: 'p', type: 'terminal' as const };
  const access = { assertCanRead: async () => { throw new NotFoundException(); }, assertCanMutate: async () => { throw new NotFoundException(); } };
  const identity = { resolve: async () => 'live-uid' };
  it('allows explicitly granted exec independently of resource-mutation permission', async () => {
    const authorize = jest.fn(async (q: any) => ({ allowed: q.capability === 'exec' && !q.mutation }));
    const service = { createSession: jest.fn(async () => ({ sessionId: 's' })) };
    const controller = new RuntimeController(service as never, access as never, { authorize } as never, identity as never);
    await expect(controller.createSession(body, req as never)).resolves.toEqual({ sessionId: 's' });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u', namespaceUid: 'live-uid', capability: 'exec', mutation: false }));
  });
  it('checks log grants even when the legacy enforcement flag is disabled', async () => {
    const service = { query: jest.fn(async () => 'logs'), createStreamSession: jest.fn() };
    const authorize = jest.fn(async () => ({ allowed: false, reasonCode: 'GRANT_NOT_FOUND' }));
    const controller = new LogsController(service as never, access as never, { authorize } as never, identity as never);
    await expect(controller.query(body, req as never)).rejects.toMatchObject({ status: 403 });
    expect(authorize).toHaveBeenCalled();
    expect(service.query).not.toHaveBeenCalled();
  });
  it.each(['runtime', 'logs'])('does not mask infrastructure failures in %s as grant fallback', async kind => {
    const failure = new Error('database unavailable');
    const unavailable = {
      assertCanRead: async () => { throw failure; },
      assertCanMutate: async () => { throw failure; },
    };
    const authorize = jest.fn(async () => ({ allowed: true }));
    const service = { query: jest.fn(), createSession: jest.fn() };
    const operation = kind === 'runtime'
      ? new RuntimeController(service as never, unavailable as never, { authorize } as never, identity as never).createSession(body, req as never)
      : new LogsController(service as never, unavailable as never, { authorize } as never, identity as never).query(body, req as never);
    await expect(operation).rejects.toBe(failure);
    expect(authorize).not.toHaveBeenCalled();
    expect(service.query).not.toHaveBeenCalled();
    expect(service.createSession).not.toHaveBeenCalled();
  });
  it('denies stream bootstrap without an explicit logs grant', async () => {
    const service = { createStreamSession: jest.fn() };
    const controller = new LogsController(service as never, access as never, { authorize: async () => ({ allowed: false }) } as never, identity as never);
    await expect(controller.createStreamSession(body, req as never)).rejects.toMatchObject({ status: 403 });
    expect(service.createStreamSession).not.toHaveBeenCalled();
  });
});
