import { assertValidPreflight } from './preflight-policy';

describe('update preflight policy', () => {
  const now = Date.parse('2026-10-21T00:00:00.000Z');
  const valid = { id: 'preflight-1', status: 'passed' as const, targetVersion: 'v1.9', expiresAt: new Date(now + 1000).toISOString(), settingsFingerprint: 'settings-a', backupTargetId: 'backup-a' };

  it('accepts only the current, unexpired preflight bound to the requested release', () => {
    expect(() => assertValidPreflight(valid, 'preflight-1', 'v1.9', now, 'settings-a', 'backup-a')).not.toThrow();
  });

  it('rejects missing, mismatched, failed, and expired preflight records', () => {
    expect(() => assertValidPreflight(null, 'preflight-1', 'v1.9', now)).toThrow(/重新运行预检/);
    expect(() => assertValidPreflight(valid, 'wrong-id', 'v1.9', now)).toThrow(/重新运行预检/);
    expect(() => assertValidPreflight(valid, 'preflight-1', 'v1.10', now)).toThrow(/目标版本已变化/);
    expect(() => assertValidPreflight({ ...valid, status: 'failed' }, 'preflight-1', 'v1.9', now)).toThrow(/预检未通过/);
    expect(() => assertValidPreflight({ ...valid, expiresAt: new Date(now).toISOString() }, 'preflight-1', 'v1.9', now)).toThrow(/已过期/);
    expect(() => assertValidPreflight(valid, 'preflight-1', 'v1.9', now, 'settings-b', 'backup-a')).toThrow(/配置已变化/);
    expect(() => assertValidPreflight(valid, 'preflight-1', 'v1.9', now, 'settings-a', 'backup-b')).toThrow(/备份目标已变化/);
  });
});
