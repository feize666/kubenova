import assert from 'node:assert/strict';
import test from 'node:test';
import { readAccessState } from './read-access-state';

test('permission denial remains latched through a transient refresh failure', () => {
  const denied = readAccessState({ scope: 'secret/default/private', denied: false }, 'secret/default/private', {
    error: Object.assign(new Error('forbidden'), { status: 403 }),
    succeeded: false,
  });
  assert.deepEqual(denied, { scope: 'secret/default/private', denied: true });

  const transient = readAccessState(denied, 'secret/default/private', {
    error: Object.assign(new Error('unavailable'), { status: 503 }),
    succeeded: false,
  });
  assert.deepEqual(transient, denied);
});

test('a successful read is the only event that releases the denial for the same resource', () => {
  const denied = { scope: 'secret/default/private', denied: true };
  assert.deepEqual(
    readAccessState(denied, 'secret/default/private', { error: null, succeeded: true }),
    { scope: 'secret/default/private', denied: false },
  );
  assert.deepEqual(
    readAccessState(denied, 'secret/default/other', { error: null, succeeded: true }),
    { scope: 'secret/default/other', denied: false },
  );
});
