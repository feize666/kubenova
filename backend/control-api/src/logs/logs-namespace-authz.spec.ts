jest.mock('@kubernetes/client-node', () => ({}));
import { LogsController } from './logs.controller';

describe('logs namespace enforcement', () => {
  const previous = process.env.KUBENOVA_AUTHZ_ENFORCE;
  beforeEach(() => { process.env.KUBENOVA_AUTHZ_ENFORCE = 'true'; });
  afterEach(() => {
    if (previous === undefined) delete process.env.KUBENOVA_AUTHZ_ENFORCE;
    else process.env.KUBENOVA_AUTHZ_ENFORCE = previous;
  });
  it.each(['query', 'alias', 'stream'])('resolves scope before %s', async mode => {
    const authorize = jest.fn().mockResolvedValue({ allowed: true });
    const resolve = jest.fn().mockResolvedValue('uid-apps');
    const Controller = LogsController as unknown as new (...args: any[]) => LogsController;
    const controller = new Controller({ query: async () => 'result', createStreamSession: async () => 'result' }, { assertCanRead: async () => {} }, { authorize }, { resolve });
    const request = { user: { user: { id: 'u' } }, headers: {} } as never;
    if (mode === 'stream') await controller.createStreamSession({ clusterId: 'c', namespace: 'apps', pod: 'p' }, request);
    else await controller.query((mode === 'alias' ? { cluster: 'c', ns: 'apps' } : { clusterId: 'c', namespace: 'apps' }) as never, request);
    expect(resolve).toHaveBeenCalledWith('c', 'apps');
    expect(authorize).toHaveBeenCalledWith({ userId: 'u', clusterId: 'c', namespaceUid: 'uid-apps', capability: 'logs', mutation: false });
  });
});
