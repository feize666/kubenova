import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createComposeMigrationAdapter, selectSharedDockerNetwork } from './compose-update-preflight.mjs';

test('Compose rehearsal selects a network shared by the live API and PostgreSQL containers', () => {
  assert.equal(selectSharedDockerNetwork(
    { 'kubenova_default': {}, 'metrics': {} },
    { 'metrics': {}, 'kubenova_default': {} },
  ), 'kubenova_default');
  assert.throws(() => selectSharedDockerNetwork({ app: {} }, { database: {} }), /shared Docker network/);
});

test('Compose adapter runs target migrations by immutable image and removes its private env file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'kubenova-compose-preflight-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const adapter = createComposeMigrationAdapter({
    composeArgs: ['compose', '--project-name', 'kubenova'],
    dockerNetwork: 'kubenova_default',
    targetImage: 'ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64),
    stateDir: dir,
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args.includes('--env-file')) {
        const file = args[args.indexOf('--env-file') + 1];
        assert.equal((await stat(file)).mode & 0o777, 0o600);
        assert.match(await readFile(file, 'utf8'), /^DATABASE_URL=postgresql:\/\/admin:secret@postgres(?::5432)?\/kubenova_preflight_/m);
      }
      return { stdout: '', stderr: '' };
    },
  });

  const url = adapter.databaseUrl('postgresql://admin:secret@localhost/kubenova_preflight_' + 'b'.repeat(32));
  await adapter.runMigrations({ databaseUrl: url, targetVersion: 'v1.2' });
  await adapter.checkCompatibility({ databaseUrl: url, command: 'node compatibility-check.js' });
  await adapter.runPostgresCommand('pg_restore', ['--dbname', 'kubenova_preflight_' + 'b'.repeat(32), '/tmp/backup.dump']);

  assert.equal(calls[0].command, 'docker');
  assert.ok(calls[0].args.includes('--network'));
  assert.ok(calls[0].args.includes('ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64)));
  assert.ok(calls[1].args.includes('control-api'));
  assert.ok(calls[1].args.includes('DATABASE_URL'));
  assert.ok(!calls.some(({ args }) => args.join(' ').includes('secret')));
});

test('Compose adapter rejects mutable or untrusted control-api image references', async () => {
  assert.throws(() => createComposeMigrationAdapter({ composeArgs: [], dockerNetwork: 'x', targetImage: 'ghcr.io/feize666/kubenova-control-api:latest', stateDir: '/tmp' }), /immutable/);
});

test('Compose adapter fails rehearsal if its copied dump cannot be removed from PostgreSQL container', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'kubenova-compose-cleanup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const adapter = createComposeMigrationAdapter({
    composeArgs: ['compose', '--project-name', 'kubenova'],
    dockerNetwork: 'kubenova_default',
    targetImage: 'ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64),
    stateDir: dir,
    run: async (_command, args) => {
      if (args.includes('rm')) throw new Error('container cleanup failed');
      return { stdout: '', stderr: '' };
    },
  });

  await assert.rejects(adapter.runPostgresCommand('pg_restore', ['--dbname', 'test_db', '/tmp/backup.dump']), /container cleanup failed/);
});

test('Compose adapter attempts remote dump cleanup when docker cp fails', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'kubenova-compose-copy-failure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const adapter = createComposeMigrationAdapter({
    composeArgs: ['compose', '--project-name', 'kubenova'],
    dockerNetwork: 'kubenova_default',
    targetImage: 'ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64),
    stateDir: dir,
    run: async (_command, args) => {
      calls.push(args);
      if (args.includes('cp')) throw new Error('copy failed');
      return { stdout: '', stderr: '' };
    },
  });

  await assert.rejects(adapter.runPostgresCommand('pg_restore', ['--dbname', 'test_db', '/tmp/backup.dump']), /copy failed/);
  assert.ok(calls.some((args) => args.includes('rm')));
});
