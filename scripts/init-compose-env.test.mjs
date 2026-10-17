import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const secretNames = ['POSTGRES_PASSWORD', 'JWT_SECRET', 'RUNTIME_TOKEN_SECRET', 'RUNTIME_GATEWAY_INTERNAL_SECRET', 'AI_CREDENTIAL_ENCRYPTION_KEY', 'DEFAULT_ADMIN_PASSWORD'];
test('first deployment generates private secrets, repeated init preserves credentials and custom addresses', () => {
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const dir = mkdtempSync(path.join(root, 'tmp/init-compose-'));
  try {
    const file = path.join(dir, '.env');
    const init = () => execFileSync(process.execPath, [path.join(root, 'scripts/init-compose-env.mjs'), file], { encoding: 'utf8' });
    const output = init();
    const first = readFileSync(file, 'utf8');
    const values = Object.fromEntries(first.split('\n').filter(x => x && !x.startsWith('#')).map(x => [x.slice(0,x.indexOf('=')), x.slice(x.indexOf('=')+1)]));
    for (const name of secretNames) {
      assert.match(values[name], /^[a-f0-9]{64}$/);
      assert.ok(!output.includes(values[name]), 'secrets must not be logged');
    }
    assert.equal(new Set(secretNames.map(name => values[name])).size, secretNames.length);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    writeFileSync(file, first.replace('http://localhost:3000', 'https://console.internal'));
    const before = readFileSync(file, 'utf8');
    init();
    assert.equal(readFileSync(file, 'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
