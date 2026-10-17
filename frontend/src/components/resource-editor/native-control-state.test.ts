import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, load } from 'js-yaml';
import { reconcileMapState, reconcileAdvancedState } from './native-control-state';

const roundtrip = (value: unknown) => load(dump(value));

test('parent YAML roundtrip preserves newly created map row identity while typing', () => {
  const source = { first: 'old' };
  const published = { first: 'old', token: 'a' };
  const rows = [{ id: 'loaded-0', key: 'first', value: 'old' }, { id: 'new-1', key: 'token', value: 'a' }];
  const state = { source, rows, error: '' };
  const result = reconcileMapState(state, roundtrip(published), published, () => { throw new Error('must not recreate rows'); });
  assert.equal(result.rows, rows);
  assert.equal(result.rows[1].id, 'new-1');
  assert.equal(reconcileMapState(result, roundtrip(published), published, () => []), result);
});

test('unrelated parent edits preserve duplicate-key map drafts and pending YAML text', () => {
  const source = { first: 'old' };
  const map = { source, rows: [{ id: 'new-1', key: 'first', value: '' }], error: 'duplicate' };
  assert.equal(reconcileMapState(map, roundtrip(source), source, () => []), map);
  const advanced = { source: { peers: [] }, text: 'peers: [', dirty: true, error: 'invalid' };
  assert.equal(reconcileAdvancedState(advanced, roundtrip(advanced.source), () => 'serialized'), advanced);
});

test('genuine external field changes reset local map and YAML state', () => {
  const map = { source: { a: 'old' }, rows: [{ id: 'old', key: 'a', value: 'old' }], error: '' };
  const rows = [{ id: 'external', key: 'a', value: 'remote' }];
  assert.equal(reconcileMapState(map, { a: 'remote' }, map.source, () => rows).rows, rows);
  const advanced = { source: { a: 1 }, text: 'a: [', dirty: true, error: 'invalid' };
  assert.deepEqual(reconcileAdvancedState(advanced, { a: 2 }, () => 'a: 2'), { source: { a: 2 }, text: 'a: 2', dirty: false, error: '' });
});
