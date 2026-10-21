import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('prepare-only configures a private systemd updater without starting host services', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubenova-systemd-updater-'));
  try {
    const configDir = join(dir, 'etc/kubenova');
    const unitDir = join(dir, 'units');
    const runtimeDir = join(dir, 'run/kubenova-update');
    const stateDir = join(dir, 'var/lib/kubenova/update-executor');
    await mkdir(configDir, { recursive: true });
    const apiEnv = join(configDir, 'control-api.env');
    await writeFile(join(configDir, 'update-executor.env'), 'KUBENOVA_UPDATE_MIGRATION_TEST_COMMAND=target-prisma-migrate\nKUBENOVA_UPDATE_OLD_VERSION_COMPATIBILITY_COMMAND=old-api-smoke\n', { mode: 0o600 });
    await writeFile(apiEnv, 'DATABASE_URL=postgresql://user:secret@127.0.0.1/kubenova\nJWT_SECRET=keep-this-value\n', { mode: 0o600 });

    const result = spawnSync(process.execPath, [
      join(root, 'scripts/install-systemd-update-executor.mjs'), '--prepare-only',
      '--root', root, '--config-dir', configDir, '--unit-dir', unitDir,
      '--runtime-dir', runtimeDir, '--state-dir', stateDir,
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    const hostEnv = await readFile(join(configDir, 'update-executor.env'), 'utf8');
    const controlEnv = await readFile(apiEnv, 'utf8');
    const unit = await readFile(join(unitDir, 'kubenova-update-executor.service'), 'utf8');
    const token = hostEnv.match(/^KUBENOVA_UPDATE_EXECUTOR_TOKEN=(.+)$/m)?.[1];
    assert.match(hostEnv, /^KUBENOVA_UPDATE_MIGRATION_TEST_COMMAND=target-prisma-migrate$/m);
    assert.match(hostEnv, /^KUBENOVA_UPDATE_OLD_VERSION_COMPATIBILITY_COMMAND=old-api-smoke$/m);
    assert.ok(token && token.length >= 32);
    assert.match(controlEnv, new RegExp('^KUBENOVA_UPDATE_EXECUTOR_TOKEN=' + token + '$', 'm'));
    assert.match(controlEnv, /^KUBENOVA_UPDATE_EXECUTOR_SOCKET=\/run\/kubenova-update\/executor\.sock$/m);
    assert.match(controlEnv, /^KUBENOVA_UPDATE_REPOSITORY=feize666\/kubenova$/m);
    const encryptionKey = controlEnv.match(/^KUBENOVA_UPDATE_ENCRYPTION_KEY=([a-f0-9]{64})$/m)?.[1];
    assert.ok(encryptionKey, 'installer must generate the independent settings encryption key');
    assert.match(unit, /systemd-update-executor\.mjs/);
    assert.match(unit, /User=root/);
    assert.equal((await stat(join(configDir, 'update-executor.env'))).mode & 0o777, 0o600);
    assert.equal((await stat(apiEnv)).mode & 0o777, 0o600);
    assert.match(controlEnv, /DATABASE_URL=postgresql:\/\/user:secret@127\.0\.0\.1\/kubenova/);
    assert.match(controlEnv, /JWT_SECRET=keep-this-value/);
    const repeated = spawnSync(process.execPath, [join(root, 'scripts/install-systemd-update-executor.mjs'), '--prepare-only', '--root', root, '--config-dir', configDir, '--unit-dir', unitDir, '--runtime-dir', runtimeDir, '--state-dir', stateDir], { encoding: 'utf8' });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.match(await readFile(apiEnv, 'utf8'), new RegExp('^KUBENOVA_UPDATE_ENCRYPTION_KEY=' + encryptionKey + '$', 'm'));
    assert.match(result.stdout, /未启动服务/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
