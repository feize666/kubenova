import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';

const credentialKeys = new Set([
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ENDPOINT_URL',
]);

export function createS3BackupStorage({ location, secret = {}, run }) {
  const rawPath = /^s3:\/\/[^/]+\/(.*)$/.exec(String(location ?? ''))?.[1] ?? '';
  let decodedSegments;
  try { decodedSegments = rawPath.split(/[?#]/, 1)[0].split('/').map(decodeURIComponent); }
  catch { throw new Error('S3 backup prefix is invalid'); }
  if (decodedSegments.some((segment) => segment === '.' || segment === '..' || segment.includes('/'))) throw new Error('S3 backup prefix is invalid');
  let url;
  try { url = new URL(location); } catch { throw new Error('S3 backup location is invalid'); }
  if (url.protocol !== 's3:' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(url.hostname) || url.search || url.hash || url.username || url.password)
    throw new Error('S3 backup location must be an s3://bucket/prefix URI');
  const prefix = url.pathname.replace(/^\/+|\/+$/g, '');
  if (!prefix) throw new Error('S3 backup location must include a dedicated bucket prefix');
  if (prefix.split('/').some((segment) => segment === '.' || segment === '..')) throw new Error('S3 backup prefix is invalid');
  if (typeof run !== 'function') throw new Error('S3 command runner is required');
  if (!secret || typeof secret !== 'object' || Array.isArray(secret) || Object.keys(secret).some((key) => !credentialKeys.has(key)) || typeof secret.AWS_ACCESS_KEY_ID !== 'string' || !secret.AWS_ACCESS_KEY_ID.trim() || typeof secret.AWS_SECRET_ACCESS_KEY !== 'string' || !secret.AWS_SECRET_ACCESS_KEY.trim())
    throw new Error('S3 credentials are incomplete or contain unsupported fields');

  const env = Object.fromEntries(Object.entries(secret).filter(([, value]) => typeof value === 'string' && value.trim()));
  const objectUri = (fileName) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(fileName) || fileName === '.' || fileName === '..') throw new Error('S3 backup object name is invalid');
    return `s3://${url.hostname}/${[prefix, fileName].filter(Boolean).join('/')}`;
  };
  const aws = async (args) => {
    try { return await run('aws', args, { timeout: 10 * 60_000, env: { ...env } }); }
    catch { throw new Error('S3-compatible backup operation failed'); }
  };

  return {
    objectUri,
    upload(source, fileName) { return aws(['s3', 'cp', source, objectUri(fileName), '--only-show-errors']); },
    download(uri, destination) { return aws(['s3', 'cp', uri, destination, '--only-show-errors']); },
    remove(uri) {
      const target = new URL(uri);
      if (target.protocol !== 's3:' || target.hostname !== url.hostname || !target.pathname.startsWith(`/${prefix ? `${prefix}/` : ''}`)) throw new Error('S3 object is outside the configured backup prefix');
      return aws(['s3', 'rm', uri, '--only-show-errors']);
    },
    async verify() {
      const dir = await mkdtemp(join(tmpdir(), 'kubenova-s3-preflight-'));
      const source = join(dir, 'probe');
      const restored = join(dir, 'restored');
      const uri = objectUri(`kubenova-preflight-${randomUUID()}`);
      let operationError;
      try {
        await writeFile(source, randomUUID(), { flag: 'wx', mode: 0o600 });
        await aws(['s3', 'cp', source, uri, '--only-show-errors']);
        await aws(['s3', 'cp', uri, restored, '--only-show-errors']);
        const [expected, actual] = await Promise.all([readFile(source), readFile(restored)]);
        if (!expected.equals(actual)) throw new Error('S3 backup read-back verification failed');
      } catch (error) { operationError = error; }
      let cleanupError;
      try { await aws(['s3', 'rm', uri, '--only-show-errors']); } catch (error) { cleanupError = error; }
      try { await rm(dir, { recursive: true, force: true }); } catch (error) { cleanupError ??= error; }
      if (cleanupError) throw new Error('S3 preflight object cleanup failed');
      if (operationError) throw operationError;
    },
    async prune({ now = Date.now(), keepNewest = 3, retainMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
      const result = await aws(['s3api', 'list-objects-v2', '--bucket', url.hostname, '--prefix', prefix ? `${prefix}/` : '', '--output', 'json']);
      let payload;
      try { payload = JSON.parse(result.stdout || '{}'); } catch { throw new Error('S3 backup listing response is invalid'); }
      const backups = (Array.isArray(payload.Contents) ? payload.Contents : [])
        .filter((item) => typeof item?.Key === 'string' && item.Key.startsWith(prefix ? `${prefix}/` : '') && /^kubenova-update-[a-zA-Z0-9_-]+\.(?:dump|sql)$/.test(posix.basename(item.Key)))
        .sort((a, b) => String(b.LastModified).localeCompare(String(a.LastModified)));
      if (backups.some((item) => !Number.isFinite(Date.parse(item.LastModified || '')))) throw new Error('S3 backup listing contains an invalid modification time; cleanup was stopped');
      const protectedKeys = new Set(backups.slice(0, keepNewest).map((item) => item.Key));
      for (const item of backups) {
        const modifiedAt = Date.parse(item.LastModified || '');
        if (now - modifiedAt < retainMs) protectedKeys.add(item.Key);
      }
      const deleted = [];
      for (const item of backups) {
        if (protectedKeys.has(item.Key)) continue;
        await aws(['s3api', 'delete-object', '--bucket', url.hostname, '--key', item.Key]);
        deleted.push(item.Key);
      }
      return deleted;
    },
  };
}
