jest.mock('@kubernetes/client-node', () => ({}));

import {
  ForbiddenException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { listAudits } from '../common/governance';
import type { ClusterRealtimeEvent } from './cluster-event-sync.service';
import { ClustersController } from './clusters.controller';

describe('ClustersController', () => {
  const accessRevalidationIntervalMs = 30_000;

  function createController() {
    const clustersService = {
      list: jest.fn(),
      listNodes: jest.fn(),
      getKubeconfig: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateProfile: jest.fn(),
      remove: jest.fn(),
      disable: jest.fn(),
      enable: jest.fn(),
      applyBatchState: jest.fn(),
      getDetail: jest.fn(),
      getKubeconfigById: jest.fn(),
      getExportableKubeconfig: jest.fn(),
      exportReadonlyKubeconfig: jest.fn(),
      findById: jest.fn(),
    } as any;
    const clusterSyncService = {
      syncCluster: jest.fn(),
    } as any;
    const clusterHealthService = {
      probeCluster: jest.fn(),
      getLegacyHealthResult: jest.fn(),
      listSelectableClusterIdsForResourceRead: jest.fn(),
    } as any;
    const clusterEventSyncService = {
      ensureClusterWatching: jest.fn(),
      subscribe: jest.fn(),
    } as any;
    const clusterAccessService = {
      listAccessibleClusterIds: jest.fn().mockResolvedValue(null),
      assertCanRead: jest.fn().mockResolvedValue({
        clusterId: 'c-1',
        accessRole: 'viewer',
        source: 'role-binding',
      }),
      assertCanMutate: jest.fn().mockResolvedValue({
        clusterId: 'c-1',
        accessRole: 'operator',
        source: 'role-binding',
      }),
      assertClusterAdmin: jest.fn().mockResolvedValue({
        clusterId: 'c-1',
        accessRole: 'cluster-admin',
        source: 'role-binding',
      }),
      assertPlatformAdmin: jest.fn(),
    } as any;

    return {
      controller: new ClustersController(
        clustersService,
        clusterSyncService,
        clusterHealthService,
        clusterEventSyncService,
        clusterAccessService,
      ),
      clustersService,
      clusterHealthService,
      clusterSyncService,
      clusterEventSyncService,
      clusterAccessService,
    };
  }

  function createResponse() {
    return {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
      send: jest.fn(),
    } as any;
  }

  function createSseConnection() {
    let closeHandler: (() => void) | undefined;
    const req = {
      headers: {},
      user: { user: { id: 'viewer-1', role: 'user' } },
      on: jest.fn((event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      }),
    } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    } as any;
    return {
      req,
      res,
      close: () => closeHandler?.(),
    };
  }

  const realtimeEvent = (
    clusterId: string,
    name: string,
  ): ClusterRealtimeEvent => ({
    clusterId,
    domains: ['workloads'],
    kind: 'pods',
    phase: 'MODIFIED',
    action: 'upsert',
    resource: {
      apiVersion: 'v1',
      kind: 'Pod',
      name,
      namespace: 'default',
      uid: `${name}-uid`,
      resourceVersion: '2',
      labels: { app: name },
      annotations: {},
      state: 'Running',
    },
    timestamp: '2026-09-10T10:00:00.000Z',
  });

  function findKubeconfigExportHandlers(): string[] {
    return Object.getOwnPropertyNames(ClustersController.prototype).filter(
      (methodName) => {
        const handler = (
          ClustersController.prototype as unknown as Record<string, unknown>
        )[methodName];
        return (
          typeof handler === 'function' &&
          Reflect.getMetadata(PATH_METADATA, handler) ===
            ':id/kubeconfig/export' &&
          Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.GET
        );
      },
    );
  }

  it('registers exactly one GET kubeconfig export handler', () => {
    expect(findKubeconfigExportHandlers()).toEqual([
      'exportReadonlyKubeconfig',
    ]);
  });

  it('exports only the short-lived read-only kubeconfig with hardened headers', async () => {
    const { controller, clustersService } = createController();
    const readonlyContent = [
      'apiVersion: v1',
      'users:',
      '- user:',
      '    token: short-lived-token',
      '',
    ].join('\n');
    clustersService.exportReadonlyKubeconfig.mockResolvedValue({
      filename: 'prod-readonly.kubeconfig',
      contentType: 'application/yaml; charset=utf-8',
      content: readonlyContent,
      serviceAccountName: 'aiops-export-reader-c-1',
      expiresAt: '2026-01-01T01:00:00.000Z',
    });
    clustersService.getExportableKubeconfig.mockResolvedValue({
      name: 'prod',
      kubeconfig: 'client-key-data: RAW-CLUSTER-ADMIN-KEY',
    });
    const req = {
      headers: { 'x-request-id': 'readonly-export-success' },
      user: {
        user: { username: 'operator', role: 'cluster-operator' },
      },
    } as any;
    const res = createResponse();

    await controller.exportReadonlyKubeconfig(req, res, 'c-1');

    expect(clustersService.exportReadonlyKubeconfig).toHaveBeenCalledWith(
      'c-1',
    );
    expect(clustersService.getExportableKubeconfig).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/yaml; charset=utf-8',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="prod-readonly.kubeconfig"; filename*=UTF-8''prod-readonly.kubeconfig`,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Kubeconfig-Mode',
      'readonly-export',
    );
    expect(res.send).toHaveBeenCalledWith(readonlyContent);

    const audit = listAudits({ requestId: 'readonly-export-success' });
    expect(audit.items).toHaveLength(1);
    expect(JSON.stringify(audit.items[0])).not.toContain('short-lived-token');
    expect(JSON.stringify(audit.items[0])).not.toContain(
      'RAW-CLUSTER-ADMIN-KEY',
    );
  });

  it('rejects read-only users before requesting any export credential', async () => {
    const { controller, clustersService, clusterAccessService } =
      createController();
    clusterAccessService.assertClusterAdmin.mockRejectedValue(
      new ForbiddenException(),
    );
    const req = {
      headers: {},
      user: { user: { username: 'viewer', role: 'read-only' } },
    } as any;
    const res = createResponse();

    await expect(
      controller.exportReadonlyKubeconfig(req, res, 'c-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(clustersService.exportReadonlyKubeconfig).not.toHaveBeenCalled();
    expect(clustersService.getExportableKubeconfig).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('sanitizes the download filename before writing response headers', async () => {
    const { controller, clustersService } = createController();
    clustersService.exportReadonlyKubeconfig.mockResolvedValue({
      filename: 'prod"\r\nX-Injected: yes/readonly.kubeconfig',
      contentType: 'application/yaml; charset=utf-8',
      content: 'apiVersion: v1\n',
      serviceAccountName: 'aiops-export-reader-c-1',
      expiresAt: '2026-01-01T01:00:00.000Z',
    });
    const req = {
      headers: {},
      user: {
        user: { username: 'operator', role: 'cluster-operator' },
      },
    } as any;
    const res = createResponse();

    await controller.exportReadonlyKubeconfig(req, res, 'c-1');

    const disposition = res.setHeader.mock.calls.find(
      ([name]: [string]) => name === 'Content-Disposition',
    )?.[1] as string;
    expect(disposition).toBe(
      `attachment; filename="prod-X-Injected-yes-readonly.kubeconfig"; filename*=UTF-8''prod-X-Injected-yes-readonly.kubeconfig`,
    );
    expect(disposition).not.toMatch(/[\r\n]/);
  });

  it('fails closed when read-only credential generation fails', async () => {
    const { controller, clustersService } = createController();
    clustersService.exportReadonlyKubeconfig.mockRejectedValue(
      new Error('token request failed'),
    );
    const req = {
      headers: { 'x-request-id': 'readonly-export-failure' },
      user: {
        user: { username: 'operator', role: 'cluster-operator' },
      },
    } as any;
    const res = createResponse();

    await expect(
      controller.exportReadonlyKubeconfig(req, res, 'c-1'),
    ).rejects.toThrow('token request failed');
    expect(clustersService.getExportableKubeconfig).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
    expect(
      listAudits({ requestId: 'readonly-export-failure' }).items,
    ).toHaveLength(0);
  });

  it('list filters selectable clusters when selectableOnly is enabled', async () => {
    const { controller, clustersService, clusterAccessService } =
      createController();
    clustersService.list.mockResolvedValue({
      items: [
        { id: 'c-1', state: 'active', hasKubeconfig: true, status: 'normal' },
        { id: 'c-2', state: 'active', hasKubeconfig: true, status: 'offline' },
        { id: 'c-3', state: 'disabled', hasKubeconfig: true },
      ],
      page: 1,
      pageSize: 10,
      total: 3,
      timestamp: new Date().toISOString(),
    });

    const req = { headers: {} } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
    } as any;

    const resp = await controller.list(req, res, {
      selectableOnly: 'true',
    } as any);

    expect(clustersService.list).toHaveBeenCalled();
    expect(clusterAccessService.listAccessibleClusterIds).toHaveBeenCalled();
    expect(resp.data.items).toHaveLength(1);
    expect(resp.data.items[0].id).toBe('c-1');
    expect(resp.data.total).toBe(1);
    expect(resp.meta.selectableOnly).toBe(true);
  });

  it('passes active bound cluster ids into regular list queries', async () => {
    const { controller, clustersService, clusterAccessService } =
      createController();
    clusterAccessService.listAccessibleClusterIds.mockResolvedValue([
      'cluster-a',
    ]);
    clustersService.list.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
      timestamp: new Date().toISOString(),
    });

    await controller.list(
      { headers: {}, user: { user: { id: 'u1', role: 'user' } } } as any,
      createResponse(),
      {} as any,
    );

    expect(clustersService.list).toHaveBeenCalledWith(
      {},
      { accessibleClusterIds: ['cluster-a'] },
    );
  });

  it('streams only events from clusters in the connection access snapshot', async () => {
    jest.useFakeTimers();
    const h = createController();
    const connection = createSseConnection();
    const unsubscribe = jest.fn();
    let listener: ((event: ClusterRealtimeEvent) => void) | undefined;
    h.clusterAccessService.listAccessibleClusterIds.mockResolvedValue([
      'cluster-a',
    ]);
    h.clusterEventSyncService.subscribe.mockImplementation(
      (next: (event: ClusterRealtimeEvent) => void) => {
        listener = next;
        return unsubscribe;
      },
    );

    await h.controller.streamEvents(connection.req, connection.res);
    listener?.(realtimeEvent('cluster-a', 'allowed-pod'));
    listener?.(realtimeEvent('cluster-b', 'blocked-pod'));
    listener?.({
      resource: { name: 'missing-cluster' },
    } as ClusterRealtimeEvent);

    expect(connection.res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify(realtimeEvent('cluster-a', 'allowed-pod'))}\n\n`,
    );
    expect(connection.res.write).not.toHaveBeenCalledWith(
      expect.stringContaining('blocked-pod'),
    );
    expect(connection.res.write).not.toHaveBeenCalledWith(
      expect.stringContaining('missing-cluster'),
    );
    connection.close();
    jest.useRealTimers();
  });

  it('streams every event to platform admins, including legacy events without clusterId', async () => {
    jest.useFakeTimers();
    const h = createController();
    const connection = createSseConnection();
    let listener: ((event: ClusterRealtimeEvent) => void) | undefined;
    h.clusterAccessService.listAccessibleClusterIds.mockResolvedValue(null);
    h.clusterEventSyncService.subscribe.mockImplementation(
      (next: (event: ClusterRealtimeEvent) => void) => {
        listener = next;
        return jest.fn();
      },
    );

    await h.controller.streamEvents(connection.req, connection.res);
    listener?.(realtimeEvent('cluster-b', 'admin-visible'));
    listener?.({
      resource: { name: 'legacy-visible' },
    } as ClusterRealtimeEvent);

    expect(connection.res.write).toHaveBeenCalledWith(
      expect.stringContaining('admin-visible'),
    );
    expect(connection.res.write).toHaveBeenCalledWith(
      expect.stringContaining('legacy-visible'),
    );
    connection.close();
    jest.useRealTimers();
  });

  it('does not stream resource events when the connection access snapshot is empty', async () => {
    jest.useFakeTimers();
    const h = createController();
    const connection = createSseConnection();
    let listener: ((event: ClusterRealtimeEvent) => void) | undefined;
    h.clusterAccessService.listAccessibleClusterIds.mockResolvedValue([]);
    h.clusterEventSyncService.subscribe.mockImplementation(
      (next: (event: ClusterRealtimeEvent) => void) => {
        listener = next;
        return jest.fn();
      },
    );

    await h.controller.streamEvents(connection.req, connection.res);
    listener?.(realtimeEvent('cluster-a', 'not-visible'));

    expect(connection.res.write).not.toHaveBeenCalledWith(
      expect.stringContaining('not-visible'),
    );
    connection.close();
    jest.useRealTimers();
  });

  it('stops streaming revoked cluster events after the access revalidation window', async () => {
    jest.useFakeTimers();
    const h = createController();
    const connection = createSseConnection();
    let listener: ((event: ClusterRealtimeEvent) => void) | undefined;
    h.clusterAccessService.listAccessibleClusterIds
      .mockResolvedValueOnce(['cluster-a'])
      .mockResolvedValue([]);
    h.clusterEventSyncService.subscribe.mockImplementation(
      (next: (event: ClusterRealtimeEvent) => void) => {
        listener = next;
        return jest.fn();
      },
    );

    try {
      await h.controller.streamEvents(connection.req, connection.res);
      listener?.(realtimeEvent('cluster-a', 'visible-before-revocation'));
      expect(connection.res.write).toHaveBeenCalledWith(
        expect.stringContaining('visible-before-revocation'),
      );

      connection.res.write.mockClear();
      await jest.advanceTimersByTimeAsync(accessRevalidationIntervalMs);
      listener?.(realtimeEvent('cluster-a', 'hidden-after-revocation'));

      expect(
        h.clusterAccessService.listAccessibleClusterIds,
      ).toHaveBeenCalledTimes(2);
      expect(connection.res.write).not.toHaveBeenCalledWith(
        expect.stringContaining('hidden-after-revocation'),
      );
    } finally {
      connection.close();
      jest.useRealTimers();
    }
  });

  it('closes the event stream when periodic access revalidation fails', async () => {
    jest.useFakeTimers();
    const h = createController();
    const connection = createSseConnection();
    const unsubscribe = jest.fn();
    h.clusterAccessService.listAccessibleClusterIds
      .mockResolvedValueOnce(['cluster-a'])
      .mockRejectedValueOnce(new Error('authorization store unavailable'));
    h.clusterEventSyncService.subscribe.mockReturnValue(unsubscribe);

    try {
      await h.controller.streamEvents(connection.req, connection.res);
      await jest.advanceTimersByTimeAsync(accessRevalidationIntervalMs);

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(connection.res.end).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      connection.close();
      jest.useRealTimers();
    }
  });

  it('does not initialize event streaming when the client closes during authorization', async () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const h = createController();
    const connection = createSseConnection();
    let resolveAccess: ((clusterIds: string[]) => void) | undefined;
    h.clusterAccessService.listAccessibleClusterIds.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveAccess = resolve;
        }),
    );
    h.clusterEventSyncService.subscribe.mockReturnValue(jest.fn());

    try {
      const stream = h.controller.streamEvents(connection.req, connection.res);
      connection.close();
      resolveAccess?.(['cluster-a']);
      await stream;

      expect(connection.res.end).toHaveBeenCalledTimes(1);
      expect(h.clusterEventSyncService.subscribe).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(connection.res.write).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      connection.close();
      setIntervalSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('unsubscribes and closes the SSE response when the client disconnects', async () => {
    jest.useFakeTimers();
    const h = createController();
    const connection = createSseConnection();
    const unsubscribe = jest.fn();
    h.clusterEventSyncService.subscribe.mockReturnValue(unsubscribe);

    await h.controller.streamEvents(connection.req, connection.res);
    connection.close();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(connection.res.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it.each([
    ['detail', 'detail', 'getDetail'],
    ['nodes', 'nodes', 'listNodes'],
    ['health', 'healthCheck', 'getLegacyHealthResult'],
    ['sync status', 'syncStatus', 'findById'],
  ])(
    'authorizes %s reads before downstream work',
    async (_label, method, downstream) => {
      const h = createController();
      h.clusterAccessService.assertCanRead.mockRejectedValue(
        new NotFoundException(),
      );
      await expect(
        h.controller[method](
          { headers: {}, user: { user: { id: 'u1', role: 'user' } } },
          createResponse(),
          'cluster-a',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        h.clustersService[downstream] ?? h.clusterHealthService[downstream],
      ).not.toHaveBeenCalled();
    },
  );

  it('authorizes sync mutation before reading cluster credentials', async () => {
    const h = createController();
    h.clusterAccessService.assertCanMutate.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      h.controller.triggerSync(
        { headers: {}, user: { user: { id: 'u1', role: 'user' } } } as any,
        createResponse(),
        'cluster-a',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.clustersService.findById).not.toHaveBeenCalled();
    expect(h.clustersService.getKubeconfig).not.toHaveBeenCalled();
    expect(h.clusterSyncService.syncCluster).not.toHaveBeenCalled();
  });

  it('requires platform admin before registry lifecycle work', async () => {
    const h = createController();
    h.clusterAccessService.assertPlatformAdmin.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(
      h.controller.update(
        {
          headers: {},
          user: { user: { id: 'u1', role: 'cluster-operator' } },
        } as any,
        createResponse(),
        'cluster-a',
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.clustersService.update).not.toHaveBeenCalled();
  });

  it('rejects non-admin batch lifecycle changes before any registry write', async () => {
    const h = createController();
    h.clusterAccessService.assertPlatformAdmin.mockImplementation(() => {
      throw new ForbiddenException();
    });

    await expect(
      h.controller.batchState(
        {
          headers: {},
          user: {
            user: { id: 'operator-1', role: 'cluster-operator' },
          },
        } as any,
        createResponse(),
        { ids: ['cluster-a'], action: 'disable' } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.clusterAccessService.assertPlatformAdmin).toHaveBeenCalledWith({
      id: 'operator-1',
      role: 'cluster-operator',
    });
    expect(h.clustersService.applyBatchState).not.toHaveBeenCalled();
  });

  it('allows platform admins to apply batch lifecycle changes', async () => {
    const h = createController();
    h.clustersService.applyBatchState.mockResolvedValue({
      status: 'success',
      result: [
        {
          id: 'cluster-a',
          action: 'disable',
          status: 'success',
          message: 'disabled',
        },
      ],
    });

    const response = await h.controller.batchState(
      {
        headers: {},
        user: { user: { id: 'admin-1', role: 'admin' } },
      } as any,
      createResponse(),
      { ids: ['cluster-a'], action: 'disable' } as any,
    );

    expect(h.clusterAccessService.assertPlatformAdmin).toHaveBeenCalledWith({
      id: 'admin-1',
      role: 'admin',
    });
    expect(h.clustersService.applyBatchState).toHaveBeenCalledWith({
      ids: ['cluster-a'],
      action: 'disable',
    });
    expect(response.data.status).toBe('success');
  });

  it('requires writable cluster-admin access before kubeconfig export', async () => {
    const h = createController();
    h.clusterAccessService.assertClusterAdmin.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      h.controller.exportReadonlyKubeconfig(
        {
          headers: {},
          user: { user: { id: 'u1', role: 'cluster-operator' } },
        } as any,
        createResponse(),
        'cluster-a',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.clustersService.exportReadonlyKubeconfig).not.toHaveBeenCalled();
  });

  it('healthCheck returns legacy runtime status from health service', async () => {
    const { controller, clusterHealthService } = createController();
    clusterHealthService.getLegacyHealthResult.mockResolvedValue({
      ok: false,
      runtimeStatus: 'offline-mode',
      latencyMs: 0,
      version: 'v1.29.0',
      nodeCount: null,
      message: '离线模式，无法验证真实连接状态',
    });

    const req = { headers: {} } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
    } as any;

    const resp = await controller.healthCheck(req, res, 'c-1');

    expect(clusterHealthService.getLegacyHealthResult).toHaveBeenCalledWith(
      'c-1',
    );
    expect(resp.data).toEqual({
      ok: false,
      runtimeStatus: 'offline-mode',
      latencyMs: 0,
      version: 'v1.29.0',
      nodeCount: null,
      message: '离线模式，无法验证真实连接状态',
    });
    expect(resp.meta.action).toBe('health');
  });

  it('nodes returns worker node inventory envelope', async () => {
    const { controller, clustersService } = createController();
    clustersService.listNodes.mockResolvedValue({
      items: [
        {
          id: 'c-1:node-a',
          name: 'node-a',
          role: 'worker',
          roles: ['worker'],
          ready: true,
          internalIP: '10.0.0.1',
          externalIP: null,
          osImage: 'Ubuntu',
          kernelVersion: '6.8.0',
          containerRuntimeVersion: 'containerd://1.7',
          cpuCapacity: '8',
          memoryCapacity: '32Gi',
          cpuUsagePercent: null,
          memoryUsagePercent: null,
          taints: [],
          age: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
      clusterId: 'c-1',
      degraded: false,
      degradationReason: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const req = { headers: {} } as any;
    const res = {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
    } as any;

    const resp = await controller.nodes(req, res, 'c-1');

    expect(clustersService.listNodes).toHaveBeenCalledWith('c-1');
    expect(resp.data.total).toBe(1);
    expect(resp.data.items[0].cpuUsagePercent).toBeNull();
    expect(resp.meta.action).toBe('nodes');
  });
});
