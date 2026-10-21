type PreflightRecord = { id: string; status: string; targetVersion: string; expiresAt: string | null; settingsFingerprint?: string; backupTargetId?: string | null };

export function assertValidPreflight(record: PreflightRecord | null, id: string | undefined, targetVersion: string, now = Date.now(), settingsFingerprint?: string, backupTargetId?: string): void {
  if (!record || !id || record.id !== id) throw new Error('请先重新运行预检');
  if (record.status !== 'passed') throw new Error('预检未通过，不能开始更新');
  if (record.targetVersion !== targetVersion) throw new Error('预检目标版本已变化，请重新运行预检');
  if (!record.expiresAt || Date.parse(record.expiresAt) <= now) throw new Error('预检已过期，请重新运行预检');
  if (!settingsFingerprint || !record.settingsFingerprint || record.settingsFingerprint !== settingsFingerprint)
    throw new Error('更新配置已变化，请重新运行预检');
  if (!backupTargetId || record.backupTargetId !== backupTargetId)
    throw new Error('备份目标已变化，请重新运行预检');
}
