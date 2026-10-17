import { SystemUpdateService } from './system-update.service';
import * as transport from './executor-request';

describe('executor readiness and task recovery', () => {
  const saved = { ...process.env };
  let service: SystemUpdateService;
  let request: jest.SpyInstance;
  beforeEach(() => {
    process.env.KUBENOVA_VERSION = 'v1.1';
    jest.spyOn(transport, 'executorConfigured').mockReturnValue(true);
    request = jest.spyOn(transport, 'executorRequest');
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    service = new SystemUpdateService();
    jest.spyOn(service as any, 'recordOperation').mockImplementation(() => {});
  });
  afterEach(() => { service.onModuleDestroy(); jest.restoreAllMocks(); process.env = { ...saved }; });
  it('does not advertise installability from configuration alone', async () => {
    request.mockRejectedValue(new Error('unreachable'));
    expect((await service.checkForUpdates()).installable).toBe(false);
    request.mockResolvedValue(new Response(JSON.stringify({ ready: false, reason: 'Docker unavailable' })));
    expect(await service.checkForUpdates()).toMatchObject({ installable: false, manualUpdateReason: 'Docker unavailable' });
  });
  it('recovers a host task after API restart and preserves it during temporary disconnection', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ ready: true, latestTask: {
      taskId: 'abc', action: 'install', targetVersion: 'v1.2', status: 'running', phase: 'switching', percent: 65,
    } })));
    expect(await service.checkForUpdates()).toMatchObject({ installable: true, installStatus: 'switching', installProgress: { taskId: 'abc', percent: 65 } });
    request.mockRejectedValue(new Error('temporary disconnect'));
    expect(await service.checkForUpdates()).toMatchObject({ installable: false, installStatus: 'switching', installProgress: { taskId: 'abc' } });
  });
  it('rejects submission when the host is not ready', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ ready: false, reason: 'Docker unavailable' })));
    await expect(service.install({ confirm: true, targetVersion: 'v1.2' }, 'admin')).rejects.toThrow('Docker unavailable');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/v1/system-update/status');
  });
  it('never replaces the current build identity with a completed target version', async () => {
    request.mockImplementation(async () => new Response(JSON.stringify({ ready: true, backupVersion: 'v1.1', latestTask: {
      taskId: 'done', action: 'install', targetVersion: 'v1.2', status: 'succeeded', phase: 'completed', percent: 100,
    } })));
    // Avoid emitting audit logs in this isolated state test.
    jest.spyOn(require('../common/governance'), 'appendAudit').mockImplementation(() => {});
    expect(await service.checkForUpdates()).toMatchObject({ runningVersion: 'v1.1', installedVersion: 'v1.1', installStatus: 'installed-not-active', backupVersion: 'v1.1' });
    await service.checkForUpdates();
    expect((service as any).recordOperation).toHaveBeenCalledTimes(1);
  });
});
