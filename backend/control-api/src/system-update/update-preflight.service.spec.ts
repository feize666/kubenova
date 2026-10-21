import { SystemUpdateService } from './system-update.service';

describe('system update preflight', () => {
  const originalVersion = process.env.KUBENOVA_VERSION;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.KUBENOVA_VERSION = 'v1.8';
    delete process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET;
    delete process.env.KUBENOVA_UPDATE_EXECUTOR_URL;
    delete process.env.KUBERNETES_SERVICE_HOST;
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
  });

  afterEach(() => {
    fetchMock.mockRestore();
    if (originalVersion === undefined) delete process.env.KUBENOVA_VERSION;
    else process.env.KUBENOVA_VERSION = originalVersion;
  });

  it('blocks update when the deployment executor and verified targets are not configured', async () => {
    const status = await new SystemUpdateService().preflight({ targetVersion: 'v1.9' });

    expect(status.preflight).toMatchObject({ status: 'failed', targetVersion: 'v1.9', expiresAt: null });
    expect(status.preflight?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '更新执行器', status: 'failed' }),
      expect.objectContaining({ name: '数据库备份目标', status: 'failed' }),
      expect.objectContaining({ name: '迁移测试目标', status: 'failed' }),
    ]));
  });
});
