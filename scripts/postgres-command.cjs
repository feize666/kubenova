const { spawnSync } = require('node:child_process');

// Credentials stay in the child environment, never in its argument list.
const [variable, command, ...args] = process.argv.slice(2);
try {
  if (!['DATABASE_URL', 'KEYCLOAK_DATABASE_URL', 'RESTORE_DATABASE_URL'].includes(variable) ||
      !['pg_dump', 'pg_restore', 'psql'].includes(command)) throw Error();
  const url = new URL(process.env[variable]);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash || !url.pathname.slice(1)) throw Error();
  const env = { ...process.env, PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
  for (const name of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) delete env[name];
  const options = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', connect_timeout: 'PGCONNECT_TIMEOUT' };
  for (const [key, value] of url.searchParams) {
    if (!options[key] || url.searchParams.getAll(key).length !== 1) throw Error();
    env[options[key]] = value;
  }
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} catch {
  console.error('Invalid PostgreSQL command or connection configuration');
  process.exitCode = 1;
}
