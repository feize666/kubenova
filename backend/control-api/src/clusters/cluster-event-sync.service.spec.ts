const mockWatchDoneCallbacks: Array<(err?: unknown) => void> = [];
const mockWatchEventCallbacks: Array<(phase: string, apiObj: unknown) => void> =
  [];
const mockAbortFns: Array<jest.Mock<void, []>> = [];
const mockWatchResolvers: Array<
  (value: { abort: jest.Mock<void, []> }) => void
> = [];
let mockWatchPendingCount = 0;
let mockWatchRejectCount = 0;

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromString: jest.fn(),
  })),
  Watch: jest.fn().mockImplementation(() => ({
    watch: jest.fn(
      async (
        _path: string,
        _queryParams: Record<string, unknown>,
        callback: (phase: string, apiObj: unknown) => void,
        done: (err?: unknown) => void,
      ) => {
        mockWatchEventCallbacks.push(callback);
        mockWatchDoneCallbacks.push(done);
        const abort = jest.fn(() => done(new Error('aborted')));
        mockAbortFns.push(abort);
        if (mockWatchRejectCount > 0) {
          mockWatchRejectCount -= 1;
          throw new Error('watch unavailable');
        }
        if (mockWatchPendingCount > 0) {
          mockWatchPendingCount -= 1;
          return new Promise<{ abort: jest.Mock<void, []> }>((resolve) => {
            mockWatchResolvers.push(resolve);
          });
        }
        return { abort };
      },
    ),
  })),
  SERVER_SIDE_CLOSE: Symbol('SERVER_SIDE_CLOSE'),
}));

import { ClusterEventSyncService } from './cluster-event-sync.service';
import type { ClusterSyncService } from './cluster-sync.service';
import type { ClustersService } from './clusters.service';

type WatchStateHarness = {
  debounceTimers: Map<string, NodeJS.Timeout>;
  restartFailures: Map<string, number>;
  restartTimers: Map<string, NodeJS.Timeout>;
  startupTimer: NodeJS.Timeout | null;
  stopForCluster: (clusterId: string) => void;
  watches: Map<string, Array<{ abort: () => void }>>;
};

describe('ClusterEventSyncService watch restarts', () => {
  async function flushMicrotasks(times = 4): Promise<void> {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  }

  function createService() {
    const clustersService = {
      list: jest.fn(),
      getKubeconfig: jest.fn().mockResolvedValue('apiVersion: v1'),
    } as unknown as ClustersService;
    const clusterSyncService = {
      syncCluster: jest.fn(),
    } as unknown as ClusterSyncService;
    const service = new ClusterEventSyncService(
      clustersService,
      clusterSyncService,
    );
    return {
      service,
      harness: service as unknown as WatchStateHarness,
      clustersService,
      clusterSyncService,
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockWatchDoneCallbacks.length = 0;
    mockWatchEventCallbacks.length = 0;
    mockAbortFns.length = 0;
    mockWatchResolvers.length = 0;
    mockWatchPendingCount = 0;
    mockWatchRejectCount = 0;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('does not schedule restart when replacing an active watch', async () => {
    const { service, harness } = createService();

    await service.ensureClusterWatching('c-1');
    expect(mockAbortFns).toHaveLength(21);

    await service.ensureClusterWatching('c-1');

    expect(harness.restartTimers.size).toBe(0);
  });

  it('clears startup timer on destroy before bootstrap starts', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { service, harness, clustersService } = createService();

    try {
      service.onModuleInit();
      expect(harness.startupTimer).toBeTruthy();

      service.onModuleDestroy();
      jest.advanceTimersByTime(120_000);

      expect(harness.startupTimer).toBeNull();
      expect(clustersService.list).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it('keeps one restart timer when multiple watch targets end together', async () => {
    const { service, harness } = createService();

    await service.ensureClusterWatching('c-1');

    mockWatchDoneCallbacks[0]?.(new Error('ECONNRESET'));
    mockWatchDoneCallbacks[1]?.(new Error('ETIMEDOUT'));

    expect(harness.restartTimers.size).toBe(1);
    expect(harness.restartFailures.get('c-1')).toBe(1);
  });

  it('ignores old watch callbacks after replacing a watch', async () => {
    const { service, harness } = createService();
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));

    await service.ensureClusterWatching('c-1');
    const oldEventCallback = mockWatchEventCallbacks[0];
    const oldDoneCallback = mockWatchDoneCallbacks[0];

    await service.ensureClusterWatching('c-1');

    oldEventCallback?.('MODIFIED', {
      metadata: { name: 'pod-1', resourceVersion: '1' },
    });
    oldDoneCallback?.(new Error('ECONNRESET'));

    expect(events).toHaveLength(0);
    expect(harness.debounceTimers.size).toBe(0);
    expect(harness.restartTimers.size).toBe(0);
  });

  it('clears pending debounce sync on destroy', async () => {
    const { service, harness, clusterSyncService } = createService();

    await service.ensureClusterWatching('c-1');
    mockWatchEventCallbacks[0]?.('MODIFIED', {
      metadata: { name: 'pod-1', resourceVersion: '1' },
    });
    expect(harness.debounceTimers.size).toBe(1);

    service.onModuleDestroy();
    jest.advanceTimersByTime(1500);
    await Promise.resolve();

    expect(harness.debounceTimers.size).toBe(0);
    expect(clusterSyncService.syncCluster).not.toHaveBeenCalled();
  });

  it('keeps restart backoff when a replacement watch only partially starts', async () => {
    const { service, harness } = createService();
    harness.restartFailures.set('c-1', 2);
    mockWatchRejectCount = 1;

    await service.ensureClusterWatching('c-1');

    expect(harness.watches.get('c-1')).toHaveLength(20);
    expect(harness.restartTimers.size).toBe(1);
    expect(harness.restartFailures.get('c-1')).toBe(3);
  });

  it('does not restart after stop clears an existing restart timer', async () => {
    const { service, harness } = createService();

    await service.ensureClusterWatching('c-1');

    mockWatchDoneCallbacks[0]?.(new Error('ECONNRESET'));
    expect(harness.restartTimers.size).toBe(1);

    harness.stopForCluster('c-1');
    expect(harness.restartTimers.size).toBe(0);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(mockAbortFns).toHaveLength(21);
    expect(harness.restartTimers.size).toBe(0);
  });

  it('aborts late watch handles from an obsolete generation', async () => {
    const { service, harness } = createService();
    mockWatchPendingCount = 1;

    const firstStart = service.ensureClusterWatching('c-1');
    await flushMicrotasks();
    expect(mockWatchResolvers).toHaveLength(1);

    await service.ensureClusterWatching('c-1');
    expect(harness.watches.get('c-1')).toHaveLength(21);

    mockWatchResolvers[0]?.({ abort: mockAbortFns[0] });
    await firstStart;

    expect(mockAbortFns[0]).toHaveBeenCalledTimes(1);
    const activeWatches = harness.watches.get('c-1');
    expect(activeWatches).toHaveLength(21);
    expect(activeWatches?.[0]?.abort).not.toBe(mockAbortFns[0]);
  });
});
