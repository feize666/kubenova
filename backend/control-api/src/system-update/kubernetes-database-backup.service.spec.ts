import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KubernetesDatabaseBackupService } from './kubernetes-database-backup.service';

describe('Kubernetes database backup service', () => {
  it('creates a non-empty custom-format backup under the persistent local target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-k8s-backup-'));
    const targetDir = join(root, 'backups');
    const calls: string[] = [];
    const service = new KubernetesDatabaseBackupService(async (command, args, options) => {
      calls.push(command);
      if (command === 'pg_dump') await writeFile(args[args.indexOf('--file') + 1], 'dump-bytes');
      expect(options?.env?.PGPASSFILE).toBeTruthy();
      return { stdout: '', stderr: '' };
    }, root);
    try {
      const backup = await service.createBackup({
        databaseUrl: 'postgresql://user:secret@postgres:5432/kubenova',
        target: { id: 'primary', name: 'Primary', type: 'local', location: targetDir },
        taskId: 'task-123',
      });

      expect(backup.location).toMatch(new RegExp(`^${targetDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/kubenova-update-task-123-[a-f0-9-]+\\.dump$`));
      expect(backup.bytes).toBe(10);
      expect(calls).toEqual(['pg_dump']);
      const files = await readdir(targetDir);
      expect(files).toEqual([backup.location.split('/').at(-1)]);
      await expect(readFile(backup.location, 'utf8')).resolves.toBe('dump-bytes');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uploads S3 backup only after pg_dump succeeds and removes the pod-local copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-k8s-s3-backup-'));
    const calls: string[] = [];
    const service = new KubernetesDatabaseBackupService(async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (command === 'pg_dump') await writeFile(args[args.indexOf('--file') + 1], 'dump-bytes');
      return { stdout: '', stderr: '' };
    }, root);
    try {
      const backup = await service.createBackup({
        databaseUrl: 'postgresql://user:secret@postgres:5432/kubenova',
        target: {
          id: 'remote', name: 'Remote', type: 's3', location: 's3://backup-bucket/kubenova',
          secret: { AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'cn-north-1' },
        },
        taskId: 'task-456',
      });

      expect(backup.location).toMatch(/^s3:\/\/backup-bucket\/kubenova\/kubenova-update-task-456-[a-f0-9-]+\.dump$/);
      expect(calls[0]).toMatch(/^pg_dump /);
      expect(calls[1]).toMatch(/^aws s3 cp .* s3:\/\/backup-bucket\/kubenova\//);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for paths outside the persistent mount and cleans partial dumps on backup failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-k8s-backup-failure-'));
    const service = new KubernetesDatabaseBackupService(async (_command, args) => {
      const output = args[args.indexOf('--file') + 1];
      await writeFile(output, 'partial');
      throw new Error('pg_dump failed');
    }, root);
    try {
      await expect(service.createBackup({
        databaseUrl: 'postgresql://user@postgres:5432/kubenova',
        target: { id: 'outside', name: 'Outside', type: 'local', location: '/tmp/not-a-persistent-volume' }, taskId: 'task-789',
      })).rejects.toThrow(/persistent update-backup volume/);
      await expect(service.createBackup({
        databaseUrl: 'postgresql://user@postgres:5432/kubenova',
        target: { id: 'inside', name: 'Inside', type: 'local', location: root }, taskId: 'task-789',
      })).rejects.toThrow(/PostgreSQL backup failed/);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid or unsafe S3 endpoints before creating a database dump', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-k8s-s3-invalid-'));
    const run = jest.fn(async () => ({ stdout: '', stderr: '' }));
    const service = new KubernetesDatabaseBackupService(run, root);
    try {
      await expect(service.createBackup({
        databaseUrl: 'postgresql://user@postgres:5432/kubenova',
        target: { id: 's3', name: 'S3', type: 's3', location: 's3://backup-bucket/kubenova', secret: {
          AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_ENDPOINT_URL: 'http://user:password@example.invalid',
        } },
        taskId: 'task-unsafe',
      })).rejects.toThrow(/endpoint/);
      expect(run).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the temporary PostgreSQL credential file cannot be removed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-k8s-backup-cleanup-'));
    const service = new KubernetesDatabaseBackupService(async (_command, args) => {
      await writeFile(args[args.indexOf('--file') + 1], 'dump-bytes');
      return { stdout: '', stderr: '' };
    }, root, async (path, options) => {
      if (String(path).endsWith('.pgpass')) throw new Error('permission denied');
      await rm(path, options);
    });
    try {
      await expect(service.createBackup({
        databaseUrl: 'postgresql://user:secret@postgres:5432/kubenova',
        target: { id: 'local', name: 'local', type: 'local', location: root }, taskId: 'task-cleanup',
      })).rejects.toThrow(/temporary backup data cleanup failed/);
      expect((await readdir(root)).some((name) => name.endsWith('.dump'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('provides a verified local backup to a restore rehearsal only from the persistent backup volume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-k8s-read-backup-'));
    const backupDir = join(root, 'backups');
    await mkdir(backupDir);
    const backupFile = join(backupDir, 'kubenova-update-task-test.dump');
    await writeFile(backupFile, 'valid-dump');
    const service = new KubernetesDatabaseBackupService(async () => ({ stdout: '', stderr: '' }), root);
    try {
      await expect(service.withBackupFile({ location: backupFile, target: { id: 'local', name: 'local', type: 'local', location: backupDir } }, async (path) => readFile(path, 'utf8')))
        .resolves.toBe('valid-dump');
      await expect(service.withBackupFile({ location: '/tmp/other.dump', target: { id: 'local', name: 'local', type: 'local', location: backupDir } }, async () => 'read'))
        .rejects.toThrow(/configured local backup target/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('downloads S3 backups to a private temporary file and fails closed when that file cannot be removed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-k8s-read-s3-'));
    const run = async (_command: string, args: string[]) => {
      if (args[0] === 's3' && args[1] === 'cp') await writeFile(args[3], 's3-dump');
      return { stdout: '', stderr: '' };
    };
    const service = new KubernetesDatabaseBackupService(run, root);
    const target = { id: 's3', name: 's3', type: 's3' as const, location: 's3://backup-bucket/kubenova', secret: { AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret' } };
    try {
      await expect(service.withBackupFile({ location: 's3://backup-bucket/kubenova/kubenova-update-task-test.dump', target }, async (path) => readFile(path, 'utf8')))
        .resolves.toBe('s3-dump');
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when S3 download fails and its temporary directory also cannot be removed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-k8s-read-s3-failure-'));
    const run = async () => { throw new Error('S3 unavailable'); };
    const service = new KubernetesDatabaseBackupService(run, root, async (path, options) => {
      if (String(path).includes('kubenova-k8s-restore-')) throw new Error('temporary directory cleanup denied');
      await rm(path, options);
    });
    const target = { id: 's3', name: 's3', type: 's3' as const, location: 's3://backup-bucket/kubenova', secret: { AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret' } };
    try {
      await expect(service.withBackupFile({ location: 's3://backup-bucket/kubenova/kubenova-update-task-test.dump', target }, async () => 'unexpected'))
        .rejects.toThrow(/temporary rehearsal backup cleanup failed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains three newest local backups and every backup younger than 30 days', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kubenova-k8s-retention-'));
    const targetDir = join(root, 'backups');
    await mkdir(targetDir);
    const now = Date.now();
    for (const [name, days] of [['oldest.dump', 45], ['old.dump', 35], ['recent.dump', 20], ['newest.dump', 31]] as const) {
      const file = join(targetDir, `kubenova-update-${name}`);
      await writeFile(file, 'existing');
      const time = new Date(now - days * 86_400_000);
      await utimes(file, time, time);
    }
    const run = async (_command: string, args: string[]) => {
      await writeFile(args[args.indexOf('--file') + 1], 'new-backup');
      return { stdout: '', stderr: '' };
    };
    const service = new KubernetesDatabaseBackupService(run, root);
    try {
      await service.createBackup({ databaseUrl: 'postgresql://user@postgres:5432/kubenova', target: { id: 'local', name: 'local', type: 'local', location: targetDir }, taskId: 'task-retention' });
      const retained = (await readdir(targetDir)).sort();
      expect(retained).toHaveLength(3);
      expect(retained).toContain('kubenova-update-newest.dump');
      expect(retained).toContain('kubenova-update-recent.dump');
      expect(retained.some((name) => name.startsWith('kubenova-update-task-retention-'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
