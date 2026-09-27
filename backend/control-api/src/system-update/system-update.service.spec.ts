import { SystemUpdateService } from './system-update.service';
import { SystemUpdateController } from './system-update.controller';
import fs from 'node:fs/promises';

const repo = 'feize666/kubenova';
const release = {
  tag_name: 'v1.9',
  draft: false,
  prerelease: false,
  html_url: `https://github.com/${repo}/releases/tag/v1.9`,
  published_at: '2026-09-27T00:00:00Z',
  assets: ['kubenova-ubuntu.tar.gz', 'kubenova-ubuntu.tar.gz.sha256'].map(
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
      latestVersion: 'v1.9',
      updateAvailable: true,
      releaseReady: true,
      installable: false,
      updateCheckError: null,
      downloadUrl: `https://github.com/${repo}/releases/download/v1.9/kubenova-ubuntu.tar.gz`,
    });
  });
  it('does not offer bare tags when no release exists', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    expect(await checkedStatus()).toMatchObject({
      updateAvailable: false,
      updateCheckError: expect.any(String),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not treat an incomplete release as installable', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...release, assets: [] })),
    );
    expect(await checkedStatus()).toMatchObject({
      releaseReady: false,
      updateAvailable: false,
      updateCheckError: expect.any(String),
    });
  });
  it('ignores prereleases and unsafe download URLs', async () => {
    for (const body of [
      { ...release, prerelease: true },
      { ...release, tag_name: '../other' },
      {
        ...release,
        assets: release.assets.map((a) => ({
          ...a,
          browser_download_url: 'https://evil.example/archive',
        })),
      },
    ]) {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
      expect(await checkedStatus()).toMatchObject({
        updateAvailable: false,
        releaseReady: false,
        updateCheckError: expect.any(String),
      });
    }
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

  it('protects status and history for platform administrators only', () => {
    const controller = new SystemUpdateController(new SystemUpdateService());
    expect(() => controller.getStatus({ user: { user: { role: 'cluster-operator' } } })).toThrow();
    expect(() => controller.getHistory({ user: { user: { role: 'cluster-operator' } } })).toThrow();
    expect(() => controller.releases({ user: { user: { role: 'cluster-operator' } } })).toThrow();
    expect(controller.getStatus({ user: { user: { role: 'platform-admin' } } })).toHaveProperty('checkState');
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
});
