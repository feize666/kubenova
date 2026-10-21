import { SystemUpdateService } from './system-update.service';
import * as executorTransport from './executor-request';
import { SystemUpdateController } from './system-update.controller';
import fs from 'node:fs/promises';

const repo = 'feize666/kubenova';
const release = {
  tag_name: 'v1.9',
  draft: false,
  prerelease: false,
  html_url: `https://github.com/${repo}/releases/tag/v1.9`,
  published_at: '2026-09-27T00:00:00Z',
  assets: ['kubenova-ubuntu.tar.gz', 'kubenova-ubuntu.tar.gz.sha256', 'release-manifest.json'].map(
    (name) => ({
      name,
      size: 100,
      state: 'uploaded',
      browser_download_url: `https://github.com/${repo}/releases/download/v1.9/${name}`,
    }),
  ),
};

describe('release-backed system updates', () => {
  const originalVersion = process.env.KUBENOVA_VERSION;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    process.env.KUBENOVA_VERSION = 'v1.8';
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(release)));
  });
  afterEach(() => {
    fetchMock.mockRestore();
    if (originalVersion === undefined) delete process.env.KUBENOVA_VERSION;
    else process.env.KUBENOVA_VERSION = originalVersion;
  });
  async function checkedStatus() {
    const service = new SystemUpdateService();
    service.getStatus();
    await new Promise((resolve) => setImmediate(resolve));
    return service.getStatus();
  }

  it('reports the real build version and downloadable verified-release assets', async () => {
    expect(await checkedStatus()).toMatchObject({
      runningVersion: 'v1.8',
      deploymentMode: 'source',
      latestVersion: 'v1.9',
      updateAvailable: true,
      releaseReady: true,
      installable: false,
      updateCheckError: null,
      downloadUrl: `https://github.com/${repo}/releases/download/v1.9/kubenova-ubuntu.tar.gz`,
    });
  });
  it('explains that Kubernetes remains blocked until its dedicated updater is installed', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    const oldUrl = process.env.KUBENOVA_UPDATE_EXECUTOR_URL;
    try {
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
      delete process.env.KUBENOVA_UPDATE_EXECUTOR_URL;
      expect(await checkedStatus()).toMatchObject({
        deploymentMode: 'kubernetes',
        installable: false,
        manualUpdateReason: expect.stringContaining('专用持久化更新执行器尚未接入'),
      });
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
      if (oldUrl === undefined) delete process.env.KUBENOVA_UPDATE_EXECUTOR_URL;
      else process.env.KUBENOVA_UPDATE_EXECUTOR_URL = oldUrl;
    }
  });
  it('reports Kubernetes task submission as available but keeps installation gated until rehearsal passes', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    try {
      const service = new SystemUpdateService(undefined, { submit: jest.fn() } as never);
      expect(service.getStatus()).toMatchObject({ deploymentMode: 'kubernetes', installable: false, updateExecutorReady: true, installReady: false });
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
    }
  });
  it('never routes Kubernetes preflight or install through a configured host executor', async () => {
    const original = {
      host: process.env.KUBERNETES_SERVICE_HOST,
      socket: process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET,
      token: process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN,
      url: process.env.KUBENOVA_UPDATE_EXECUTOR_URL,
    };
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET = '/run/kubenova-update/executor.sock';
    process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN = 'a'.repeat(48);
    delete process.env.KUBENOVA_UPDATE_EXECUTOR_URL;
    const request = jest.spyOn(executorTransport, 'executorRequest');
    try {
      const service = new SystemUpdateService();
      const status = await service.preflight({ targetVersion: 'v1.9' });
      expect(status).toMatchObject({
        deploymentMode: 'kubernetes',
        installable: false,
        updateExecutorReady: false,
        releaseMode: 'manual',
        manualUpdateReason: expect.stringContaining('Kubernetes'),
      });
      expect(status.preflight?.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '更新执行器', status: 'failed', message: expect.stringContaining('Kubernetes') }),
      ]));
      expect(() => service.install({ confirm: true, targetVersion: 'v1.9' }, 'admin')).toThrow(/Kubernetes/);
      await expect(service.rollback({ confirm: true }, 'admin')).rejects.toThrow(/Kubernetes/);
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
      if (original.host === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = original.host;
      if (original.socket === undefined) delete process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET;
      else process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET = original.socket;
      if (original.token === undefined) delete process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN;
      else process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN = original.token;
      if (original.url === undefined) delete process.env.KUBENOVA_UPDATE_EXECUTOR_URL;
      else process.env.KUBENOVA_UPDATE_EXECUTOR_URL = original.url;
    }
  });

  it('persists Kubernetes preflight only when release, immutable images, and configured targets are ready', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    const images = {
      frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'a'.repeat(64)}`,
      controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'b'.repeat(64)}`,
      runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'c'.repeat(64)}`,
    };
    const tasks = { submit: jest.fn(async (payload) => ({
      id: 'preflight-task', payload, status: 'queued', phase: 'queued', percent: 0, message: null,
      attempt: 0, createdAt: new Date(), startedAt: null, completedAt: null, backupLocation: null, backupBytes: null, result: null,
    })), invalidateLatestPreflight: jest.fn(async () => undefined) };
    const settings = {
      get: jest.fn(async () => ({ backupTargets: [{ id: 'backup', name: 'backup target', configured: true }], migrationTargets: [{ id: 'migration', name: 'migration target', configured: true }] })),
      getForExecutor: jest.fn(async () => ({ backupTargets: [{ id: 'backup', name: 'backup target', type: 'local', location: '/backup', configured: true }], migrationTargets: [{ id: 'migration', name: 'migration target', type: 'local', configured: true }] })),
      fingerprint: jest.fn(async () => 'f'.repeat(64)),
    };
    try {
      const service = new SystemUpdateService(settings as never, tasks as never);
      (service as any).refreshLatestVersion = jest.fn(async () => undefined);
      (service as any).getReleases = jest.fn(async () => ({ items: [{ tag: 'v1.9', releaseReady: true, validationMessage: null }], error: null }));
      (service as any).fetchKubernetesImageDigests = jest.fn(async () => images);

      const status = await service.preflight({ targetVersion: 'v1.9', backupTargetId: 'backup', migrationTargetId: 'migration' });

      expect(tasks.submit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'preflight', targetVersion: 'v1.9', migrationTargetId: 'migration',
        settingsFingerprint: 'f'.repeat(64), images, preflightChecks: expect.arrayContaining([
          expect.objectContaining({ name: '正式发布资产', status: 'passed' }),
          expect.objectContaining({ name: '数据库备份目标', status: 'passed' }),
          expect.objectContaining({ name: '迁移测试目标', status: 'passed' }),
        ]),
      }));
      expect(status.preflight).toMatchObject({ taskId: 'preflight-task', status: 'running', targetVersion: 'v1.9' });
      expect(status.installReady).toBe(false);
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
    }
  });

  it('never queues Kubernetes rehearsal when the release, digest manifest, or settings are incomplete', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    const submit = jest.fn();
    const invalidateLatestPreflight = jest.fn(async () => undefined);
    try {
      const service = new SystemUpdateService({
        get: jest.fn(async () => ({ backupTargets: [], migrationTargets: [] })),
        getForExecutor: jest.fn(async () => ({ backupTargets: [], migrationTargets: [] })),
        fingerprint: jest.fn(async () => 'f'.repeat(64)),
      } as never, { submit, invalidateLatestPreflight } as never);
      (service as any).refreshLatestVersion = jest.fn(async () => undefined);
      (service as any).getReleases = jest.fn(async () => ({ items: [{ tag: 'v1.9', releaseReady: false, validationMessage: 'asset missing' }], error: null }));
      (service as any).fetchKubernetesImageDigests = jest.fn(async () => { throw new Error('manifest missing'); });

      const status = await service.preflight({ targetVersion: 'v1.9' });

      expect(submit).not.toHaveBeenCalled();
      expect(invalidateLatestPreflight).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ name: '正式发布资产', status: 'failed' }),
      ]), expect.stringContaining('之前的预检已失效'));
      expect(status.preflight).toMatchObject({ status: 'failed' });
      expect(status.installReady).toBe(false);
      expect(status.preflight?.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '正式发布资产', status: 'failed' }),
        expect.objectContaining({ name: 'Kubernetes 镜像清单', status: 'failed' }),
        expect.objectContaining({ name: '数据库备份目标', status: 'failed' }),
        expect.objectContaining({ name: '迁移测试目标', status: 'failed' }),
      ]));
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
    }
  });

  it('fails closed on Kubernetes install until the server has a passed bound backup and migration preflight', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    const submit = jest.fn();
    try {
      const service = new SystemUpdateService(undefined, { submit, get: jest.fn(), getLatestPreflight: jest.fn(async () => null) } as never);
      await expect(service.install({ confirm: true, targetVersion: 'v1.9', preflightId: 'any', backupTargetId: 'local' }, 'admin'))
        .rejects.toThrow(/重新运行预检|预检未通过/);
      expect(submit).not.toHaveBeenCalled();
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
    }
  });

  it('does not reuse a passed in-memory preflight after a newer durable rehearsal failed', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    const failedTask = {
      id: 'latest-failed', action: 'preflight', status: 'failed', phase: 'failed', percent: null,
      message: 'migration failed', attempt: 1, createdAt: new Date(), startedAt: new Date(), completedAt: new Date(),
      backupLocation: null, backupBytes: null,
      payload: { action: 'preflight', preflightId: 'newer', preflightExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        targetVersion: 'v1.9', backupTargetId: 'local', migrationTargetId: 'test-db', settingsFingerprint: 'f'.repeat(64),
        images: { frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'a'.repeat(64)}`, controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'b'.repeat(64)}`, runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'c'.repeat(64)}` } },
      result: { checks: [{ name: 'migration', status: 'failed', message: 'migration failed' }] },
    };
    try {
      const service = new SystemUpdateService({ fingerprint: jest.fn(async () => 'f'.repeat(64)) } as never,
        { getLatestPreflight: jest.fn(async () => failedTask), submit: jest.fn() } as never);
      (service as any).state.preflight = { id: 'old-passed', status: 'passed', targetVersion: 'v1.9', deploymentMode: 'kubernetes',
        expiresAt: new Date(Date.now() + 60_000).toISOString(), backupTargetId: 'local', migrationTargetId: 'test-db',
        imageDigests: failedTask.payload.images, checks: [{ name: 'old', status: 'passed', message: 'passed' }] };

      await expect(service.install({ confirm: true, targetVersion: 'v1.9', preflightId: 'old-passed', backupTargetId: 'local' }, 'admin'))
        .rejects.toThrow(/重新运行预检/);
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
    }
  });

  it('submits a Kubernetes task only from the current, fully passed server-bound preflight', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    const images = {
      frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'a'.repeat(64)}`,
      controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'b'.repeat(64)}`,
      runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'c'.repeat(64)}`,
    };
    const submit = jest.fn(async (payload) => ({
      id: '00000000-0000-4000-8000-000000000001', payload, status: 'queued', phase: 'queued',
      percent: 0, message: null, attempt: 0, createdAt: new Date(0), startedAt: null, completedAt: null,
    }));
    const settings = {
      fingerprint: jest.fn(async () => 'settings-fingerprint'),
      getForExecutor: jest.fn(async () => ({ backupTargets: [{ id: 'local', configured: true }] })),
    };
    try {
      const service = new SystemUpdateService(settings as never, { submit, get: jest.fn(), getLatestPreflight: jest.fn(async () => null) } as never);
      (service as any).state.preflight = {
        id: 'preflight-current', status: 'passed', targetVersion: 'v1.9', deploymentMode: 'kubernetes',
        expiresAt: new Date(Date.now() + 60_000).toISOString(), backupTargetId: 'local', migrationTargetId: 'test-db',
        imageDigests: images, message: 'passed', checks: [{ name: 'backup and migration', status: 'passed', message: 'passed' }],
      };
      (service as any).preflightSettingsFingerprint = 'settings-fingerprint';

      const result = await service.install({ confirm: true, targetVersion: 'v1.9', preflightId: 'preflight-current', backupTargetId: 'local' }, 'admin');

      expect(submit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'install', targetVersion: 'v1.9', preflightId: 'preflight-current', images, operator: 'admin',
        backupTargetId: 'local',
      }));
      expect(result.installStatus).toBe('queued');
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
    }
  });

  it('submits a Kubernetes rollback only from the latest successful task and immutable previous image set', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    const oldVersion = process.env.KUBENOVA_VERSION;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    process.env.KUBENOVA_VERSION = 'v1.9';
    const previousImages = {
      frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'d'.repeat(64)}`,
      controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'e'.repeat(64)}`,
      runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'f'.repeat(64)}`,
    };
    const latest = {
      id: 'completed-install', action: 'install', status: 'succeeded', phase: 'completed', percent: 100,
      message: 'v1.9 installed', attempt: 1, createdAt: new Date(), startedAt: new Date(), completedAt: new Date(),
      backupLocation: '/backup/pre-v1.9.dump', backupBytes: '100',
      payload: { action: 'install', targetVersion: 'v1.9', previousVersion: 'v1.8', preflightId: 'preflight',
        preflightExpiresAt: new Date(Date.now() + 60_000).toISOString(), backupTargetId: 'backup', operator: 'admin', images: {
          frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'a'.repeat(64)}`,
          controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'b'.repeat(64)}`,
          runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'c'.repeat(64)}`,
        } },
      result: { previousImages, previousVersion: 'v1.8' },
    };
    const submit = jest.fn(async (payload) => ({
      id: 'rollback-task', payload, status: 'queued', phase: 'queued', percent: 0, message: null,
      attempt: 0, createdAt: new Date(), startedAt: null, completedAt: null, backupLocation: null, backupBytes: null, result: null,
    }));
    try {
      const service = new SystemUpdateService({ getForExecutor: jest.fn(async () => ({ backupTargets: [{ id: 'backup', type: 'local', location: '/backup' }] })), fingerprint: jest.fn(async () => 'f'.repeat(64)) } as never,
        { getLatest: jest.fn(async () => latest), submit } as never);

      const result = await service.rollback({ confirm: true, targetVersion: 'v1.8' }, 'admin');

      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ action: 'rollback', targetVersion: 'v1.8',
        previousVersion: 'v1.9', rollbackTaskId: 'completed-install', backupTargetId: 'backup', images: previousImages, operator: 'admin' }));
      expect(result.installStatus).toBe('queued');
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
      if (oldVersion === undefined) delete process.env.KUBENOVA_VERSION;
      else process.env.KUBENOVA_VERSION = oldVersion;
    }
  });

  it('blocks Kubernetes rollback while the latest task is not successful or its old images are mutable', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    const latest = { id: 'failed-install', action: 'install', status: 'failed', payload: { backupTargetId: 'backup' }, result: { previousVersion: 'v1.8', previousImages: {} } };
    try {
      const service = new SystemUpdateService({ getForExecutor: jest.fn(async () => ({ backupTargets: [{ id: 'backup' }] })) } as never,
        { getLatest: jest.fn(async () => latest), submit: jest.fn() } as never);

      await expect(service.rollback({ confirm: true }, 'admin')).rejects.toThrow(/没有通过校验/);
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
    }
  });

  it('restores Kubernetes task progress from the persistent queue when the API process restarts', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    const task = {
      id: '00000000-0000-4000-8000-000000000001',
      payload: { action: 'install', targetVersion: 'v1.9', preflightId: 'preflight', preflightExpiresAt: new Date(Date.now() + 60_000).toISOString(), operator: 'admin', images: {} },
      status: 'running', phase: 'health-check', percent: 72, message: 'waiting for deployment', attempt: 1,
      createdAt: new Date(0), startedAt: new Date(1), completedAt: null,
    };
    try {
      const service = new SystemUpdateService(undefined, { getLatest: jest.fn(async () => task), getLatestPreflight: jest.fn(async () => null) } as never);
      await expect(service.getStatusForApi()).resolves.toMatchObject({
        deploymentMode: 'kubernetes', installStatus: 'health-check',
        installProgress: { taskId: task.id, targetVersion: 'v1.9', percent: 72, message: task.message },
      });
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
    }
  });

  it('restores a rollback candidate from the latest successful durable task only when every prior image is pinned', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    const previousImages = {
      frontend: `ghcr.io/feize666/kubenova-frontend@sha256:${'d'.repeat(64)}`,
      controlApi: `ghcr.io/feize666/kubenova-control-api@sha256:${'e'.repeat(64)}`,
      runtimeGateway: `ghcr.io/feize666/kubenova-runtime-gateway@sha256:${'f'.repeat(64)}`,
    };
    const task = {
      id: '00000000-0000-4000-8000-000000000001',
      payload: { action: 'install', targetVersion: 'v1.9', preflightId: 'p', preflightExpiresAt: '', operator: 'admin', images: {} },
      status: 'succeeded', phase: 'completed', percent: 100, message: 'installed', attempt: 1,
      createdAt: new Date(0), startedAt: new Date(1), completedAt: new Date(2), backupLocation: '/backup', backupBytes: '100',
      result: { previousVersion: 'v1.8', previousImages },
    };
    try {
      const service = new SystemUpdateService(undefined, {
        getLatest: jest.fn(async () => task), getLatestPreflight: jest.fn(async () => null),
      } as never);

      await expect(service.getStatusForApi()).resolves.toMatchObject({
        backupVersion: 'v1.8',
        rollbackCandidates: [{ version: 'v1.8', backupAvailable: true, imageDigests: previousImages }],
      });
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
    }
  });

  it('uses durable Kubernetes task rows as operation history after an API restart', async () => {
    const task = {
      id: 'task-persisted',
      payload: { action: 'install', targetVersion: 'v1.9', preflightId: 'p', preflightExpiresAt: '', operator: 'platform-root', images: {} },
      status: 'failed', phase: 'rollback-incomplete', percent: null, message: 'rollback incomplete', attempt: 1,
      createdAt: new Date(0), startedAt: new Date(1), completedAt: new Date(2),
    };
    const service = new SystemUpdateService(undefined, { listRecent: jest.fn(async () => [task]) } as never);

    await expect(service.getHistoryForApi()).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ operationType: 'install', targetVersion: 'v1.9', result: 'failed', message: 'rollback incomplete', operator: 'platform-root' })],
    });
  });
  it('binds verified immutable image digests from the selected Kubernetes release manifest', async () => {
    const oldHost = process.env.KUBERNETES_SERVICE_HOST;
    const oldSocket = process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET;
    const oldUrl = process.env.KUBENOVA_UPDATE_EXECUTOR_URL;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    delete process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET;
    delete process.env.KUBENOVA_UPDATE_EXECUTOR_URL;
    const assets = release.assets.map((asset, index) => ({ ...asset, id: index + 1 }));
    const releaseWithIds = { ...release, assets };
    const manifest = {
      version: 'v1.9', repository: repo,
      images: {
        frontend: `ghcr.io/${repo}-frontend@sha256:${'a'.repeat(64)}`,
        controlApi: `ghcr.io/${repo}-control-api@sha256:${'b'.repeat(64)}`,
        runtimeGateway: `ghcr.io/${repo}-runtime-gateway@sha256:${'c'.repeat(64)}`,
      },
    };
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/releases/assets/3')) return new Response(JSON.stringify(manifest));
      if (url.endsWith('/releases/tags/v1.9')) return new Response(JSON.stringify(releaseWithIds));
      if (url.endsWith('/releases?per_page=100')) return new Response(JSON.stringify([releaseWithIds]));
      if (url.endsWith('/releases/latest')) return new Response(JSON.stringify(releaseWithIds));
      return new Response('{}', { status: 404 });
    });
    try {
      const status = await new SystemUpdateService().preflight({ targetVersion: 'v1.9' });
      expect(status.preflight).toMatchObject({
        status: 'failed',
        imageDigests: manifest.images,
        checks: expect.arrayContaining([
          expect.objectContaining({ name: 'Kubernetes 镜像清单', status: 'passed' }),
        ]),
      });
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/releases/assets/3'))).toBe(true);
    } finally {
      if (oldHost === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = oldHost;
      if (oldSocket === undefined) delete process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET;
      else process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET = oldSocket;
      if (oldUrl === undefined) delete process.env.KUBENOVA_UPDATE_EXECUTOR_URL;
      else process.env.KUBENOVA_UPDATE_EXECUTOR_URL = oldUrl;
    }
  });
  it('does not offer bare tags when no release exists', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    expect(await checkedStatus()).toMatchObject({
      updateAvailable: false,
      updateCheckError: expect.any(String),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('keeps an incomplete formal release visible without reporting a check failure', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        ...release,
        assets: release.assets.filter((asset) => asset.name !== 'release-manifest.json'),
      })),
    );
    expect(await checkedStatus()).toMatchObject({
      releaseReady: false,
      updateAvailable: false,
      checkState: 'available',
      updateCheckError: null,
      releaseValidationMessage: expect.stringContaining('release-manifest.json'),
    });
  });
  it('ignores prereleases and invalid tags, and warns on unsafe release assets', async () => {
    for (const body of [
      { ...release, prerelease: true },
      { ...release, tag_name: '../other' },
    ]) {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
      expect(await checkedStatus()).toMatchObject({
        updateAvailable: false,
        releaseReady: false,
        updateCheckError: expect.any(String),
      });
    }
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ...release,
      assets: release.assets.map((asset) => ({ ...asset, browser_download_url: 'https://evil.example/archive' })),
    })));
    expect(await checkedStatus()).toMatchObject({
      checkState: 'available',
      releaseReady: false,
      updateCheckError: null,
      releaseValidationMessage: expect.any(String),
    });
  });
  it('treats v1.9 and v1.9.0 as the same stable version', async () => {
    process.env.KUBENOVA_VERSION = 'v1.9.0';
    expect(await checkedStatus()).toMatchObject({
      updateAvailable: false,
      latestVersion: 'v1.9',
    });
  });
  it('surfaces a network failure instead of reporting no update', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'));
    expect(await checkedStatus()).toMatchObject({
      updateCheckError: expect.any(String),
      lastUpdateCheckAt: expect.any(String),
    });
  });
  it('retains verified release details on a failed forced check and recovers on success', async () => {
    const service = new SystemUpdateService();
    await service.checkForUpdates();
    fetchMock.mockRejectedValue(new Error('network unavailable'));
    expect(await service.checkForUpdates()).toMatchObject({
      checkState: 'error', latestVersion: 'v1.9', releaseReady: true,
      downloadUrl: `https://github.com/${repo}/releases/download/v1.9/kubenova-ubuntu.tar.gz`,
      updateCheckError: expect.any(String),
    });
    fetchMock.mockResolvedValue(new Response(JSON.stringify(release)));
    expect(await service.checkForUpdates()).toMatchObject({
      checkState: 'available', latestVersion: 'v1.9', updateCheckError: null,
    });
  });
  it('rejects simulated installation, restart and rollback without changing the running version', () => {
    const service = new SystemUpdateService();
    expect(() =>
      service.install({ confirm: true, targetVersion: 'v9.0' }, 'admin'),
    ).toThrow();
    expect(() => service.restart(true, 'admin')).toThrow();
    expect(() => service.rollback({ confirm: true }, 'admin')).toThrow();
    expect(service.getStatus()).toMatchObject({
      runningVersion: 'v1.8',
      backupAvailable: false,
    });
  });
  it('ignores the legacy virtual installed version when starting', async () => {
    const reader = jest
      .spyOn(fs, 'readFile')
      .mockResolvedValue(
        JSON.stringify({
          state: {
            runningVersion: 'v99.0',
            installedVersion: 'v99.0',
            backupAvailable: true,
          },
          history: [],
        }),
      );
    const service = new SystemUpdateService();
    try {
      await service.onModuleInit();
      expect(service.getStatus()).toMatchObject({
        runningVersion: 'v1.8',
        installedVersion: 'v1.8',
        backupAvailable: false,
      });
    } finally {
      service.onModuleDestroy();
      reader.mockRestore();
    }
  });
  it('allows administrators to force a check but not cluster operators', async () => {
    const controller = new SystemUpdateController(new SystemUpdateService());
    expect(() =>
      controller.check({ user: { user: { role: 'cluster-operator' } } }),
    ).toThrow();
    expect(
      await controller.check({ user: { user: { role: 'platform-admin' } } }),
    ).toMatchObject({ latestVersion: 'v1.9', releaseReady: true });
  });

  it('protects status and history for platform administrators only', async () => {
    const controller = new SystemUpdateController(new SystemUpdateService());
    expect(() => controller.getStatus({ user: { user: { role: 'cluster-operator' } } })).toThrow();
    expect(() => controller.getHistory({ user: { user: { role: 'cluster-operator' } } })).toThrow();
    expect(() => controller.releases({ user: { user: { role: 'cluster-operator' } } })).toThrow();
    await expect(controller.getStatus({ user: { user: { role: 'platform-admin' } } })).resolves.toHaveProperty('checkState');
  });


  it('marks the v1.11 to v1.1 numbering transition explicitly', async () => {
    process.env.KUBENOVA_VERSION = 'v1.11';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ...release,
      tag_name: 'v1.1',
      assets: release.assets.map((asset) => ({
        ...asset,
        browser_download_url: asset.browser_download_url.replace('/v1.9/', '/v1.1/'),
      })),
    })));
    expect(await checkedStatus()).toMatchObject({
      checkState: 'migration-required',
      migrationRequired: true,
      updateAvailable: false,
    });
  });
  it('never treats the new v1.2 series as legacy numbering', async () => {
    process.env.KUBENOVA_VERSION = 'v1.2.0';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ...release, tag_name: 'v1.1', assets: release.assets.map(asset => ({
        ...asset, browser_download_url: asset.browser_download_url.replace('/v1.9/', '/v1.1/'),
      })),
    })));
    expect(await checkedStatus()).toMatchObject({ checkState: 'ahead', migrationRequired: false, updateAvailable: false });
  });

  it('lists only formal releases with verified assets', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([
      { ...release, name: 'v1.9', body: 'notes' },
      { ...release, tag_name: 'v1.8', draft: true },
      { ...release, tag_name: 'v1.7', prerelease: true },
    ])));
    const service = new SystemUpdateService();
    await expect(service.getReleases()).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ tag: 'v1.9', releaseReady: true, notes: 'notes' })],
    });
  });
  it('recovers after a failed check and coalesces concurrent checks', async () => {
    const service = new SystemUpdateService();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await service.checkForUpdates()).toMatchObject({
      releaseReady: false,
    });
    const [one, two] = await Promise.all([
      service.checkForUpdates(),
      service.checkForUpdates(),
    ]);
    expect(one).toMatchObject({ releaseReady: true, updateCheckError: null });
    expect(two).toMatchObject({ releaseReady: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the formal releases list on 404 and selects the highest valid version', async () => {
    const candidates = [
        { ...release, tag_name: 'v1.10' },
        { ...release, tag_name: 'v1.2', prerelease: true },
        { ...release, tag_name: 'garbage' },
        { ...release, tag_name: 'v1.9' },
      ].map((item) => ({
        ...item,
        assets: item.assets.map((asset) => ({
          ...asset,
          browser_download_url: asset.browser_download_url.replace('/v1.9/', `/${item.tag_name}/`),
        })),
      }));
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(candidates)));
    expect(await new SystemUpdateService().checkForUpdates()).toMatchObject({ latestVersion: 'v1.10', releaseReady: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a distinct authorization, rate-limit, and timeout failure', async () => {
    for (const [status, message] of [[401, 'GitHub token unauthorized'], [403, 'GitHub access forbidden'], [429, 'GitHub rate limit exceeded']] as const) {
      fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
      const result = await new SystemUpdateService().checkForUpdates();
      expect(result.updateCheckError).toContain(message);
    }
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('deadline'), { name: 'TimeoutError' }));
    expect((await new SystemUpdateService().checkForUpdates()).updateCheckError).toContain('超时');
  });

  it('sends the optional GitHub token only to API requests and refreshes history after check', async () => {
    process.env.KUBENOVA_UPDATE_GITHUB_TOKEN = 'secret-token';
    const service = new SystemUpdateService();
    await service.getReleases();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(release)));
    await service.checkForUpdates();
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls.every(([, init]) => (init.headers as Record<string, string>)['authorization'] === 'Bearer secret-token')).toBe(true);
    delete process.env.KUBENOVA_UPDATE_GITHUB_TOKEN;
  });

  it('does not let an in-flight history request repopulate cache after manual check', async () => {
    let resolveHistory!: (value: Response) => void;
    const pendingHistory = new Promise<Response>((resolve) => { resolveHistory = resolve; });
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/releases?per_page=100')) return pendingHistory;
      return Promise.resolve(new Response(JSON.stringify(release)));
    });
    const service = new SystemUpdateService();
    const stale = service.getReleases();
    await new Promise((resolve) => setImmediate(resolve));
    await service.checkForUpdates();
    resolveHistory(new Response(JSON.stringify([release])));
    await stale;
    const fresh = { ...release, tag_name: 'v1.10', assets: release.assets.map((asset) => ({ ...asset, browser_download_url: asset.browser_download_url.replace('/v1.9/', '/v1.10/') })) };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([fresh])));
    const refreshed = await service.getReleases();
    expect(refreshed.items[0]?.tag).toBe('v1.10');
  });
});
