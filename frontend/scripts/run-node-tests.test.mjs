import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('explicit test targets must exist; a typo cannot produce a passing gate', () => {
  const result = spawnSync(process.execPath, ['scripts/run-node-tests.mjs', 'src/components/resource-editor/editor-read-state.test.ts', 'src/nonexistent-qa-test.test.ts'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /test target is not a file.*nonexistent-qa-test/);
  assert.doesNotMatch(result.stdout, /tests \d+/);
});
