import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const DEFAULT_BACKUP_ROOT = '/var/lib/kubenova/update-backups';
const s3Keys = new Set(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ENDPOINT_URL']);

export type KubernetesBackupTarget = {
  id: string;
  name: string;
  type: 'local' | 's3';
  location: string;
  secret?: Record<string, string>;
};

export type KubernetesBackupResult = { location: string; bytes: number; createdAt: string };

@Injectable()
export class KubernetesDatabaseBackupService {
  constructor(
    @Optional()
    private readonly run: (command: string, args: string[], options?: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }> = async (command, args, options) => {
      const result = await exec(command, args, { ...options, encoding: 'utf8' });
      return { stdout: result.stdout, stderr: result.stderr };
    },
    @Optional()
    private readonly backupRoot = process.env.KUBENOVA_K8S_UPDATE_BACKUP_ROOT?.trim() || DEFAULT_BACKUP_ROOT,
    @Optional()
    private readonly remove: typeof rm = (path, options) => rm(path, options),
  ) {}

  async createBackup({ databaseUrl, target, taskId }: { databaseUrl: string; target: KubernetesBackupTarget; taskId: string }): Promise<KubernetesBackupResult> {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(taskId)) throw new BadRequestException('Kubernetes backup task id is invalid');
    if (!target || !target.id || !target.location) throw new BadRequestException('Kubernetes backup target is incomplete');
    const filename = `kubenova-update-${taskId}-${randomUUID()}.dump`;
    const workDir = await mkdtemp(join(tmpdir(), 'kubenova-k8s-backup-'));
    let localFile: string | null = null;
    let partialFile: string | null = null;
    let passwordFile: string | null = null;
    let operationError: unknown;
    try {
      const targetIsS3 = target.type === 's3';
      let awsEnv: NodeJS.ProcessEnv | undefined;
      let remoteUri: string | null = null;
      let outputDir: string;
      if (targetIsS3) {
        const s3 = validateS3Target(target);
        awsEnv = s3.env;
        remoteUri = `${s3.prefix}/${filename}`;
        outputDir = workDir;
      } else if (target.type === 'local') {
        outputDir = resolve(target.location);
        const root = resolve(this.backupRoot);
        const pathFromRoot = relative(root, outputDir);
        if (!isAbsolute(target.location) || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot))
          throw new BadRequestException(`Kubernetes local backup path must be inside the persistent update-backup volume (${root})`);
      } else {
        throw new BadRequestException('Kubernetes backup target type is unsupported');
      }

      await mkdir(outputDir, { recursive: true, mode: 0o700 });
      localFile = join(outputDir, filename);
      partialFile = `${localFile}.partial`;
      const pg = postgresDumpConfig(databaseUrl, partialFile);
      const passwordLine = pg.passwordLine;
      const env: NodeJS.ProcessEnv = { ...process.env, ...(awsEnv ?? {}), ...(pg.sslmode ? { PGSSLMODE: pg.sslmode } : {}) };
      if (passwordLine) {
        passwordFile = join(workDir, '.pgpass');
        await writeFile(passwordFile, passwordLine, { flag: 'wx', mode: 0o600 });
        env.PGPASSFILE = passwordFile;
      }
      try {
        await this.run('pg_dump', pg.args, { timeout: 20 * 60_000, maxBuffer: 1024 * 1024, env });
      } catch {
        throw new BadRequestException('Kubernetes PostgreSQL backup failed; no Deployment was changed');
      }
      const backupStat = await stat(partialFile);
      if (!backupStat.isFile() || backupStat.size <= 0) throw new BadRequestException('Kubernetes PostgreSQL backup is empty; no Deployment was changed');
      await chmod(partialFile, 0o600);
      await rename(partialFile, localFile);
      partialFile = null;
      if (remoteUri) {
        try {
          await this.run('aws', ['s3', 'cp', localFile, remoteUri, '--only-show-errors'], { timeout: 20 * 60_000, maxBuffer: 1024 * 1024, env });
        } catch {
          throw new BadRequestException('Kubernetes backup upload failed; no Deployment was changed');
        }
        await pruneS3Backups(this.run, target, awsEnv!, remoteUri);
        await rm(localFile, { force: true });
        return { location: remoteUri, bytes: backupStat.size, createdAt: new Date().toISOString() };
      }
      await pruneLocalBackups(outputDir, localFile);
      return { location: localFile, bytes: backupStat.size, createdAt: new Date().toISOString() };
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      const cleanupErrors: unknown[] = [];
      if (partialFile) await this.remove(partialFile, { force: true }).catch((error) => cleanupErrors.push(error));
      if (target.type === 's3' && localFile) await this.remove(localFile, { force: true }).catch((error) => cleanupErrors.push(error));
      if (passwordFile) await this.remove(passwordFile, { force: true }).catch((error) => cleanupErrors.push(error));
      await this.remove(workDir, { recursive: true, force: true }).catch((error) => cleanupErrors.push(error));
      if (!operationError && cleanupErrors.length) {
        throw new BadRequestException('Kubernetes temporary backup data cleanup failed; no Deployment was changed');
      }
    }
  }

  async withBackupFile<T>(
    { location, target }: { location: string; target: KubernetesBackupTarget },
    consume: (path: string) => Promise<T>,
  ): Promise<T> {
    if (!location || !target?.location) throw new BadRequestException('Kubernetes rehearsal backup reference is incomplete');
    let localFile = location;
    let workDir: string | null = null;
    if (target.type === 'local') {
      const root = resolve(this.backupRoot);
      const targetDir = resolve(target.location);
      const targetRelativeToRoot = relative(root, targetDir);
      if (targetRelativeToRoot === '..' || targetRelativeToRoot.startsWith(`..${sep}`) || isAbsolute(targetRelativeToRoot))
        throw new BadRequestException('Kubernetes local backup path must be inside the persistent update-backup volume');
      localFile = resolve(location);
      const backupRelativeToTarget = relative(targetDir, localFile);
      if (backupRelativeToTarget === '..' || backupRelativeToTarget.startsWith(`..${sep}`) || isAbsolute(backupRelativeToTarget)
        || !/^kubenova-update-[A-Za-z0-9_-]+\.dump$/.test(localFile.slice(localFile.lastIndexOf(sep) + 1)))
        throw new BadRequestException('Kubernetes rehearsal backup is outside the configured local backup target');
    } else if (target.type === 's3') {
      const s3 = validateS3Target(target);
      const expectedPrefix = `${s3.prefix}/`;
      const key = location.slice(expectedPrefix.length);
      if (!location.startsWith(expectedPrefix) || !/^kubenova-update-[A-Za-z0-9_-]+\.dump$/.test(key))
        throw new BadRequestException('Kubernetes rehearsal backup is outside the configured S3 prefix');
      workDir = await mkdtemp(join(tmpdir(), 'kubenova-k8s-restore-'));
      localFile = join(workDir, key);
      try {
        await this.run('aws', ['s3', 'cp', location, localFile, '--only-show-errors'], {
          timeout: 20 * 60_000, maxBuffer: 1024 * 1024, env: s3.env,
        });
        await chmod(localFile, 0o600);
      } catch (error) {
        try { await this.remove(workDir, { recursive: true, force: true }); }
        catch { throw new BadRequestException('Kubernetes temporary rehearsal backup cleanup failed; preflight stopped', { cause: error }); }
        throw new BadRequestException('Kubernetes backup download for migration rehearsal failed', { cause: error });
      }
    } else throw new BadRequestException('Kubernetes rehearsal backup target type is unsupported');

    try {
      const info = await stat(localFile);
      if (!info.isFile() || info.size <= 0) throw new BadRequestException('Kubernetes rehearsal backup is empty or unavailable');
      return await consume(localFile);
    } finally {
      if (workDir) {
        try { await this.remove(workDir, { recursive: true, force: true }); }
        catch { throw new BadRequestException('Kubernetes temporary rehearsal backup cleanup failed; preflight stopped'); }
      }
    }
  }
}

async function pruneLocalBackups(directory: string, currentFile: string, now = Date.now()): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const backups = [] as Array<{ path: string; modifiedAt: number }>;
  for (const entry of entries) {
    if (!entry.isFile() || !/^kubenova-update-[A-Za-z0-9_-]+\.dump$/.test(entry.name)) continue;
    const path = join(directory, entry.name);
    const info = await stat(path);
    if (!Number.isFinite(info.mtimeMs)) throw new BadRequestException('Kubernetes backup directory contains an invalid modification time; cleanup stopped');
    backups.push({ path, modifiedAt: info.mtimeMs });
  }
  backups.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const protectedPaths = new Set(backups.slice(0, 3).map((entry) => entry.path));
  for (const entry of backups) if (now - entry.modifiedAt < 30 * 24 * 60 * 60_000) protectedPaths.add(entry.path);
  for (const entry of backups) if (!protectedPaths.has(entry.path) && entry.path !== currentFile) await rm(entry.path);
}

async function pruneS3Backups(
  run: (command: string, args: string[], options?: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>,
  target: KubernetesBackupTarget,
  env: NodeJS.ProcessEnv,
  currentUri: string,
  now = Date.now(),
): Promise<void> {
  const url = new URL(target.location);
  const prefix = url.pathname.replace(/^\/+|\/+$/g, '');
  let listing: { Contents?: Array<{ Key?: string; LastModified?: string }> };
  try {
    const result = await run('aws', ['s3api', 'list-objects-v2', '--bucket', url.hostname, '--prefix', `${prefix}/`, '--output', 'json'], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env });
    listing = JSON.parse(result.stdout || '{}');
  } catch {
    throw new BadRequestException('Kubernetes S3 backup listing failed; update stopped before changing Deployments');
  }
  const backups = (Array.isArray(listing.Contents) ? listing.Contents : [])
    .filter((item) => typeof item.Key === 'string' && item.Key.startsWith(`${prefix}/`) && /^kubenova-update-[A-Za-z0-9_-]+\.dump$/.test(item.Key.slice(item.Key.lastIndexOf('/') + 1)))
    .map((item) => ({ key: item.Key!, modifiedAt: Date.parse(item.LastModified ?? '') }));
  if (backups.some((entry) => !Number.isFinite(entry.modifiedAt)))
    throw new BadRequestException('Kubernetes S3 backup listing contains invalid timestamps; cleanup stopped');
  backups.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const protectedKeys = new Set(backups.slice(0, 3).map((entry) => entry.key));
  for (const entry of backups) if (now - entry.modifiedAt < 30 * 24 * 60 * 60_000) protectedKeys.add(entry.key);
  for (const entry of backups) {
    const uri = `s3://${url.hostname}/${entry.key}`;
    if (protectedKeys.has(entry.key) || uri === currentUri) continue;
    try { await run('aws', ['s3api', 'delete-object', '--bucket', url.hostname, '--key', entry.key], { timeout: 60_000, maxBuffer: 1024 * 1024, env }); }
    catch { throw new BadRequestException('Kubernetes S3 backup retention cleanup failed; update stopped before changing Deployments'); }
  }
}

function postgresDumpConfig(databaseUrl: string, outputFile: string): { args: string[]; passwordLine: string | null; sslmode: string | null } {
  let parsed: URL;
  try { parsed = new URL(databaseUrl); } catch { throw new BadRequestException('PostgreSQL DATABASE_URL 格式无效'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/')
    throw new BadRequestException('Kubernetes 备份仅支持带主机和数据库名的 PostgreSQL DATABASE_URL');
  const host = parsed.hostname;
  const port = parsed.port || '5432';
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const username = decodeURIComponent(parsed.username || 'postgres');
  if (!database || /[\r\n]/.test(database + username + host + port)) throw new BadRequestException('PostgreSQL DATABASE_URL 包含无效字符');
  const escapePgpass = (value: string) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replace(/[\r\n]/g, '');
  const passwordLine = parsed.password
    ? `${escapePgpass(host)}:${escapePgpass(port)}:${escapePgpass(database)}:${escapePgpass(username)}:${escapePgpass(decodeURIComponent(parsed.password))}\n`
    : null;
  return {
    args: ['--format=custom', '--no-owner', '--file', outputFile, '--host', host, '--port', port, '--username', username, database],
    passwordLine,
    sslmode: parsed.searchParams.get('sslmode'),
  };
}

function validateS3Target(target: KubernetesBackupTarget): { prefix: string; env: NodeJS.ProcessEnv } {
  let url: URL;
  try { url = new URL(target.location); } catch { throw new BadRequestException('Kubernetes S3 backup target is invalid'); }
  if (url.protocol !== 's3:' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(url.hostname) || url.username || url.password || url.search || url.hash)
    throw new BadRequestException('Kubernetes S3 backup target must use s3://bucket/prefix');
  const prefix = `s3://${url.hostname}/${url.pathname.replace(/^\/+|\/+$/g, '')}`;
  if (url.pathname === '/' || url.pathname.split('/').some((part) => part === '.' || part === '..'))
    throw new BadRequestException('Kubernetes S3 backup target requires a dedicated prefix');
  const secret = target.secret ?? {};
  if (Object.entries(secret).some(([key, value]) => !s3Keys.has(key) || typeof value !== 'string'))
    throw new BadRequestException('Kubernetes S3 backup credentials contain unsupported values');
  if (!secret.AWS_ACCESS_KEY_ID?.trim() || !secret.AWS_SECRET_ACCESS_KEY?.trim())
    throw new BadRequestException('Kubernetes S3 backup credentials are incomplete');
  if (secret.AWS_ENDPOINT_URL) {
    let endpoint: URL;
    try { endpoint = new URL(secret.AWS_ENDPOINT_URL); } catch { throw new BadRequestException('Kubernetes S3 endpoint must be an HTTP(S) URL'); }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new BadRequestException('Kubernetes S3 endpoint must be an HTTP(S) URL');
  }
  return { prefix, env: Object.fromEntries(Object.entries(secret).filter(([, value]) => value.trim())) };
}
