import assert from 'node:assert/strict';
import test from 'node:test';
import { createS3BackupStorage } from './s3-backup-storage.mjs';

const credentials = { AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret' };

test('S3 backup storage validates its bucket, prefix, and credentials', () => {
  assert.throws(() => createS3BackupStorage({ location: 'https://bucket.invalid/backup', secret: credentials, run() {} }), /s3:\/\//);
  assert.throws(() => createS3BackupStorage({ location: 's3://bucket.example', secret: credentials, run() {} }), /dedicated bucket prefix/);
  assert.throws(() => createS3BackupStorage({ location: 's3://bucket/path/../outside', secret: credentials, run() {} }), /prefix/);
  assert.throws(() => createS3BackupStorage({ location: 's3://bucket.example/prefix/%2e%2e/outside', secret: credentials, run() {} }), /prefix/);
  assert.throws(() => createS3BackupStorage({ location: 's3://bucket/path', secret: { ...credentials, AWS_PROFILE: 'default' }, run() {} }), /unsupported/);
  assert.throws(() => createS3BackupStorage({ location: 's3://bucket/path', secret: { AWS_ACCESS_KEY_ID: 'access' }, run() {} }), /incomplete/);
});

test('S3 backup storage verifies write/read/delete and fails if probe cleanup fails', async () => {
  const calls = [];
  const storage = createS3BackupStorage({
    location: 's3://bucket.example/kubenova/backups', secret: credentials,
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[1] === 'rm') throw new Error('remote delete failed');
      if (args[0] === 's3api') return { stdout: '{"Contents":[]}' };
      return { stdout: '' };
    },
  });
  await assert.rejects(storage.verify(), /cleanup failed/);
  assert.deepEqual(calls.map(({ args }) => args[1]), ['cp', 'cp', 'rm']);
  assert.equal(calls[0].command, 'aws');
  assert.equal(calls[0].options.env.AWS_SECRET_ACCESS_KEY, 'secret');
  assert.equal(storage.objectUri('kubenova-update-task-1.dump'), 's3://bucket.example/kubenova/backups/kubenova-update-task-1.dump');
  assert.throws(() => storage.remove('s3://bucket.example/unrelated/object'), /outside/);
});

test('S3 retention keeps newest three and all backups within 30 days', async () => {
  const now = Date.parse('2026-10-21T00:00:00.000Z');
  const rows = Array.from({ length: 6 }, (_, index) => ({
    Key: `kubenova/backups/kubenova-update-${index}.dump`,
    LastModified: new Date(now - index * 20 * 24 * 60 * 60 * 1000).toISOString(),
  }));
  rows.push({ Key: 'kubenova/backups/user-upload.dump', LastModified: new Date(0).toISOString() });
  const deleted = [];
  const storage = createS3BackupStorage({
    location: 's3://bucket.example/kubenova/backups', secret: credentials,
    run: async (_command, args) => args[0] === 's3api' && args[1] === 'list-objects-v2'
      ? { stdout: JSON.stringify({ Contents: rows }) }
      : (deleted.push(args[args.indexOf('--key') + 1]), { stdout: '' }),
  });

  assert.deepEqual(await storage.prune({ now }), ['kubenova/backups/kubenova-update-3.dump', 'kubenova/backups/kubenova-update-4.dump', 'kubenova/backups/kubenova-update-5.dump']);
  assert.equal(deleted.length, 3);
});

test('S3 retention stops before deleting when a backup timestamp is invalid', async () => {
  const deleted = [];
  const storage = createS3BackupStorage({
    location: 's3://bucket.example/kubenova/backups', secret: credentials,
    run: async (_command, args) => args[1] === 'list-objects-v2'
      ? { stdout: JSON.stringify({ Contents: [{ Key: 'kubenova/backups/kubenova-update-broken.dump', LastModified: 'not-a-date' }] }) }
      : (deleted.push(args), { stdout: '' }),
  });

  await assert.rejects(storage.prune(), /invalid modification time/);
  assert.deepEqual(deleted, []);
});
