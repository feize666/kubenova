import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  appendAudit,
  assertWritePermission,
  listAudits,
  type AuditRecord,
  type PlatformRole,
} from '../common/governance';
import type {
  CreateRbacRequest,
  RbacListQuery,
  UpdateRbacRequest,
  UsersRbacResponse,
} from '../users/users.service';
import { UsersService } from '../users/users.service';

type ResourceState = 'active' | 'disabled';

interface Actor {
  username?: string;
  role?: PlatformRole;
}

interface SecurityRiskItem {
  id: string;
  name: string;
  resource: string;
  level: '高' | '中' | '低';
  owner: string;
  status: string;
  namespace: string;
}

export type EventSeverity = 'critical' | 'high' | 'medium' | 'low';
export type EventStatus = 'open' | 'resolved';

export interface SecurityEvent {
  id: string;
  severity: EventSeverity;
  title: string;
  type: string;
  resourceName: string;
  cluster: string;
  namespace?: string | null;
  occurredAt: string;
  status: EventStatus;
  resolvedAt?: string;
}

export interface SecurityEventsResponse {
  items: SecurityEvent[];
  total: number;
  timestamp: string;
}

export interface SecurityStatsResponse {
  criticalVulnerabilities: number;
  openEvents: number;
  complianceScore: number;
  todayAuditLogs: number;
  timestamp: string;
}

export interface AuditLogsResponse {
  items: AuditRecord[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

export interface AuditPolicyItem {
  id: string;
  name: string;
  scope: 'global' | 'namespace';
  retentionDays: number;
  description?: string;
  state: ResourceState;
  version: number;
  updatedAt: string;
}

export interface CreateAuditPolicyRequest {
  name: string;
  scope: 'global' | 'namespace';
  retentionDays: number;
  description?: string;
}

export interface UpdateAuditPolicyRequest {
  name?: string;
  scope?: 'global' | 'namespace';
  retentionDays?: number;
  description?: string;
}

export interface SecuritySummaryResponse {
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  items: SecurityRiskItem[];
  timestamp: string;
}

export interface SecurityAuditPoliciesResponse {
  items: AuditPolicyItem[];
  total: number;
  timestamp: string;
}

export interface SecurityCreateRbacRequest extends CreateRbacRequest {
  subjectRef?: {
    kind?: 'User' | 'Group' | 'ServiceAccount';
    name?: string;
    namespace?: string;
  };
}

export interface SecurityUpdateRbacRequest extends UpdateRbacRequest {
  subjectRef?: {
    kind?: 'User' | 'Group' | 'ServiceAccount';
    name?: string;
    namespace?: string;
  };
}

const MOCK_SECURITY_RISKS: SecurityRiskItem[] = [
  {
    id: 'risk-001',
    name: '镜像高危漏洞',
    resource: 'checkout:v2.1.0',
    level: '高',
    owner: '安全组',
    status: '告警',
    namespace: 'prod',
  },
  {
    id: 'risk-002',
    name: '特权容器',
    resource: 'ops-toolbox',
    level: '中',
    owner: '运维组',
    status: '待处理',
    namespace: 'ops',
  },
  {
    id: 'risk-003',
    name: '弱口令账号',
    resource: 'admin-user',
    level: '高',
    owner: '平台组',
    status: '告警',
    namespace: 'platform',
  },
];

const MOCK_SECURITY_EVENTS: SecurityEvent[] = [
  {
    id: 'evt-001',
    severity: 'critical',
    title: '镜像存在高危 CVE 漏洞',
    type: 'VulnerabilityScan',
    resourceName: 'checkout:v2.1.0',
    cluster: 'prod-cluster',
    namespace: 'prod',
    occurredAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    status: 'open',
  },
  {
    id: 'evt-002',
    severity: 'high',
    title: '特权容器检测到异常权限',
    type: 'PrivilegeEscalation',
    resourceName: 'ops-toolbox',
    cluster: 'ops-cluster',
    namespace: 'ops',
    occurredAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    status: 'open',
  },
  {
    id: 'evt-003',
    severity: 'high',
    title: '弱口令账号被登录',
    type: 'AuthenticationFailure',
    resourceName: 'admin-user',
    cluster: 'platform-cluster',
    namespace: 'platform',
    occurredAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    status: 'open',
  },
  {
    id: 'evt-004',
    severity: 'medium',
    title: 'NetworkPolicy 缺失导致流量暴露',
    type: 'NetworkPolicyViolation',
    resourceName: 'frontend-svc',
    cluster: 'prod-cluster',
    namespace: 'prod',
    occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    status: 'resolved',
    resolvedAt: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-005',
    severity: 'low',
    title: 'Pod 安全策略宽松',
    type: 'PolicyViolation',
    resourceName: 'batch-worker',
    cluster: 'staging-cluster',
    namespace: 'staging',
    occurredAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    status: 'resolved',
    resolvedAt: new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-006',
    severity: 'critical',
    title: 'Secret 明文存储于 ConfigMap',
    type: 'SecretExposure',
    resourceName: 'app-config',
    cluster: 'prod-cluster',
    namespace: 'prod',
    occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    status: 'open',
  },
  {
    id: 'evt-007',
    severity: 'medium',
    title: 'RBAC 权限过度授予',
    type: 'RBACViolation',
    resourceName: 'dev-serviceaccount',
    cluster: 'dev-cluster',
    namespace: 'dev',
    occurredAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    status: 'open',
  },
];

@Injectable()
export class SecurityService {
  private readonly auditPolicies: AuditPolicyItem[] = [
    {
      id: 'ap-001',
      name: '默认审计策略',
      scope: 'global',
      retentionDays: 90,
      description: '审计关键写操作并保留 90 天',
      state: 'active',
      version: 1,
      updatedAt: new Date().toISOString(),
    },
  ];

  private readonly events: SecurityEvent[] = [...MOCK_SECURITY_EVENTS];

  constructor(private readonly usersService: UsersService) {}

  async listRbac(query: RbacListQuery): Promise<UsersRbacResponse> {
    return this.usersService.listRbac(query);
  }

  createRbac(actor: Actor | undefined, body: SecurityCreateRbacRequest) {
    return this.usersService.createRbac(actor, body);
  }

  updateRbac(
    actor: Actor | undefined,
    id: string,
    body: SecurityUpdateRbacRequest,
  ) {
    return this.usersService.updateRbac(actor, id, body);
  }

  deleteRbac(actor: Actor | undefined, id: string) {
    return this.usersService.deleteRbac(actor, id);
  }

  setRbacState(actor: Actor | undefined, id: string, nextState: ResourceState) {
    return this.usersService.setRbacState(actor, id, nextState);
  }

  getSummary(): SecuritySummaryResponse {
    const high = MOCK_SECURITY_RISKS.filter(
      (item) => item.level === '高',
    ).length;
    const medium = MOCK_SECURITY_RISKS.filter(
      (item) => item.level === '中',
    ).length;
    const low = MOCK_SECURITY_RISKS.filter(
      (item) => item.level === '低',
    ).length;

    return {
      summary: {
        total: MOCK_SECURITY_RISKS.length,
        high,
        medium,
        low,
      },
      items: MOCK_SECURITY_RISKS,
      timestamp: new Date().toISOString(),
    };
  }

  getStats(): SecurityStatsResponse {
    const criticalVulnerabilities = this.events.filter(
      (e) => e.severity === 'critical' && e.status === 'open',
    ).length;
    const openEvents = this.events.filter((e) => e.status === 'open').length;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const auditResult = listAudits({});
    const todayAuditLogs = auditResult.items.filter(
      (a) => new Date(a.timestamp) >= todayStart,
    ).length;

    return {
      criticalVulnerabilities,
      openEvents,
      complianceScore: 87,
      todayAuditLogs,
      timestamp: new Date().toISOString(),
    };
  }

  getEvents(filters: {
    severity?: string;
    status?: string;
    clusterId?: string;
    namespace?: string;
    page?: number;
    pageSize?: number;
  }): SecurityEventsResponse {
    const page =
      Number.isInteger(filters.page) && (filters.page as number) > 0
        ? (filters.page as number)
        : 1;
    const pageSize =
      Number.isInteger(filters.pageSize) && (filters.pageSize as number) > 0
        ? (filters.pageSize as number)
        : 20;

    let filtered = this.events;
    if (filters.severity) {
      filtered = filtered.filter((e) => e.severity === filters.severity);
    }
    if (filters.status) {
      filtered = filtered.filter((e) => e.status === filters.status);
    }
    if (filters.clusterId) {
      filtered = filtered.filter((e) => e.cluster === filters.clusterId);
    }
    if (filters.namespace) {
      filtered = filtered.filter(
        (e) => (e.namespace ?? '') === filters.namespace,
      );
    }

    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      timestamp: new Date().toISOString(),
    };
  }

  resolveEvent(actor: Actor | undefined, id: string): SecurityEvent {
    const event = this.events.find((e) => e.id === id);
    if (!event) {
      throw new NotFoundException('安全事件不存在');
    }
    if (event.status === 'resolved') {
      return event;
    }
    event.status = 'resolved';
    event.resolvedAt = new Date().toISOString();
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'update',
      resourceType: 'security-events',
      resourceId: id,
      result: 'success',
    });
    return event;
  }

  getAuditLogs(filters: {
    action?: string;
    resourceType?: string;
    actor?: string;
    result?: string;
    page?: number;
    pageSize?: number;
  }): AuditLogsResponse {
    const result = listAudits(filters);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  listAuditPolicies(): SecurityAuditPoliciesResponse {
    return {
      items: this.auditPolicies,
      total: this.auditPolicies.length,
      timestamp: new Date().toISOString(),
    };
  }

  createAuditPolicy(
    actor: Actor | undefined,
    body: CreateAuditPolicyRequest,
  ): AuditPolicyItem {
    assertWritePermission(actor);
    const name = body?.name?.trim();

    if (!name) {
      throw new BadRequestException('name 不能为空');
    }
    if (body.scope !== 'global' && body.scope !== 'namespace') {
      throw new BadRequestException('scope 仅支持 global 或 namespace');
    }
    if (!Number.isInteger(body.retentionDays) || body.retentionDays <= 0) {
      throw new BadRequestException('retentionDays 必须为正整数');
    }

    const created: AuditPolicyItem = {
      id: `ap-${Date.now()}`,
      name,
      scope: body.scope,
      retentionDays: body.retentionDays,
      description: body.description?.trim(),
      state: 'active',
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    this.auditPolicies.unshift(created);
    this.audit(actor, 'create', created.id);
    return created;
  }

  updateAuditPolicy(
    actor: Actor | undefined,
    id: string,
    body: UpdateAuditPolicyRequest,
  ): AuditPolicyItem {
    assertWritePermission(actor);
    const item = this.findPolicy(id);

    if (body.name !== undefined) {
      const nextName = body.name.trim();
      if (!nextName) {
        throw new BadRequestException('name 不能为空');
      }
      item.name = nextName;
    }
    if (body.scope !== undefined) {
      if (body.scope !== 'global' && body.scope !== 'namespace') {
        throw new BadRequestException('scope 仅支持 global 或 namespace');
      }
      item.scope = body.scope;
    }
    if (body.retentionDays !== undefined) {
      if (!Number.isInteger(body.retentionDays) || body.retentionDays <= 0) {
        throw new BadRequestException('retentionDays 必须为正整数');
      }
      item.retentionDays = body.retentionDays;
    }
    if (body.description !== undefined) {
      item.description = body.description.trim() || undefined;
    }

    item.version += 1;
    item.updatedAt = new Date().toISOString();
    this.audit(actor, 'update', item.id);
    return item;
  }

  deleteAuditPolicy(
    actor: Actor | undefined,
    id: string,
  ): { id: string; deleted: true; state: 'deleted'; version: number } {
    assertWritePermission(actor);
    const index = this.findPolicyIndex(id);
    const removed = this.auditPolicies[index];
    this.auditPolicies.splice(index, 1);
    this.audit(actor, 'delete', removed.id);

    return {
      id: removed.id,
      deleted: true,
      state: 'deleted',
      version: removed.version + 1,
    };
  }

  setAuditPolicyState(
    actor: Actor | undefined,
    id: string,
    state: ResourceState,
  ): AuditPolicyItem {
    assertWritePermission(actor);
    const item = this.findPolicy(id);
    item.state = state;
    item.version += 1;
    item.updatedAt = new Date().toISOString();
    this.audit(actor, state === 'active' ? 'enable' : 'disable', item.id);
    return item;
  }

  private findPolicy(id: string): AuditPolicyItem {
    const item = this.auditPolicies.find((candidate) => candidate.id === id);
    if (!item) {
      throw new NotFoundException('审计策略不存在');
    }
    return item;
  }

  private findPolicyIndex(id: string): number {
    const index = this.auditPolicies.findIndex(
      (candidate) => candidate.id === id,
    );
    if (index === -1) {
      throw new NotFoundException('审计策略不存在');
    }
    return index;
  }

  private audit(
    actor: Actor | undefined,
    action: 'create' | 'update' | 'delete' | 'enable' | 'disable',
    resourceId: string,
  ): void {
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action,
      resourceType: 'audit-policies',
      resourceId,
      result: 'success',
    });
  }
}
