jest.mock('@kubernetes/client-node', () => ({}));

import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { listAudits } from '../common/governance';
import { ClustersController } from './clusters.controller';

describe('ClustersController', () => {
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

    return {
      controller: new ClustersController(
        clustersService,
        clusterSyncService,
        clusterHealthService,
        clusterEventSyncService,
      ),
      clustersService,
      clusterHealthService,
    };
  }

  function createResponse() {
    return {
      getHeader: jest.fn().mockReturnValue(undefined),
      setHeader: jest.fn(),
      send: jest.fn(),
    } as any;
  }

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
    const { controller, clustersService } = createController();
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
    const { controller, clustersService, clusterHealthService } =
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
    expect(resp.data.items).toHaveLength(1);
    expect(resp.data.items[0].id).toBe('c-1');
    expect(resp.data.total).toBe(1);
    expect(resp.meta.selectableOnly).toBe(true);
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
