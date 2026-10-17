import assert from 'node:assert/strict';
import test from 'node:test';
import * as model from './secret-model';
import type { ResourceManifest } from '@/lib/resource-editor';

const secret = (extra = {}): ResourceManifest => ({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'demo' }, ...extra });

test('binary uploads preserve exact bytes and require an explicit duplicate decision', () => {
  const original = secret({ data: { old: 'AAH/' }, stringData: { text: '原文' }, extension: true });
  const file = { name: 'old', bytes: Uint8Array.of(0, 255, 128) };
  assert.throws(() => model.applySecretFiles(original, [file]), /已存在/);
  const replaced = model.applySecretFiles(original, [file], { old: { action: 'overwrite' } });
  assert.deepEqual(replaced.data, { old: 'AP+A' });
  assert.deepEqual(replaced.stringData, { text: '原文' });
  assert.equal(replaced.extension, true);
  assert.deepEqual(model.applySecretFiles(original, [file], { old: { action: 'skip' } }), original);
  assert.deepEqual(model.applySecretFiles(original, [file], { old: { action: 'rename', key: 'new.bin' } }).data, { old: 'AAH/', 'new.bin': 'AP+A' });
});

test('upload budget uses raw bytes including untouched data and stringData overrides', () => {
  assert.throws(() => model.applySecretFiles(secret(), [{ name: 'large', bytes: new Uint8Array(1024 * 1024 + 1) }]), /单文件/);
  assert.throws(() => model.applySecretFiles(secret(), [{ name: 'large', bytes: new Uint8Array(900 * 1024 + 1) }]), /900/);
  assert.throws(() => model.applySecretFiles(secret(), Array.from({ length: 51 }, (_, index) => ({ name: `f${index}`, bytes: new Uint8Array() }))), /50/);
  const original = secret({ data: { big: 'A'.repeat(900 * 1024 * 4 / 3), unchanged: 'AAH/' }, stringData: { big: '' } });
  assert.equal(model.secretRawBytes(original), 3);
  assert.throws(() => model.applySecretFiles(secret(), [{ name: '__proto__', bytes: new Uint8Array() }]), /键名/);
});

test('Docker credentials preserve other registries and unknown fields', () => {
  const original = secret({ type: 'kubernetes.io/dockerconfigjson', stringData: { '.dockerconfigjson': JSON.stringify({ auths: { old: { auth: 'keep' } }, credsStore: 'desktop' }) }, data: { untouched: 'AAH/' } });
  const next = model.setDockerCredentials(original, 'registry.example.com', 'user', '密码');
  const parsed = JSON.parse(String((next.stringData as Record<string, string>)['.dockerconfigjson']));
  assert.deepEqual(parsed.auths.old, { auth: 'keep' });
  assert.equal(parsed.credsStore, 'desktop');
  assert.equal(parsed.auths['registry.example.com'].auth, 'dXNlcjrlr4bnoIE=');
  assert.deepEqual(next.data, { untouched: 'AAH/' });
  assert.throws(() => model.setDockerCredentials(original, '', 'u', 'p'), /仓库/);
});
