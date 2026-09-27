// Isolated systemd contract: never restarts any real host service.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, readlinkSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(join(root, 'tmp'), { recursive: true });
const dir = mkdtempSync(join(root, 'tmp/release-switch-'));
try {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const [name, source] of Object.entries({
    systemctl: '#!/bin/sh\necho "$*" >> "$CALL_LOG"\nif [ "$FAIL_RESTART" = 1 ] && [ "$1" = restart ]; then exit 1; fi\n',
    curl: '#!/bin/sh\nexit 0\n',
  })) { writeFileSync(join(bin, name), source.replaceAll('\\n', '\n')); chmodSync(join(bin, name), 0o755); }
  for (const version of ['v1.8', 'v1.9']) {
    const base = join(dir, 'releases', version);
    for (const file of ['runtime-gateway/runtime-gateway', 'control-api/dist/src/main.js', 'control-api/package.json', 'control-api/node_modules/.bin/prisma', 'frontend/.next/standalone/server.js']) {
      mkdirSync(resolve(base, file, '..'), { recursive: true });
      writeFileSync(join(base, file), 'fixture');
      chmodSync(join(base, file), 0o755);
    }
    mkdirSync(join(base, 'frontend/.next/standalone/.next/static'), { recursive: true });
  }
  const current = join(dir, 'current');
  symlinkSync(join(dir, 'releases/v1.8'), current);
  const run = (version, fail = false) => spawnSync('bash', ['scripts/prod.sh', 'switch', version], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, RELEASE_BASE: dir, CALL_LOG: join(dir, 'calls'), FAIL_RESTART: fail ? '1' : '0' },
  });
  const failed = run('v1.9', true);
  assert.notEqual(failed.status, 0, 'a failed service restart must never report successful upgrade');
  assert.equal(readlinkSync(current), join(dir, 'releases/v1.8'), 'failed activation restores the previous release pointer');
  assert.notEqual(run('../v1.9').status, 0, 'reject path traversal in version');
  const success = run('v1.9');
  assert.equal(success.status, 0, success.stderr);
  assert.equal(readlinkSync(current), join(dir, 'releases/v1.9'));
  assert.match(readFileSync(join(dir, 'calls'), 'utf8'), /restart .*kubenova-frontend.service/, 'frontend must activate with API and gateway');
  console.log('PASS: release switch rejects invalid versions, rolls back failures, activates all three services');
} finally { rmSync(dir, { recursive: true, force: true }); }
