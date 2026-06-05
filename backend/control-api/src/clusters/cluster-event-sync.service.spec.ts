const mockWatchDoneCallbacks: Array<(err?: unknown) => void> = [];
const mockAbortFns: jest.Mock[] = [];

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromString: jest.fn(),
  })),
  Watch: jest.fn().mockImplementation(() => ({
    watch: jest.fn(
      async (
        _path: string,
        _queryParams: Record<string, unknown>,
        _callback: unknown,
        done: (err?: unknown) => void,
      ) => {
        mockWatchDoneCallbacks.push(done);
        const abort = jest.fn(() => done(new Error('aborted')));
        mockAbortFns.push(abort);
        return { abort };
      },
    ),
  })),
  SERVER_SIDE_CLOSE: Symbol('SERVER_SIDE_CLOSE'),
}));

import { ClusterEventSyncService } from './cluster-event-sync.service';

describe('ClusterEventSyncService watch restarts', () => {
  function createService() {
    const clustersService = {
      list: jest.fn(),
      getKubeconfig: jest.fn().mockResolvedValue('apiVersion: v1'),
    } as any;
    const clusterSyncService = {
      syncCluster: jest.fn(),
    } as any;
    const service = new ClusterEventSyncService(
      clustersService,
      clusterSyncService,
    );
    return { service, clustersService, clusterSyncService };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockWatchDoneCallbacks.length = 0;
    mockAbortFns.length = 0;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('does not schedule restart when replacing an active watch', async () => {
    const { service } = createService();
    const scheduleRestart = jest.spyOn(service as any, 'scheduleRestart');

    await service.ensureClusterWatching('c-1');
    expect(mockAbortFns).toHaveLength(21);

    await service.ensureClusterWatching('c-1');

    expect(scheduleRestart).not.toHaveBeenCalled();
    expect((service as any).restartTimers.size).toBe(0);
  });

  it('keeps one restart timer when multiple watch targets end together', async () => {
    const { service } = createService();

    await service.ensureClusterWatching('c-1');

    mockWatchDoneCallbacks[0]?.(new Error('ECONNRESET'));
    mockWatchDoneCallbacks[1]?.(new Error('ETIMEDOUT'));

    expect((service as any).restartTimers.size).toBe(1);
    expect((service as any).restartFailures.get('c-1')).toBe(1);
  });
});
