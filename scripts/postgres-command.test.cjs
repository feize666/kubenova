const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Explicit local DB required');
const run = (command, args, overrides = {}) => spawnSync(process.execPath,
  [path.join(__dirname, 'postgres-command.cjs'), 'DATABASE_URL', command, ...args], {
    env: { ...process.env, PGHOSTADDR: '192.0.2.1', PGSERVICE: 'invalid', PGOPTIONS: '-c search_path=invalid', ...overrides },
    timeout: 15000, maxBuffer: 10 * 1024 * 1024,
  });
const query = run('psql', ['-X', '-At', '-c', 'SELECT current_database()']);
assert.equal(query.status, 0, query.stderr.toString());
assert.equal(query.stdout.toString().trim(), decodeURIComponent(url.pathname.slice(1)));
const dump = run('pg_dump', ['--format=custom', '--schema-only', '--no-owner', '--no-acl']);
assert.equal(dump.status, 0, dump.stderr.toString());
assert.equal(dump.stdout.subarray(0, 5).toString(), 'PGDMP');
const denied = run('psql', ['-c', 'SELECT 1'], { DATABASE_URL: `${url.origin}${url.pathname}?host=other.invalid` });
assert.notEqual(denied.status, 0);
console.log('PASS actual local psql/pg_dump connection, inherited override removal and unsupported URL option denial; schema-only archive held in memory');
