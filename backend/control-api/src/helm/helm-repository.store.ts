import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type HelmRepositoryAuthType = 'none' | 'basic';
export type HelmRepositorySyncStatus =
  | 'saved'
  | 'validated'
  | 'syncing'
  | 'synced'
  | 'failed'
  | 'ready';

export interface HelmRepositoryRecord {
  clusterId: string;
  name: string;
  url: string;
  authType: HelmRepositoryAuthType;
  username?: string;
  password?: string;
  syncStatus: HelmRepositorySyncStatus;
  lastSyncAt?: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
}

interface HelmRepositoryStorePayload {
  repositories: HelmRepositoryRecord[];
}

const STORE_FILE = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '.run',
  'helm-repositories.json',
);

@Injectable()
export class HelmRepositoryStore {
  private readonly logger = new Logger(HelmRepositoryStore.name);
  private readonly storePath = STORE_FILE;
  private writeLock: Promise<void> = Promise.resolve();

  async list(clusterId: string): Promise<HelmRepositoryRecord[]> {
    const payload = await this.readPayload();
    return payload.repositories.filter((item) => item.clusterId === clusterId);
  }

  async findByName(
    clusterId: string,
    name: string,
  ): Promise<HelmRepositoryRecord | null> {
    const records = await this.list(clusterId);
    return records.find((item) => item.name === name) ?? null;
  }

  async save(record: HelmRepositoryRecord): Promise<void> {
    await this.withLock(async () => {
      const payload = await this.readPayload();
      const index = payload.repositories.findIndex(
        (item) =>
          item.clusterId === record.clusterId && item.name === record.name,
      );
      if (index >= 0) {
        payload.repositories[index] = record;
      } else {
        payload.repositories.push(record);
      }
      await this.writePayload(payload);
    });
  }

  async delete(clusterId: string, name: string): Promise<boolean> {
    let removed = false;
    await this.withLock(async () => {
      const payload = await this.readPayload();
      const next = payload.repositories.filter((item) => {
        const matched = item.clusterId === clusterId && item.name === name;
        if (matched) {
          removed = true;
          return false;
        }
        return true;
      });
      if (!removed) {
        return;
      }
      await this.writePayload({ repositories: next });
    });
    return removed;
  }

  private async withLock(fn: () => Promise<void>): Promise<void> {
    const run = this.writeLock.then(fn);
    this.writeLock = run.catch(() => undefined);
    await run;
  }

  private async readPayload(): Promise<HelmRepositoryStorePayload> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return { repositories: [] };
      }
      const list = (parsed as { repositories?: unknown }).repositories;
      if (!Array.isArray(list)) {
        return { repositories: [] };
      }
      return {
        repositories: list.filter((item) => this.isRepositoryRecord(item)),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message && !message.includes('ENOENT')) {
        this.logger.warn(`read repository store failed: ${message}`);
      }
      return { repositories: [] };
    }
  }

  private async writePayload(
    payload: HelmRepositoryStorePayload,
  ): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private isRepositoryRecord(value: unknown): value is HelmRepositoryRecord {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const row = value as Partial<HelmRepositoryRecord>;
    return (
      typeof row.clusterId === 'string' &&
      typeof row.name === 'string' &&
      typeof row.url === 'string' &&
      typeof row.authType === 'string' &&
      typeof row.syncStatus === 'string' &&
      ['saved', 'validated', 'syncing', 'synced', 'failed', 'ready'].includes(
        row.syncStatus,
      ) &&
      typeof row.createdAt === 'string' &&
      typeof row.updatedAt === 'string'
    );
  }
}
