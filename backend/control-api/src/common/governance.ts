import { ForbiddenException } from '@nestjs/common';

export type PlatformRole = 'platform-admin' | 'cluster-operator' | 'read-only';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'enable'
  | 'disable'
  | 'batch'
  | 'scale'
  | 'restart'
  | 'rollback'
  | 'suspend'
  | 'unsuspend'
  | 'policy-disable'
  | 'policy-enable'
  | 'query'
  | 'sync';

export interface AuditRecord {
  id: string;
  actor: string;
  role: PlatformRole;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  result: 'success' | 'failure';
  reason?: string;
  requestId?: string;
  timestamp: string;
}

const auditStore: AuditRecord[] = [];

function createAuditId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `audit_${Date.now()}_${random}`;
}

export function assertWritePermission(
  actor: { username?: string; role?: PlatformRole } | undefined,
): void {
  const role = actor?.role;
  if (!role || role === 'read-only') {
    throw new ForbiddenException('当前角色无写权限');
  }
}

export function appendAudit(
  record: Omit<AuditRecord, 'id' | 'timestamp'>,
): AuditRecord {
  const next: AuditRecord = {
    ...record,
    id: createAuditId(),
    timestamp: new Date().toISOString(),
  };
  auditStore.unshift(next);
  return next;
}

export function listAudits(filters: {
  action?: string;
  resourceType?: string;
  actor?: string;
  result?: string;
  requestId?: string;
  page?: number;
  pageSize?: number;
}): {
  items: AuditRecord[];
  total: number;
  page: number;
  pageSize: number;
} {
  const page =
    Number.isInteger(filters.page) && (filters.page as number) > 0
      ? (filters.page as number)
      : 1;
  const pageSize =
    Number.isInteger(filters.pageSize) && (filters.pageSize as number) > 0
      ? (filters.pageSize as number)
      : 20;

  const filtered = auditStore.filter((item) => {
    if (filters.action && item.action !== filters.action) return false;
    if (filters.resourceType && item.resourceType !== filters.resourceType)
      return false;
    if (filters.actor && item.actor !== filters.actor) return false;
    if (filters.result && item.result !== filters.result) return false;
    if (filters.requestId && item.requestId !== filters.requestId) return false;
    return true;
  });

  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}
