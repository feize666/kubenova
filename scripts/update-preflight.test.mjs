import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporaryDatabaseTarget, quotePostgresIdentifier, runMigrationRehearsal, runPostgresMigrationRehearsal } from './update-preflight.mjs';
import { pruneRetainedBackups } from './update-backup-retention.mjs';
import { mkdtemp, mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chmod } from 'node:fs/promises';

test('PostgreSQL rehearsal creates a disposable database, restores backup, runs checks, and drops it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kubenova-postgres-rehearsal-'));
  t.after(() => import('node:fs/promises').then(fs => fs.rm(directory, { recursive: true, force: true })));
  const binDir = join(directory, 'bin');
  const log = join(directory, 'commands.log');
  await mkdir(binDir);
  for (const name of ['psql', 'pg_restore']) {
    const file = join(binDir, name);
    await writeFile(file, `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> '${log}'\nexit 0\n`);
    await chmod(file, 0o755);
  }
  const backupFile = join(directory, 'backup.dump');
  await writeFile(backupFile, 'custom dump');
  const result = await runPostgresMigrationRehearsal({
    backupFile,
    connectionString: 'postgresql://admin:secret@127.0.0.1:5432/kubenova?sslmode=disable',
    targetVersion: 'v1.2',
    migrationCommand: `${process.execPath} -e "if (!process.env.DATABASE_URL.includes('kubenova_preflight_')) process.exit(2)"`,
    compatibilityCommand: `${process.execPath} -e "if (!process.env.DATABASE_URL.includes('kubenova_preflight_')) process.exit(2)"`,
    baseEnv: { ...process.env, PATH: binDir + ':' + process.env.PATH },
  });

  assert.equal(result.status, 'passed', JSON.stringify(result));
  const commands = await import('node:fs/promises').then(fs => fs.readFile(log, 'utf8'));
  assert.match(commands, /CREATE DATABASE "kubenova_preflight_[a-f0-9]{32}"/);
  assert.match(commands, /pg_restore .*--dbname kubenova_preflight_[a-f0-9]{32}/);
  assert.match(commands, /DROP DATABASE IF EXISTS "kubenova_preflight_[a-f0-9]{32}" WITH \(FORCE\)/);
});

test('PostgreSQL rehearsal blocks success when temporary database cleanup fails', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kubenova-postgres-cleanup-'));
  t.after(() => import('node:fs/promises').then(fs => fs.rm(directory, { recursive: true, force: true })));
  const backupFile = join(directory, 'backup.dump');
  await writeFile(backupFile, 'custom dump');
  const calls = [];
  const runCommand = async (binary, args, options) => {
    calls.push({ binary, args, options });
    if (binary === 'psql' && args.some((argument) => argument.startsWith('DROP DATABASE'))) throw new Error('drop failed');
    return { stdout: '', stderr: '' };
  };
  const command = `${process.execPath} -e "process.exit(0)"`;
  const result = await runPostgresMigrationRehearsal({ backupFile, connectionString: 'postgresql://admin:secret@localhost/kubenova', targetVersion: 'v1.2', migrationCommand: command, compatibilityCommand: command, runCommand });

  assert.equal(result.status, 'failed');
  assert.equal(result.checks.find((check) => check.name === '临时测试库清理')?.status, 'failed');
  assert.ok(calls.every(({ options }) => options.env.PGPASSFILE));
  assert.ok(calls.every(({ options }) => options.env.PGPASSFILE !== undefined));
  assert.ok(calls.every(({ args }) => !JSON.stringify(args).includes('secret')));
});

test('PostgreSQL rehearsal attempts cleanup even if database creation times out after the server accepted it', async () => {
  const calls = [];
  const runCommand = async (binary, args) => {
    calls.push({ binary, args });
    if (binary === 'psql' && args.some((argument) => argument.startsWith('CREATE DATABASE'))) throw new Error('connection lost after create');
    return { stdout: '', stderr: '' };
  };
  const result = await runPostgresMigrationRehearsal({ backupFile: '/tmp/unused.dump', connectionString: 'postgresql://admin@localhost/kubenova', targetVersion: 'v1.2', migrationCommand: 'true', compatibilityCommand: 'true', runCommand });

  assert.equal(result.status, 'failed');
  assert.ok(calls.some(({ binary, args }) => binary === 'psql' && args.some((argument) => argument.startsWith('DROP DATABASE IF EXISTS'))));
});

test('backup retention keeps the newest three and every backup newer than 30 days', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kubenova-backup-retention-'));
  t.after(() => import('node:fs/promises').then(fs => fs.rm(directory, { recursive: true, force: true })));
  await mkdir(directory, { recursive: true });
  const now = Date.now();
  const names = ['kubenova-update-a.sql', 'kubenova-update-b.sql', 'kubenova-update-c.dump', 'kubenova-update-d.dump', 'unrelated.dump'];
  for (const [index, name] of names.entries()) {
    const file = join(directory, name);
    await writeFile(file, name);
    const daysOld = index === 0 ? 45 : index === 1 ? 35 : index === 2 ? 31 : index === 3 ? 40 : 90;
    const timestamp = new Date(now - daysOld * 86400000);
    await utimes(file, timestamp, timestamp);
  }

  await pruneRetainedBackups(directory, { now });

  assert.deepEqual((await readdir(directory)).sort(), ['kubenova-update-b.sql', 'kubenova-update-c.dump', 'kubenova-update-d.dump', 'unrelated.dump'].sort());
});

test('temporary database target uses a generated identifier and preserves connection options', () => {
  const target = createTemporaryDatabaseTarget('postgresql://admin:secret@127.0.0.1:5432/kubenova?sslmode=require', 'ab12cd34');

  assert.equal(target.databaseName, 'kubenova_preflight_ab12cd34');
  assert.equal(new URL(target.adminUrl).pathname, '/postgres');
  assert.equal(new URL(target.databaseUrl).pathname, '/kubenova_preflight_ab12cd34');
  assert.equal(new URL(target.databaseUrl).searchParams.get('sslmode'), 'require');
  assert.equal(quotePostgresIdentifier(target.databaseName), '"kubenova_preflight_ab12cd34"');
});

test('temporary database target rejects unsupported schemes and unsafe generated suffixes', () => {
  assert.throws(() => createTemporaryDatabaseTarget('mysql://db.example/kubenova', 'ab12cd34'), /PostgreSQL/);
  assert.throws(() => createTemporaryDatabaseTarget('postgresql://127.0.0.1/kubenova', 'not-safe;drop'), /suffix/);
});

test('rehearsal restores a backup, runs migrations and compatibility checks, then drops its database', async () => {
  const calls = [];
  const result = await runMigrationRehearsal({
    createDatabase: async () => (calls.push('create'), { databaseUrl: 'postgresql://test/db_tmp' }),
    restoreBackup: async () => calls.push('restore'),
    runMigrations: async () => calls.push('migrate'),
    checkCompatibility: async () => calls.push('compatibility'),
    dropDatabase: async () => calls.push('drop'),
  });

  assert.deepEqual(calls, ['create', 'restore', 'migrate', 'compatibility', 'drop']);
  assert.equal(result.status, 'passed');
  assert.ok(result.checks.every((check) => check.status === 'passed'));
});

test('rehearsal always attempts database cleanup and fails closed when cleanup fails', async () => {
  const calls = [];
  const result = await runMigrationRehearsal({
    createDatabase: async () => ({ databaseUrl: 'postgresql://test/db_tmp' }),
    restoreBackup: async () => calls.push('restore'),
    runMigrations: async () => { throw new Error('migration failed'); },
    checkCompatibility: async () => calls.push('compatibility'),
    dropDatabase: async () => { calls.push('drop'); throw new Error('drop failed'); },
  });

  assert.deepEqual(calls, ['restore', 'drop']);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks.find((check) => check.name === '临时测试库清理')?.status, 'failed');
  assert.equal(result.checks.find((check) => check.name === '目标版本迁移')?.status, 'failed');
});
