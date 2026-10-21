import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { PrismaService } from '../platform/database/prisma.service';
import { decryptUpdateSettings, encryptUpdateSettings } from './update-settings.crypto';

export type UpdateBackupTargetInput = {
  id: string;
  name: string;
  type: 'local' | 's3';
  location: string;
  secret?: Record<string, string>;
};

export type UpdateMigrationTargetInput = {
  id: string;
  name: string;
  type: 'local' | 'external';
  connection?: string;
};

export type UpdateSettingsInput = {
  backupTargets: UpdateBackupTargetInput[];
  migrationTargets: UpdateMigrationTargetInput[];
  registry: {
    defaultPrefix: string;
    components: Record<string, string>;
    imagePullSecretName: string | null;
    token?: string;
  };
};

type StoredSettings = UpdateSettingsInput;

const SINGLETON_ID = 'singleton';

@Injectable()
export class UpdateSettingsService {
  constructor(private readonly db: PrismaService) {}

  async save(input: UpdateSettingsInput, updatedBy: string) {
    const existing = await this.readStored();
    const normalized = normalizeSettings({
      ...input,
      backupTargets: (input.backupTargets ?? []).map((target) => {
        const previous = existing.backupTargets.find((item) => item.id === target.id && item.type === target.type && item.location === target.location);
        return { ...target, ...(!target.secret && previous?.secret ? { secret: previous.secret } : {}) };
      }),
      migrationTargets: (input.migrationTargets ?? []).map((target) => {
        const previous = existing.migrationTargets.find((item) => item.id === target.id && item.type === target.type);
        return { ...target, ...(!target.connection && previous?.connection ? { connection: previous.connection } : {}) };
      }),
      registry: { ...input.registry, ...(!input.registry?.token && existing.registry.token ? { token: existing.registry.token } : {}) },
    });
    const encryptedData = encryptUpdateSettings(normalized, this.key());
    await this.db.systemUpdateSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, encryptedData, updatedBy },
      update: { encryptedData, updatedBy },
    });
    return publicSettings(normalized);
  }

  async get() {
    return publicSettings(await this.readStored());
  }

  async getForExecutor() {
    return this.readStored();
  }

  private async readStored(): Promise<StoredSettings> {
    const row = await this.db.systemUpdateSettings.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return { backupTargets: [], migrationTargets: [], registry: { defaultPrefix: '', components: {}, imagePullSecretName: null } };
    try {
      return decryptUpdateSettings<StoredSettings>(row.encryptedData, this.key());
    } catch {
      throw new BadRequestException('更新设置无法解密，请检查独立更新凭据密钥');
    }
  }

  async fingerprint(): Promise<string> {
    const row = await this.db.systemUpdateSettings.findUnique({ where: { id: SINGLETON_ID } });
    return createHash('sha256').update(row?.encryptedData ?? 'system-update-settings-unconfigured').digest('hex');
  }

  private key(): string {
    const key = process.env.KUBENOVA_UPDATE_ENCRYPTION_KEY?.trim() ?? '';
    if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new BadRequestException('KUBENOVA_UPDATE_ENCRYPTION_KEY 必须是 64 位十六进制密钥');
    return key;
  }
}

function normalizeSettings(input: UpdateSettingsInput): StoredSettings {
  if (!input || !Array.isArray(input.backupTargets) || !Array.isArray(input.migrationTargets) || !input.registry)
    throw new BadRequestException('更新设置格式无效');
  const backupTargets = input.backupTargets.map((target) => ({
    id: String(target.id).trim(), name: String(target.name).trim(), type: target.type,
    location: String(target.location).trim(), ...(target.secret ? { secret: normalizeSecret(target.secret, target.type) } : {}),
  }));
  if (backupTargets.some((target) => !target.id || !target.name || !target.location || !['local', 's3'].includes(target.type)))
    throw new BadRequestException('备份目标必须提供有效的本地目录或 S3 地址');
  for (const target of backupTargets) {
    if (target.type === 'local' && !isAbsolute(target.location)) throw new BadRequestException('本地备份目标必须使用绝对路径');
    if (target.type === 's3') {
      let location: URL;
      try { location = new URL(target.location); } catch { throw new BadRequestException('S3 备份目标必须使用 s3://bucket/path 地址'); }
      if (location.protocol !== 's3:' || !location.hostname || location.username || location.password || location.search || location.hash)
        throw new BadRequestException('S3 备份目标必须使用 s3://bucket/path 地址');
      if (target.location.split('/').some((segment) => segment === '.' || segment === '..')) throw new BadRequestException('S3 备份前缀不能包含 . 或 .. 路径段');
      if (target.secret && (!target.secret.AWS_ACCESS_KEY_ID?.trim() || !target.secret.AWS_SECRET_ACCESS_KEY?.trim()))
        throw new BadRequestException('S3 备份目标需要 AWS_ACCESS_KEY_ID 和 AWS_SECRET_ACCESS_KEY');
      if (target.secret?.AWS_ENDPOINT_URL) {
        let endpoint: URL;
        try { endpoint = new URL(target.secret.AWS_ENDPOINT_URL); } catch { throw new BadRequestException('S3 Endpoint 必须是有效的 HTTP(S) 地址'); }
        if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
          throw new BadRequestException('S3 Endpoint 必须是有效的 HTTP(S) 地址');
      }
    }
  }
  const migrationTargets = input.migrationTargets.map((target) => ({
    id: String(target.id).trim(), name: String(target.name).trim(), type: target.type,
    ...(target.connection ? { connection: target.connection } : {}),
  }));
  if (migrationTargets.some((target) => !target.id || !target.name || !['local', 'external'].includes(target.type)))
    throw new BadRequestException('迁移测试目标格式无效');
  for (const target of migrationTargets) {
    if (target.connection) {
      let connection: URL;
      try { connection = new URL(target.connection ?? ''); } catch { throw new BadRequestException('外部迁移测试目标必须提供 PostgreSQL 连接串'); }
      if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !connection.hostname || !connection.pathname.slice(1))
        throw new BadRequestException('外部迁移测试目标必须提供 PostgreSQL 连接串');
      if (target.type === 'local' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(connection.hostname.toLowerCase()))
        throw new BadRequestException('本机迁移测试目标只允许 PostgreSQL 回环地址；远程数据库请选择外部测试目标');
    }
  }
  return {
    backupTargets,
    migrationTargets,
    registry: {
      defaultPrefix: String(input.registry.defaultPrefix ?? '').trim(),
      components: Object.fromEntries(Object.entries(input.registry.components ?? {}).map(([key, value]) => [key, String(value).trim()])),
      imagePullSecretName: input.registry.imagePullSecretName ? String(input.registry.imagePullSecretName).trim() : null,
      ...(input.registry.token ? { token: input.registry.token } : {}),
    },
  };
}

function normalizeSecret(value: unknown, type: UpdateBackupTargetInput['type']): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('备份凭据格式无效');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key, item]) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof item !== 'string'))
    throw new BadRequestException('备份凭据格式无效');
  const supported = new Set(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ENDPOINT_URL']);
  if (type === 's3' && entries.some(([key]) => !supported.has(key))) throw new BadRequestException('S3 备份凭据包含不支持的字段');
  return Object.fromEntries(entries.map(([key, item]) => [key, (item as string).trim()]));
}

function publicSettings(value: StoredSettings) {
  return {
    backupTargets: value.backupTargets.map(({ secret: _secret, ...target }) => ({ ...target, configured: Boolean(_secret) || target.type === 'local' })),
    migrationTargets: value.migrationTargets.map(({ connection: _connection, ...target }) => ({ ...target, configured: Boolean(_connection) })),
    registry: { ...value.registry, token: undefined, configured: Boolean(value.registry.defaultPrefix || value.registry.imagePullSecretName) },
  };
}
