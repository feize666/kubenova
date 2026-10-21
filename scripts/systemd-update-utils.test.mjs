import assert from 'node:assert/strict';
import test from 'node:test';
import { postgresDumpConfig } from './systemd-update-utils.mjs';

test('PostgreSQL backup arguments never expose the password and escape it for pgpass', () => {
  const config = postgresDumpConfig('postgresql://backup-user:p%3Aa%5Css@db.internal:5544/kubenova?sslmode=require', '/var/lib/kubenova/backup.dump');
  assert.equal(config.args.includes('p:a\\ss'), false);
  assert.deepEqual(config.args.slice(-4), ['5544', '--username', 'backup-user', 'kubenova']);
  assert.equal(config.passwordLine, 'db.internal:5544:kubenova:backup-user:p\\:a\\\\ss\n');
  assert.equal(config.sslmode, 'require');
});
