import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const imagePattern = /^ghcr\.io\/feize666\/kubenova-control-api@sha256:[a-f0-9]{64}$/;

export function selectSharedDockerNetwork(apiNetworks, postgresNetworks) {
  const shared = Object.keys(apiNetworks ?? {}).filter((name) => Object.hasOwn(postgresNetworks ?? {}, name));
  if (!shared.length) throw new Error('No shared Docker network between control-api and PostgreSQL');
  return shared.sort()[0];
}

export function createComposeMigrationAdapter({ composeArgs, dockerNetwork, targetImage, stateDir, run }) {
  if (!Array.isArray(composeArgs) || !dockerNetwork) throw new Error('Compose executor network is not configured');
  if (!imagePattern.test(String(targetImage))) throw new Error('target control-api image must be immutable and trusted');
  if (typeof run !== 'function') throw new Error('Docker command runner is required');

  const docker = async (args, options = {}) => run('docker', args, {
    timeout: options.timeout ?? 10 * 60_000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    env: { ...process.env, ...options.env },
  });
  const containerCommand = (service, args, options = {}) => docker(
    [...composeArgs, 'exec', '-T', ...(options.inheritEnv ? ['-e', options.inheritEnv] : []), service, ...args],
    options,
  );
  const cleanEnvironment = (env = {}) => {
    const { PGPASSFILE: _hostPgpassFile, ...safe } = env;
    return safe;
  };

  return {
    databaseUrl(connectionString) {
      const url = new URL(connectionString);
      url.hostname = 'postgres';
      return url.href;
    },
    async runPostgresCommand(command, args, options = {}) {
      if (command === 'psql') {
        return containerCommand('postgres', [command, ...args], { ...options, inheritEnv: 'PGPASSWORD', env: cleanEnvironment(options.env) });
      }
      if (command !== 'pg_restore') throw new Error('unsupported PostgreSQL rehearsal command');
      const backupFile = args.at(-1);
      const remoteFile = `/tmp/kubenova-preflight-${randomUUID()}-${basename(backupFile)}`;
      try {
        await docker([...composeArgs, 'cp', backupFile, `postgres:${remoteFile}`], { timeout: 60_000 });
        return await containerCommand('postgres', [...args.slice(0, -1), remoteFile], { ...options, inheritEnv: 'PGPASSWORD', env: cleanEnvironment(options.env) });
      } finally {
        await containerCommand('postgres', ['rm', '-f', remoteFile], { timeout: 60_000 });
      }
    },
    async runMigrations({ databaseUrl, targetVersion }) {
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      const envFile = join(stateDir, `.preflight-${randomUUID()}.env`);
      const content = `DATABASE_URL=${databaseUrl}\nKUBENOVA_UPDATE_REHEARSAL_TARGET_VERSION=${String(targetVersion || '')}\n`;
      await writeFile(envFile, content, { flag: 'wx', mode: 0o600 });
      try {
        await docker(['run', '--rm', '--network', dockerNetwork, '--env-file', envFile, '--entrypoint', './node_modules/.bin/prisma', targetImage, 'migrate', 'deploy']);
      } finally {
        await rm(envFile, { force: true });
      }
    },
    async checkCompatibility({ databaseUrl, command }) {
      if (!String(command ?? '').trim()) throw new Error('old-version compatibility check is not configured');
      return containerCommand('control-api', ['/bin/sh', '-lc', String(command)], {
        inheritEnv: 'DATABASE_URL', env: { DATABASE_URL: databaseUrl }, timeout: 10 * 60_000,
      });
    },
  };
}
