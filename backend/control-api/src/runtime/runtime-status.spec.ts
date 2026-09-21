import { RuntimeService } from './runtime.service';
jest.mock('@kubernetes/client-node', () => ({}));

describe('runtime gateway authorization status', () => {
  function setup(payload: object | null) {
    const sessions = { validateSessionTokenDetailed: jest.fn().mockResolvedValue({ payload }) };
    const clusters = { getKubeconfig: jest.fn() };
    return { service: new RuntimeService(sessions as never, clusters as never, {} as never), sessions, clusters };
  }
  const input = { sessionId: 's', runtimeToken: 'token', path: '/ws/logs' as const, internalSecret: process.env.RUNTIME_GATEWAY_INTERNAL_SECRET?.trim() || process.env.RUNTIME_TOKEN_SECRET?.trim() || 'dev-runtime-token-secret' };
  it('rejects an invalid gateway secret before accessing a session', async () => {
    const { service, sessions } = setup({});
    await expect(service.getGatewaySessionStatus({ ...input, internalSecret: 'invalid' })).rejects.toThrow();
    expect(sessions.validateSessionTokenDetailed).not.toHaveBeenCalled();
  });
  it.each([true, false])('returns only validity, never cluster credentials (%s)', async valid => {
    const { service, clusters } = setup(valid ? { userId: 'u', clusterId: 'c' } : null);
    expect(await service.getGatewaySessionStatus(input)).toEqual({ active: valid });
    expect(clusters.getKubeconfig).not.toHaveBeenCalled();
  });
});
