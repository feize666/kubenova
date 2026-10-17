import assert from 'node:assert/strict';
import test from 'node:test';
import * as model from './schema-model';

test('schema array items have typed defaults instead of undefined/null', () => {
  assert.equal(typeof model.schemaInitialValue, 'function');
  assert.deepEqual(['string', 'integer', 'boolean', 'array', 'object'].map(type => model.schemaInitialValue({ type })), ['', 0, false, [], {}]);
  assert.deepEqual(model.schemaInitialValue({ type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 2 }, optional: { type: 'string' } } }), { count: 2 });
});

test('int-or-string precedes numeric type and constraints report required/min/max/type errors', () => {
  assert.equal(typeof model.validateSchemaValue, 'function');
  assert.deepEqual(model.validateSchemaValue({ type: 'integer', 'x-kubernetes-int-or-string': true }, 'http'), []);
  const issues = model.validateSchemaValue({ type: 'object', required: ['name'], properties: { count: { type: 'integer', minimum: 2, maximum: 8 }, flag: { type: 'boolean' } } }, { count: 1.5, flag: 'true' });
  assert.ok(issues.some(issue => issue.path === '$.name'));
  assert.ok(issues.some(issue => issue.path === '$.count'));
  assert.ok(issues.some(issue => issue.path === '$.flag'));
  assert.ok(model.validateSchemaValue({ type: 'string', minLength: 2, maxLength: 4 }, '').length);
});

test('readOnly and disabled edits are ignored; optional unset removes rather than empties', () => {
  assert.equal(typeof model.updateSchemaField, 'function');
  const schema = { type: 'object', properties: { spec: { type: 'object', properties: { locked: { type: 'string', readOnly: true }, label: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { count: { type: 'integer' } } } } } } } };
  const input = { apiVersion: 'demo/v1', kind: 'Demo', metadata: {}, spec: { locked: 'old', label: '', extension: 4, items: [{ count: 1, unknown: 'keep' }] } };
  assert.equal(model.updateSchemaField(input, schema, ['spec', 'locked'], 'new'), input);
  assert.equal(model.updateSchemaField(input, schema, ['spec', 'label'], 'new', true), input);
  const next = model.updateSchemaField(input, schema, ['spec', 'items', 0, 'count'], 2);
  assert.deepEqual((next.spec as any).items, [{ count: 2, unknown: 'keep' }]);
  assert.equal((next.spec as any).extension, 4);
  const unset = model.updateSchemaField(input, schema, ['spec', 'label'], undefined);
  assert.equal(Object.hasOwn(unset.spec as object, 'label'), false);
});

test('unsupported editable constructs fallback but hidden metadata/status do not block', () => {
  assert.equal(typeof model.validateResourceSchema, 'function');
  assert.deepEqual(model.validateResourceSchema({ type: 'object', properties: { metadata: { $ref: '#/meta' }, status: { oneOf: [] }, spec: { type: 'object', properties: { size: { type: 'integer' } } } } }), []);
  assert.ok(model.validateResourceSchema({ type: 'object', properties: { spec: { $ref: '#/unknown' } } }).length);
  assert.ok(model.validateResourceSchema({ type: 'object', properties: { spec: { type: 'object', additionalProperties: true } } }).length);
});

test('typed additionalProperties maps accept new typed keys and preserve arbitrary unknown values', () => {
  assert.equal(typeof model.updateSchemaField, 'function');
  const schema = { type: 'object', properties: { spec: { type: 'object', additionalProperties: { type: 'array', items: { type: 'integer' } } } } };
  const input = { apiVersion: 'demo/v1', kind: 'Demo', metadata: {}, spec: { old: [7], untouched: { nested: true } } };
  const next = model.updateSchemaField(input, schema, ['spec', 'new'], [0, 2]);
  assert.deepEqual(next.spec, { old: [7], untouched: { nested: true }, new: [0, 2] });
  assert.throws(() => model.updateSchemaField(input, schema, ['spec', '__proto__'], []), /不安全/);
});

test('replacing a map cannot erase nested readOnly fields in additionalProperties', () => {
  const schema = { type: 'object', properties: { spec: { type: 'object', additionalProperties: { type: 'object', properties: { id: { type: 'string', readOnly: true }, enabled: { type: 'boolean' } } } } } };
  const input = { apiVersion: 'demo/v1', kind: 'Demo', metadata: {}, spec: { first: { id: 'server-owned', enabled: true } } };
  assert.equal(model.updateSchemaField(input, schema, ['spec'], {}), input);
  assert.equal(model.updateSchemaField(input, schema, ['spec'], undefined), input);
  assert.deepEqual(model.updateSchemaField(input, schema, ['spec', 'first', 'enabled'], false).spec, { first: { id: 'server-owned', enabled: false } });
});
