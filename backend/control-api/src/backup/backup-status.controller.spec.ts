import { ForbiddenException } from '@nestjs/common';
import { BackupStatusController } from './backup-status.controller';

describe('BackupStatusController', () => {
  it('keeps backup configuration behind the platform-admin boundary', async () => {
    const service = { getStatus: jest.fn().mockResolvedValue({ configuration: { ready: false } }) };
    const controller = new BackupStatusController(service as never);

    expect(() => controller.getStatus({ user: { user: { role: 'read-only' } } })).toThrow(ForbiddenException);
    await expect(controller.getStatus({ user: { user: { role: 'platform-admin' } } })).resolves.toEqual({ configuration: { ready: false } });
    expect(service.getStatus).toHaveBeenCalledTimes(1);
  });
});
