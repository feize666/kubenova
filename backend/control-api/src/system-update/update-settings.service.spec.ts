import { UpdateSettingsService } from './update-settings.service';
import { decryptUpdateSettings, encryptUpdateSettings } from './update-settings.crypto';

describe('UpdateSettingsService', () => {
  const db = { systemUpdateSettings: { findUnique: jest.fn(), upsert: jest.fn() } };
  const key = '1'.repeat(64);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KUBENOVA_UPDATE_ENCRYPTION_KEY = key;
  });

  afterEach(() => delete process.env.KUBENOVA_UPDATE_ENCRYPTION_KEY);

  it('saves update settings encrypted and returns only public metadata', async () => {
    db.systemUpdateSettings.upsert.mockResolvedValue({
      id: 'singleton',
      encryptedData: 'stored',
      updatedBy: 'admin',
      updatedAt: new Date('2026-10-21T00:00:00Z'),
    });
    const service = new UpdateSettingsService(db as never);
    const result = await service.save({
      backupTargets: [{ id: 'local', name: '本机', type: 'local', location: '/var/lib/kubenova/backups', secret: { accessKey: 'hidden' } }],
      migrationTargets: [{ id: 'local-db', name: '本机测试库', type: 'local' }],
      registry: { defaultPrefix: 'ghcr.io/acme/kubenova', components: {}, imagePullSecretName: null, token: 'hidden' },
    }, 'admin');

    expect(db.systemUpdateSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'singleton' }, update: expect.objectContaining({ updatedBy: 'admin' }) }));
    expect(result).toMatchObject({ backupTargets: [{ id: 'local', name: '本机', type: 'local', location: '/var/lib/kubenova/backups', configured: true }], migrationTargets: [{ id: 'local-db', configured: false }], registry: { defaultPrefix: 'ghcr.io/acme/kubenova', imagePullSecretName: null, configured: true } });
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('rejects settings persistence when the independent encryption key is absent', async () => {
    delete process.env.KUBENOVA_UPDATE_ENCRYPTION_KEY;
    const service = new UpdateSettingsService(db as never);
    await expect(service.save({ backupTargets: [], migrationTargets: [], registry: { defaultPrefix: '', components: {}, imagePullSecretName: null } }, 'admin')).rejects.toThrow(/KUBENOVA_UPDATE_ENCRYPTION_KEY/);
  });

  it('produces a stable opaque fingerprint that changes after settings are saved', async () => {
    let encryptedData: string | null = null;
    db.systemUpdateSettings.findUnique.mockImplementation(async () => encryptedData ? { encryptedData } : null);
    db.systemUpdateSettings.upsert.mockImplementation(async ({ create, update }) => {
      encryptedData = encryptedData ? update.encryptedData : create.encryptedData;
      return { encryptedData };
    });
    const service = new UpdateSettingsService(db as never);
    const initial = await service.fingerprint();
    await service.save({ backupTargets: [], migrationTargets: [], registry: { defaultPrefix: '', components: {}, imagePullSecretName: null } }, 'admin');
    const configured = await service.fingerprint();
    expect(configured).not.toBe(initial);
    expect(await service.fingerprint()).toBe(configured);
    expect(configured).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects relative backup paths, malformed S3 locations, and non-PostgreSQL migration URLs', async () => {
    const service = new UpdateSettingsService(db as never);
    const registry = { defaultPrefix: '', components: {}, imagePullSecretName: null };
    await expect(service.save({ backupTargets: [{ id: 'local', name: '本地', type: 'local', location: 'backups' }], migrationTargets: [], registry }, 'admin')).rejects.toThrow(/绝对路径/);
    await expect(service.save({ backupTargets: [{ id: 's3', name: '对象存储', type: 's3', location: 'https://bucket.example/path' }], migrationTargets: [], registry }, 'admin')).rejects.toThrow(/s3:\/\//);
    await expect(service.save({ backupTargets: [{ id: 's3', name: '对象存储', type: 's3', location: 's3://bucket.example/backups', secret: { AWS_ACCESS_KEY_ID: 'access' } }], migrationTargets: [], registry }, 'admin')).rejects.toThrow(/AWS_SECRET_ACCESS_KEY/);
    await expect(service.save({ backupTargets: [{ id: 's3', name: '对象存储', type: 's3', location: 's3://bucket.example/backups', secret: { AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_PROFILE: 'default' } }], migrationTargets: [], registry }, 'admin')).rejects.toThrow(/不支持的字段/);
    await expect(service.save({ backupTargets: [], migrationTargets: [{ id: 'external', name: '外部测试库', type: 'external', connection: 'mysql://db/test' }], registry }, 'admin')).rejects.toThrow(/PostgreSQL/);
  });

  it('allows local rehearsal targets only on loopback PostgreSQL hosts', async () => {
    const service = new UpdateSettingsService(db as never);
    const registry = { defaultPrefix: '', components: {}, imagePullSecretName: null };
    await expect(service.save({ backupTargets: [], migrationTargets: [{ id: 'local', name: '本机', type: 'local', connection: 'postgresql://admin:secret@db.internal/kubenova' }], registry }, 'admin')).rejects.toThrow(/回环地址/);
    await expect(service.save({ backupTargets: [], migrationTargets: [{ id: 'local', name: '本机', type: 'local', connection: 'postgresql://admin:secret@[::1]/kubenova' }], registry }, 'admin')).resolves.toMatchObject({ migrationTargets: [{ id: 'local', configured: true }] });
  });

  it('preserves encrypted credentials and hidden migration connections when an unchanged target is edited', async () => {
    const existing = {
      backupTargets: [{ id: 's3', name: '对象存储', type: 's3' as const, location: 's3://bucket.example/backups', secret: { AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret' } }],
      migrationTargets: [{ id: 'local', name: '本机测试库', type: 'local' as const, connection: 'postgresql://admin:secret@127.0.0.1/kubenova' }],
      registry: { defaultPrefix: '', components: {}, imagePullSecretName: null, token: 'registry-token' },
    };
    db.systemUpdateSettings.findUnique.mockResolvedValue({ encryptedData: encryptUpdateSettings(existing, key) });
    let stored: string | undefined;
    db.systemUpdateSettings.upsert.mockImplementation(async ({ update }) => { stored = update.encryptedData; return { encryptedData: stored }; });
    const service = new UpdateSettingsService(db as never);

    await service.save({
      backupTargets: [{ id: 's3', name: '对象存储更新名称', type: 's3', location: 's3://bucket.example/backups' }],
      migrationTargets: [{ id: 'local', name: '本机测试库', type: 'local' }],
      registry: { defaultPrefix: '', components: {}, imagePullSecretName: null },
    }, 'admin');

    expect(decryptUpdateSettings(stored!, key)).toEqual({
      backupTargets: [{ ...existing.backupTargets[0], name: '对象存储更新名称' }],
      migrationTargets: existing.migrationTargets,
      registry: existing.registry,
    });
  });
});
