import { Logger } from '@nestjs/common';
import { NotificationSchedulerService } from './notification-scheduler.service';

describe('NotificationSchedulerService', () => {
  const originalFlag = process.env.NOTIFICATION_DELIVERY_ENABLED;
  let service: NotificationSchedulerService;
  let prisma: { $queryRaw: jest.Mock };
  let worker: { runOnce: jest.Mock };
  let warnings: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    delete process.env.NOTIFICATION_DELIVERY_ENABLED;
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ clusterId: 'a' }]) };
    worker = { runOnce: jest.fn().mockResolvedValue(true) };
    warnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new NotificationSchedulerService(prisma as never, worker as never);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalFlag === undefined) delete process.env.NOTIFICATION_DELIVERY_ENABLED;
    else process.env.NOTIFICATION_DELIVERY_ENABLED = originalFlag;
  });

  it.each([undefined, 'false', '1', 'TRUE'])('does not dispatch unless explicitly enabled (%s)', async flag => {
    if (flag !== undefined) process.env.NOTIFICATION_DELIVERY_ENABLED = flag;
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(15000);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(worker.runOnce).not.toHaveBeenCalled();
  });

  function enable() {
    process.env.NOTIFICATION_DELIVERY_ENABLED = 'true';
    service.onModuleInit();
  }

  it('dispatches due clusters once every five seconds without duplicate timers', async () => {
    enable();
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(4999);
    expect(worker.runOnce).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(worker.runOnce).toHaveBeenCalledTimes(1);
    expect(worker.runOnce).toHaveBeenCalledWith('a');
  });

  it('does not overlap a running dispatch cycle', async () => {
    let release!: (value: boolean) => void;
    worker.runOnce.mockReturnValueOnce(new Promise<boolean>(resolve => { release = resolve; }));
    enable();
    await jest.advanceTimersByTimeAsync(20000);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    release(true);
    await jest.advanceTimersByTimeAsync(5000);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('bounds dispatch to twenty clusters and advances the cursor even on failures', async () => {
    prisma.$queryRaw.mockResolvedValueOnce(Array.from({ length: 20 }, (_, i) => ({ clusterId: `c${String(i).padStart(2, '0')}` })));
    worker.runOnce.mockRejectedValueOnce(new Error('secret endpoint token'));
    enable();
    await jest.advanceTimersByTimeAsync(5000);
    expect(worker.runOnce).toHaveBeenCalledTimes(20);
    await jest.advanceTimersByTimeAsync(5000);
    const [sql, ...values] = prisma.$queryRaw.mock.calls[1];
    expect(values).toContain('c19');
    expect(sql.join('?')).toMatch(/LIMIT 20/);
    expect(warnings.mock.calls.flat().join(' ')).not.toContain('secret endpoint token');
  });

  it('recovers after query failure without exposing database errors', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('postgres://password'));
    enable();
    await jest.advanceTimersByTimeAsync(10000);
    expect(worker.runOnce).toHaveBeenCalledWith('a');
    expect(warnings.mock.calls.flat().join(' ')).not.toContain('password');
  });

  it('drains active dispatch on shutdown and never starts remaining clusters', async () => {
    prisma.$queryRaw.mockResolvedValue([{ clusterId: 'a' }, { clusterId: 'b' }]);
    let release!: (value: boolean) => void;
    worker.runOnce.mockReturnValueOnce(new Promise<boolean>(resolve => { release = resolve; }));
    enable();
    await jest.advanceTimersByTimeAsync(5000);
    let stopped = false;
    const stopping = service.onModuleDestroy().then(() => { stopped = true; });
    await jest.advanceTimersByTimeAsync(10000);
    expect(stopped).toBe(false);
    release(true);
    await stopping;
    expect(worker.runOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10000);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch when shutdown occurs while selecting clusters', async () => {
    let release!: (value: { clusterId: string }[]) => void;
    prisma.$queryRaw.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    enable();
    await jest.advanceTimersByTimeAsync(5000);
    const stopping = service.onModuleDestroy();
    release([{ clusterId: 'a' }]);
    await stopping;
    expect(worker.runOnce).not.toHaveBeenCalled();
  });
});
