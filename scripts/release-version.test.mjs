import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseMetadata, validateRelease } from './release-version.mjs';

test('version gate checks both package manifests and both lockfile versions before publishing', () => {
  const tmp = fileURLToPath(new URL('../tmp/', import.meta.url));
  mkdirSync(tmp, { recursive: true });
  const dir = mkdtempSync(join(tmp, 'release-version-'));
  const manifest = (component, lock) => {
    mkdirSync(join(dir, component), { recursive: true });
    writeFileSync(join(dir, component, 'package.json'), JSON.stringify({ version: '1.1.0' }));
    writeFileSync(join(dir, component, 'package-lock.json'), JSON.stringify(lock));
  };
  const good = { version: '1.1.0', packages: { '': { version: '1.1.0' } } };
  try {
    writeFileSync(join(dir, 'VERSION'), '1.1.0\n');
    for (const component of ['frontend', 'backend/control-api']) manifest(component, good);
    assert.deepEqual(validateRelease(dir, 'v1.1'), { version: '1.1.0', tag: 'v1.1' });
    assert.equal(validateRelease(dir).tag, 'v1.1.0');
    for (const tag of ['v1.11', 'v1.1.1', 'v01.1', 'v1.1-rc.1', 'v1.1;id', '../v1.1'])
      assert.throws(() => validateRelease(dir, tag));
    for (const component of ['frontend', 'backend/control-api']) {
      for (const bad of [{ ...good, version: '1.0.0' }, { ...good, packages: { '': { version: '1.0.0' } } }]) {
        manifest(component, bad);
        assert.throws(() => validateRelease(dir, 'v1.1'), /package\/package-lock/);
      }
      manifest(component, good);
      writeFileSync(join(dir, component, 'package.json'), JSON.stringify({ version: '1.2.0' }));
      assert.throws(() => validateRelease(dir, 'v1.1'), /package\/package-lock/);
      manifest(component, good);
    }
    writeFileSync(join(dir, 'VERSION'), 'unknown');
    assert.throws(() => validateRelease(dir), /VERSION/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('metadata identifies all three components and the exact build', () => {
  const commit = 'a'.repeat(40);
  const metadata = releaseMetadata({ version: '1.1.0', tag: 'v1.1' }, commit, '2026-09-27T00:00:00Z');
  assert.equal(metadata.gitCommit, commit);
  assert.equal(metadata.packageVersion, '1.1.0');
  assert.deepEqual(Object.values(metadata.components), ['v1.1', 'v1.1', 'v1.1']);
  assert.throws(() => releaseMetadata({ tag: 'v1.1' }, 'unknown', '2026-09-27'), /Git commit/);
});
