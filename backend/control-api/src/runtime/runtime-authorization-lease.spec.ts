import { createRuntimeAuthorizationLease } from './runtime-authorization-lease';

describe('runtime authorization registration race', () => {
  const input = { sessionId: 'session', runtimeToken: 'token', expectedPath: '/ws/terminal' as const };
  const payload = { userId: 'user', exp: Math.floor(Date.now() / 1000) + 60 };
  function setup() {
    const controller = new AbortController();
    const lease = { signal: controller.signal, close: () => controller.abort() };
    const sessions = { validateSessionTokenDetailed: jest.fn().mockResolvedValue({ payload }) };
    const invalidation = { register: jest.fn(() => lease) };
    return { controller, lease, sessions, invalidation, run: () => createRuntimeAuthorizationLease(input, sessions as any, invalidation as any) };
  }
  it('returns a cancellable lease for a still-authorized session', async () => {
    const test = setup();
    const result = await test.run();
    expect(result.signal.aborted).toBe(false);
    test.controller.abort(); expect(result.signal.aborted).toBe(true);
  });
  it('rejects a revoke committed before registration, even if its notification was missed', async () => {
    const test = setup();
    test.sessions.validateSessionTokenDetailed.mockResolvedValueOnce({ payload }).mockResolvedValueOnce({ payload: null });
    await expect(test.run()).rejects.toThrow('revoked');
    expect(test.lease.signal.aborted).toBe(true);
  });
  it('rejects a notification during the final validation', async () => {
    const test = setup();
    test.sessions.validateSessionTokenDetailed.mockResolvedValueOnce({ payload }).mockImplementationOnce(async () => {
      test.controller.abort(); return { payload };
    });
    await expect(test.run()).rejects.toThrow('revoked');
  });
  it('closes the registered lease if the database validation fails', async () => {
    const test = setup();
    test.sessions.validateSessionTokenDetailed.mockResolvedValueOnce({ payload }).mockRejectedValueOnce(Error('DB unavailable'));
    await expect(test.run()).rejects.toThrow(); expect(test.lease.signal.aborted).toBe(true);
  });
});
