import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function createTemporaryDatabaseTarget(connectionString, suffix) {
  if (!/^[a-f0-9]{8,32}$/i.test(String(suffix))) throw new Error('temporary database suffix is invalid');
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('PostgreSQL connection URL is invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('A PostgreSQL connection URL is required');
  const databaseName = `kubenova_preflight_${String(suffix).toLowerCase()}`;
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const databaseUrl = new URL(url);
  databaseUrl.pathname = `/${databaseName}`;
  return { databaseName, adminUrl: adminUrl.href, databaseUrl: databaseUrl.href };
}

export function quotePostgresIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export async function runMigrationRehearsal({
  createDatabase,
  restoreBackup,
  runMigrations,
  checkCompatibility,
  dropDatabase,
}) {
  const checks = [];
  let database;
  let restored = false;
  let migrationPassed = false;
  let compatibilityPassed = false;
  let cleanupPassed = false;

  try {
    database = await createDatabase();
    if (!database?.databaseUrl) throw new Error('temporary database was not created');
    checks.push({ name: '临时测试库', status: 'passed', message: '已创建隔离的临时测试库' });
  } catch {
    checks.push({ name: '临时测试库', status: 'failed', message: '无法创建隔离的临时测试库' });
  }

  if (database) {
    try {
      await restoreBackup(database);
      restored = true;
      checks.push({ name: '备份恢复', status: 'passed', message: '生产备份已恢复到临时测试库' });
    } catch {
      checks.push({ name: '备份恢复', status: 'failed', message: '无法将备份恢复到临时测试库' });
    }
  } else {
    checks.push({ name: '备份恢复', status: 'skipped', message: '临时测试库未创建' });
  }

  if (restored) {
    try {
      await runMigrations(database);
      migrationPassed = true;
      checks.push({ name: '目标版本迁移', status: 'passed', message: '目标版本数据库迁移已完成' });
    } catch {
      checks.push({ name: '目标版本迁移', status: 'failed', message: '目标版本数据库迁移失败' });
    }
    if (migrationPassed) {
      try {
        await checkCompatibility(database);
        compatibilityPassed = true;
        checks.push({ name: '旧版本兼容', status: 'passed', message: '旧版本兼容性检查已通过' });
      } catch {
        checks.push({ name: '旧版本兼容', status: 'failed', message: '旧版本兼容性检查失败' });
      }
    } else {
      checks.push({ name: '旧版本兼容', status: 'skipped', message: '目标版本迁移未通过' });
    }
  } else {
    checks.push({ name: '目标版本迁移', status: 'skipped', message: '备份未成功恢复' });
    checks.push({ name: '旧版本兼容', status: 'skipped', message: '备份未成功恢复' });
  }

  if (database) {
    try {
      await dropDatabase(database);
      cleanupPassed = true;
      checks.push({ name: '临时测试库清理', status: 'passed', message: '临时测试库已删除' });
    } catch {
      checks.push({ name: '临时测试库清理', status: 'failed', message: '临时测试库未能删除，已阻止更新' });
    }
  } else {
    cleanupPassed = true;
    checks.push({ name: '临时测试库清理', status: 'passed', message: '未创建临时测试库，无需清理' });
  }

  return {
    status: database && restored && migrationPassed && compatibilityPassed && cleanupPassed ? 'passed' : 'failed',
    checks,
  };
}

export async function runPostgresMigrationRehearsal({ backupFile, connectionString, targetVersion, migrationCommand, compatibilityCommand, runCommand = exec, runPostgresCommand = runCommand, runMigrations, checkCompatibility, mapDatabaseUrl, baseEnv = process.env }) {
  const checks = [];
  const command = (value) => typeof value === 'string' ? value.trim() : '';
  let target;
  let passwordFile;
  let databaseCreated = false;
  let databaseMayExist = false;
  let restored = false;
  let migrationsPassed = false;
  let compatibilityPassed = false;
  let cleanupPassed = false;
  let connection;
  let adminDatabase;

  try {
    target = createTemporaryDatabaseTarget(connectionString, randomUUID().replaceAll('-', ''));
    if (mapDatabaseUrl) target.databaseUrl = mapDatabaseUrl(target.databaseUrl);
    connection = new URL(connectionString);
    adminDatabase = decodeURIComponent(connection.pathname.slice(1));
    if (!adminDatabase || adminDatabase === target.databaseName) throw new Error('invalid PostgreSQL admin database');
    if ((!runMigrations && !command(migrationCommand)) || !command(compatibilityCommand)) throw new Error('migration and compatibility checks are not configured');
    const host = connection.hostname.replace(/^\[|\]$/g, '');
    const port = connection.port || '5432';
    const username = decodeURIComponent(connection.username || 'postgres');
    const escapePgpass = (value) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replace(/[\r\n]/g, '');
    const passwordLine = `${escapePgpass(host)}:${escapePgpass(port)}:*:${escapePgpass(username)}:${escapePgpass(decodeURIComponent(connection.password || ''))}\n`;
    const workDir = join(tmpdir(), `kubenova-preflight-${randomUUID()}`);
    await mkdir(workDir, { recursive: true, mode: 0o700 });
    passwordFile = join(workDir, '.pgpass');
    await writeFile(passwordFile, passwordLine, { flag: 'wx', mode: 0o600 });
    const pgEnv = { ...baseEnv, PGPASSFILE: passwordFile, ...(connection.searchParams.get('sslmode') ? { PGSSLMODE: connection.searchParams.get('sslmode') } : {}) };
    const pgArgs = ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--host', host, '--port', port, '--username', username];
    databaseMayExist = true;
    await runPostgresCommand('psql', [...pgArgs, '--dbname', adminDatabase, '--command', `CREATE DATABASE ${quotePostgresIdentifier(target.databaseName)}`], { timeout: 60_000, env: pgEnv, maxBuffer: 1024 * 1024 });
    databaseCreated = true;
    checks.push({ name: '临时测试库', status: 'passed', message: '已创建隔离的临时 PostgreSQL 数据库' });
    try {
      await runPostgresCommand('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--host', host, '--port', port, '--username', username, '--dbname', target.databaseName, backupFile], { timeout: 10 * 60_000, env: pgEnv, maxBuffer: 1024 * 1024 });
      restored = true;
      checks.push({ name: '备份恢复', status: 'passed', message: '完整备份已恢复到临时测试库' });
    } catch {
      checks.push({ name: '备份恢复', status: 'failed', message: '无法将 PostgreSQL 备份恢复到临时测试库' });
    }
    if (restored) {
      const checkEnv = { ...baseEnv, PGPASSFILE: passwordFile, DATABASE_URL: target.databaseUrl, KUBENOVA_UPDATE_REHEARSAL_TARGET_VERSION: String(targetVersion || ''), ...(connection.searchParams.get('sslmode') ? { PGSSLMODE: connection.searchParams.get('sslmode') } : {}) };
      try {
        if (runMigrations) await runMigrations({ databaseUrl: target.databaseUrl, targetVersion, command: command(migrationCommand), env: checkEnv });
        else await runCommand('/bin/sh', ['-lc', command(migrationCommand)], { timeout: 10 * 60_000, env: checkEnv, maxBuffer: 1024 * 1024 });
        migrationsPassed = true;
        checks.push({ name: '目标版本迁移', status: 'passed', message: '目标版本数据库迁移已完成' });
      } catch {
        checks.push({ name: '目标版本迁移', status: 'failed', message: '目标版本数据库迁移失败' });
      }
      if (migrationsPassed) {
        try {
          if (checkCompatibility) await checkCompatibility({ databaseUrl: target.databaseUrl, command: command(compatibilityCommand), env: checkEnv });
          else await runCommand('/bin/sh', ['-lc', command(compatibilityCommand)], { timeout: 10 * 60_000, env: checkEnv, maxBuffer: 1024 * 1024 });
          compatibilityPassed = true;
          checks.push({ name: '旧版本兼容', status: 'passed', message: '旧版本兼容性检查已通过' });
        } catch {
          checks.push({ name: '旧版本兼容', status: 'failed', message: '旧版本兼容性检查失败' });
        }
      } else checks.push({ name: '旧版本兼容', status: 'skipped', message: '目标版本迁移未通过' });
    } else {
      checks.push({ name: '目标版本迁移', status: 'skipped', message: '备份未成功恢复' });
      checks.push({ name: '旧版本兼容', status: 'skipped', message: '备份未成功恢复' });
    }
  } catch {
    checks.push({ name: '临时数据库演练', status: 'failed', message: '临时数据库演练无法安全启动；请检查 PostgreSQL 工具、连接和受保护的迁移检查配置' });
  } finally {
    if (databaseMayExist && target && connection && passwordFile) {
      try {
        const host = connection.hostname.replace(/^\[|\]$/g, '');
        const port = connection.port || '5432';
        const username = decodeURIComponent(connection.username || 'postgres');
        await runPostgresCommand('psql', ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--host', host, '--port', port, '--username', username, '--dbname', adminDatabase, '--command', `DROP DATABASE IF EXISTS ${quotePostgresIdentifier(target.databaseName)} WITH (FORCE)`], { timeout: 60_000, env: { ...baseEnv, PGPASSFILE: passwordFile, ...(connection.searchParams.get('sslmode') ? { PGSSLMODE: connection.searchParams.get('sslmode') } : {}) }, maxBuffer: 1024 * 1024 });
        cleanupPassed = true;
        checks.push({ name: '临时测试库清理', status: 'passed', message: '临时 PostgreSQL 数据库已删除' });
      } catch {
        checks.push({ name: '临时测试库清理', status: 'failed', message: '临时 PostgreSQL 数据库未能删除，已阻止更新' });
      }
    } else {
      cleanupPassed = !databaseCreated;
      checks.push({ name: '临时测试库清理', status: cleanupPassed ? 'passed' : 'failed', message: cleanupPassed ? '未创建临时测试库，无需清理' : '无法确认临时测试库清理状态，已阻止更新' });
    }
    if (passwordFile) await rm(join(passwordFile, '..'), { recursive: true, force: true }).catch(() => checks.push({ name: '临时凭据清理', status: 'failed', message: '无法清理临时 PostgreSQL 凭据文件' }));
  }

  const allPassed = databaseCreated && restored && migrationsPassed && compatibilityPassed && cleanupPassed && checks.every((check) => check.status === 'passed');
  return { status: allPassed ? 'passed' : 'failed', checks };
}
