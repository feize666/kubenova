#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateRelease(directory, tag) {
  const version = readFileSync(resolve(directory, 'VERSION'), 'utf8').trim();
  if (!stable.test(version) || !version.split('.').every(n => Number.isSafeInteger(Number(n))))
    throw new Error('VERSION 必须为稳定版本，例如 1.1.0');
  tag ||= 'v' + version;
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/.test(tag))
    throw new Error('Tag 必须为稳定版本，例如 v1.1 或 v1.1.1');
  const parts = tag.slice(1).split('.');
  if (parts.length === 2) parts.push('0');
  if (parts.join('.') !== version) throw new Error('Tag 与 VERSION 不一致');
  for (const component of ['frontend', 'backend/control-api']) {
    const pkg = JSON.parse(readFileSync(resolve(directory, component, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(resolve(directory, component, 'package-lock.json'), 'utf8'));
    if (pkg.version !== version || lock.version !== version || lock.packages?.['']?.version !== version)
      throw new Error(component + ': package/package-lock 与 VERSION 不一致');
  }
  return { version, tag };
}

export function releaseMetadata(release, commit, createdAt) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('发布必须记录完整 Git commit');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('构建时间无效');
  return {
    name: 'kubenova', package: 'kubenova-ubuntu', target: 'ubuntu-systemd',
    version: release.tag, packageVersion: release.version, gitCommit: commit, createdAt,
    components: { frontend: release.tag, controlApi: release.tag, runtimeGateway: release.tag },
    supportedPlatforms: ['linux-amd64'], nodeVersion: '22+', databaseMigration: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const release = validateRelease(root, process.argv[2]);
    if (process.argv[3] === '--metadata') {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      console.log(JSON.stringify(releaseMetadata(release, commit, new Date().toISOString()), null, 2));
    } else {
      console.log('[release-version] ' + release.tag + ': VERSION、前后端 package 和 lockfile 一致');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
