import type { ExecutionContext } from '@nestjs/common';
import { ClusterAccessGuard } from './cluster-access.guard';

describe('ClusterAccessGuard', () => {
  function createContext(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('does not invoke access resolution for a platform-level route', async () => {
    const clusterAccess = { assertCanAccess: jest.fn() } as any;
    const guard = new ClusterAccessGuard(clusterAccess);

    await expect(
      guard.canActivate(createContext({ params: {}, user: {} })),
    ).resolves.toBe(true);
    expect(clusterAccess.assertCanAccess).not.toHaveBeenCalled();
  });

  it('resolves and attaches access context for a cluster route', async () => {
    const resolved = {
      clusterId: 'cluster-a',
      accessRole: 'viewer',
      source: 'role-binding',
    } as const;
    const clusterAccess = {
      assertCanAccess: jest.fn().mockResolvedValue(resolved),
    } as any;
    const guard = new ClusterAccessGuard(clusterAccess);
    const request = {
      params: { id: 'cluster-a' },
      user: { user: { id: 'user-1', role: 'read-only' } },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(clusterAccess.assertCanAccess).toHaveBeenCalledWith(
      request.user.user,
      'cluster-a',
    );
    expect(request).toMatchObject({ clusterAccess: resolved });
  });
});
