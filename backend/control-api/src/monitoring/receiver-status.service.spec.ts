import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReceiverStatusService } from './receiver-status.service';

describe('receiver status metadata', () => {
  const db = { clusterRegistry: { findFirst: jest.fn() }, alertReceiverCredential: { findUnique: jest.fn() } };
  const service = new ReceiverStatusService(db as never);
  beforeEach(() => { jest.resetAllMocks(); db.clusterRegistry.findFirst.mockResolvedValue({ id: 'a' }); });
  it('reports unconfigured without any token fields', async () => {
    db.alertReceiverCredential.findUnique.mockResolvedValue(null);
    expect(await service.get({ role: 'admin' }, 'a')).toEqual({ clusterId: 'a', configured: false, enabled: false, updatedAt: null });
  });
  it('whitelists metadata even if persistence returns secret fields', async () => {
    const date = new Date();
    db.alertReceiverCredential.findUnique.mockResolvedValue({ enabled: true, updatedAt: date, tokenHash: 'never-return', token: 'never-return' });
    expect(await service.get({ role: 'admin' }, 'a')).toEqual({ clusterId: 'a', configured: true, enabled: true, updatedAt: date });
  });
  it('rejects non-admins before reading credentials', async () => {
    await expect(service.get({ role: 'user' }, 'a')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.alertReceiverCredential.findUnique).not.toHaveBeenCalled();
  });
  it('rejects deleted or missing clusters before credential lookup', async () => {
    db.clusterRegistry.findFirst.mockResolvedValue(null);
    await expect(service.get({ role: 'admin' }, 'a')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.alertReceiverCredential.findUnique).not.toHaveBeenCalled();
  });
});
