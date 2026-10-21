import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KubernetesMigrationDatabaseService, createKubernetesTemporaryDatabaseTarget } from './kubernetes-migration-database.service';

describe('Kubernetes migration rehearsal PostgreSQL adapter', () => {
  it('generates an isolated identifier and a separate database URL without changing connection options', () => {
    const target = createKubernetesTemporaryDatabaseTarget('postgresql://user:secret@postgres:5432/platform?sslmode=require', 'a1b2c3d4e5f6');

    expect(target.name).toBe('kubenova_preflight_a1b2c3d4e5f6');
    expect(target.adminUrl).toBe('postgresql://user:secret@postgres:5432/postgres?sslmode=require');
    expect(target.connectionString).toBe('postgresql://user:secret@postgres:5432/kubenova_preflight_a1b2c3d4e5f6?sslmode=require');
  });

  it('restores a custom dump through pgpass without putting the database password in command arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-migration-db-'));
    const clientFactory = jest.fn();
    const run = jest.fn(async (_command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      expect(args.join(' ')).not.toContain('secret');
      const passwordFile = options?.env?.PGPASSFILE;
      expect(passwordFile).toBeTruthy();
      await expect(readFile(passwordFile!, 'utf8')).resolves.toContain(':secret');
      return { stdout: '', stderr: '' };
    });
    const service = new KubernetesMigrationDatabaseService(clientFactory as never, run, root);
    const target = createKubernetesTemporaryDatabaseTarget('postgresql://user:secret@postgres:5432/platform', 'a1b2c3d4e5f6');
    try {
      await service.restoreBackup({ name: target.name, connectionString: target.connectionString }, '/backup.dump');
      expect(clientFactory).not.toHaveBeenCalled();
      expect(run.mock.calls[0][0]).toBe('pg_restore');
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('drops a generated database with FORCE and preserves ssl mode', async () => {
    const calls: Array<{ url: string; sql?: string }> = [];
    const clientFactory = (url: string) => ({
      connect: async () => undefined,
      query: async (sql: string) => { calls.push({ url, sql }); },
      end: async () => undefined,
    });
    const service = new KubernetesMigrationDatabaseService(clientFactory as never, async () => ({ stdout: '', stderr: '' }));
    const target = createKubernetesTemporaryDatabaseTarget('postgresql://user:secret@postgres:5432/platform?sslmode=require', 'a1b2c3d4e5f6');

    await service.dropTemporaryDatabase({ name: target.name, connectionString: target.connectionString });

    expect(calls).toEqual([{ url: target.adminUrl, sql: 'DROP DATABASE IF EXISTS "kubenova_preflight_a1b2c3d4e5f6" WITH (FORCE)' }]);
  });

  it('rejects invalid schemes and unsafe temporary database names before connecting', async () => {
    const clientFactory = jest.fn();
    expect(() => createKubernetesTemporaryDatabaseTarget('mysql://user@db/platform', 'a1b2c3d4e5f6')).toThrow(/PostgreSQL/);
    expect(() => createKubernetesTemporaryDatabaseTarget('postgresql://user@db/platform', 'not-safe-name;DROP')) .toThrow(/suffix/);
    expect(clientFactory).not.toHaveBeenCalled();
  });
});
