import { BadRequestException } from '@nestjs/common';
import { Client } from 'pg';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type TemporaryDatabaseHandle = { name: string; connectionString: string };

type PgClientLike = {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
};

type CommandRunner = (command: string, args: string[], options?: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>;

export function createKubernetesTemporaryDatabaseTarget(connectionString: string, suffix: string): TemporaryDatabaseHandle & { adminUrl: string } {
  if (!/^[a-f0-9]{8,32}$/i.test(suffix)) throw new BadRequestException('Kubernetes temporary database suffix is invalid');
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new BadRequestException('A PostgreSQL migration-test connection URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1))
    throw new BadRequestException('A PostgreSQL migration-test connection URL is required');
  const name = `kubenova_preflight_${suffix.toLowerCase()}`;
  const admin = new URL(parsed);
  admin.pathname = '/postgres';
  const target = new URL(parsed);
  target.pathname = `/${name}`;
  return { name, adminUrl: admin.href, connectionString: target.href };
}

export class KubernetesMigrationDatabaseService {
  constructor(
    private readonly clientFactory: (connectionString: string) => PgClientLike = (connectionString) => new Client({ connectionString }),
    private readonly run: CommandRunner = async (command, args, options) => {
      const result = await exec(command, args, { ...options, encoding: 'utf8' });
      return { stdout: result.stdout, stderr: result.stderr };
    },
    private readonly tempRoot = tmpdir(),
  ) {}

  async createTemporaryDatabase(connectionString: string): Promise<TemporaryDatabaseHandle> {
    const target = createKubernetesTemporaryDatabaseTarget(connectionString, randomBytes(8).toString('hex'));
    let createMayHaveReachedServer = false;
    try {
      await this.withClient(target.adminUrl, async (client) => {
        createMayHaveReachedServer = true;
        await client.query(`CREATE DATABASE ${quoteGeneratedIdentifier(target.name)}`);
      });
      return { name: target.name, connectionString: target.connectionString };
    } catch (error) {
      if (createMayHaveReachedServer && error && typeof error === 'object') {
        Object.assign(error, { databaseHandle: { name: target.name, connectionString: target.connectionString } });
      }
      throw error;
    }
  }

  async restoreBackup(database: TemporaryDatabaseHandle, backupFile: string): Promise<void> {
    if (!database?.name || !database.connectionString || !backupFile) throw new BadRequestException('Kubernetes migration restore inputs are incomplete');
    const target = createKubernetesTemporaryDatabaseTarget(database.connectionString, database.name.replace(/^kubenova_preflight_/, ''));
    if (database.name !== target.name) throw new BadRequestException('Kubernetes temporary database handle does not match its generated identifier');
    const url = new URL(database.connectionString);
    const host = normalizeHost(url.hostname);
    const port = url.port || '5432';
    const username = decodeURIComponent(url.username || 'postgres');
    const password = decodeURIComponent(url.password || '');
    const workDir = await mkdtemp(join(this.tempRoot, 'kubenova-k8s-pg-restore-'));
    const passwordFile = join(workDir, '.pgpass');
    try {
      await writeFile(passwordFile, pgpassLine(host, port, database.name, username, password), { flag: 'wx', mode: 0o600 });
      await chmod(passwordFile, 0o600);
      await this.run('pg_restore', [
        '--exit-on-error', '--no-owner', '--no-acl',
        '--host', host, '--port', port, '--username', username,
        '--dbname', database.name, backupFile,
      ], {
        timeout: 20 * 60_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PGPASSFILE: passwordFile, ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode')! } : {}) },
      });
    } finally {
      try { await rm(workDir, { recursive: true, force: true }); }
      catch { throw new BadRequestException('Kubernetes temporary PostgreSQL restore credentials could not be removed'); }
    }
  }

  async dropTemporaryDatabase(database: TemporaryDatabaseHandle): Promise<void> {
    if (!database?.name || !/^kubenova_preflight_[a-f0-9]{8,32}$/.test(database.name))
      throw new BadRequestException('Kubernetes temporary database identifier is invalid');
    const target = createKubernetesTemporaryDatabaseTarget(database.connectionString ?? '', database.name.slice('kubenova_preflight_'.length));
    if (target.name !== database.name) throw new BadRequestException('Kubernetes temporary database handle is invalid');
    await this.withClient(target.adminUrl, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${quoteGeneratedIdentifier(database.name)} WITH (FORCE)`);
    });
  }

  private async withClient<T>(connectionString: string, operation: (client: PgClientLike) => Promise<T>): Promise<T> {
    const client = this.clientFactory(connectionString);
    let connected = false;
    try {
      await client.connect();
      connected = true;
      return await operation(client);
    } finally {
      if (connected) await client.end();
    }
  }
}

function quoteGeneratedIdentifier(value: string): string {
  if (!/^kubenova_preflight_[a-f0-9]{8,32}$/.test(value)) throw new BadRequestException('Kubernetes temporary database identifier is invalid');
  return `"${value}"`;
}

function normalizeHost(value: string): string {
  return value.replace(/^\[|\]$/g, '');
}

function pgpassLine(host: string, port: string, database: string, username: string, password: string): string {
  const escape = (value: string) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replace(/[\r\n]/g, '');
  return `${escape(host)}:${escape(port)}:${escape(database)}:${escape(username)}:${escape(password)}\n`;
}
