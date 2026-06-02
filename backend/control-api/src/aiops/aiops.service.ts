import { Injectable } from '@nestjs/common';
import {
  appendAudit,
  assertWritePermission,
  type AuditRecord,
  type PlatformRole,
} from '../common/governance';
import type { MonitoringRange } from '../monitoring/monitoring.service';
import { MonitoringService } from '../monitoring/monitoring.service';

export interface AiopsTimeFilter {
  range?: MonitoringRange;
  from?: Date;
  to?: Date;
}

export interface AiopsIncidentItem {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'open' | 'investigating' | 'mitigated';
  affectedScope: string;
  confidence: number;
  startedAt: string;
  evidenceCount: number;
  topologyImpact: string;
  source: 'alert' | 'inspection' | 'derived';
}

export interface AiopsRecommendationItem {
  id: string;
  incidentId: string;
  type: 'diagnosis' | 'runbook' | 'safe-action';
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
  expectedResult: string;
  rollbackHint: string;
  approvalRequired: boolean;
  precheckStatus: 'not-required' | 'pending';
}

export interface AiopsActionActor {
  username?: string;
  role?: PlatformRole;
}

export interface AiopsRecommendationPrecheckResponse {
  recommendationId: string;
  incidentId: string;
  status: 'passed' | 'blocked';
  checks: Array<{
    key: string;
    label: string;
    status: 'passed' | 'blocked';
    message: string;
  }>;
  approvalRequired: boolean;
  audit?: AuditRecord;
  rollbackHint: string;
  timestamp: string;
}

export interface AiopsRecommendationApprovalResponse {
  recommendationId: string;
  incidentId: string;
  approved: boolean;
  executionStatus: 'not-executed';
  audit: AuditRecord;
  message: string;
  rollbackHint: string;
  timestamp: string;
}

export interface AiopsSummaryResponse {
  range: MonitoringRange;
  timestamp: string;
  anomalyOverview: {
    total: number;
    critical: number;
    warning: number;
    source: 'monitoring-alert' | 'workload-derived' | 'mixed';
    degraded: boolean;
  };
  incidentQueue: AiopsIncidentItem[];
  correlationGroups: Array<{
    id: string;
    title: string;
    severity: 'critical' | 'warning' | 'info';
    incidentCount: number;
    affectedScopes: string[];
    evidence: string[];
  }>;
  topImpactedServices: Array<{
    key: string;
    label: string;
    severity: 'critical' | 'warning' | 'info';
    incidentCount: number;
  }>;
  rootCauseCandidates: Array<{
    incidentId: string;
    title: string;
    confidence: number;
    evidence: string[];
    modelType: 'rule' | 'statistical' | 'generated';
    humanState: 'unreviewed' | 'confirmed' | 'rejected';
  }>;
  recommendations: AiopsRecommendationItem[];
  auditState: {
    readOnly: boolean;
    approvalRequiredForMutations: boolean;
    auditTrailReady: boolean;
  };
  degraded: boolean;
  note?: string;
}

@Injectable()
export class AiopsService {
  constructor(private readonly monitoringService: MonitoringService) {}

  async getSummary(timeFilter: AiopsTimeFilter): Promise<AiopsSummaryResponse> {
    const [observability, alerts, inspection] = await Promise.all([
      this.monitoringService.getObservabilitySummary(timeFilter),
      this.monitoringService.getAlerts({
        page: 1,
        pageSize: 20,
        status: 'firing',
        range: timeFilter.range,
        from: timeFilter.from,
        to: timeFilter.to,
      }),
      this.monitoringService.getClusterInspection(
        undefined,
        undefined,
        timeFilter,
      ),
    ]);
    const incidentsFromAlerts: AiopsIncidentItem[] = alerts.items.map(
      (alert) => ({
        id: `alert:${alert.id}`,
        title: alert.title,
        severity:
          alert.severity === 'critical'
            ? 'critical'
            : alert.severity === 'warning'
              ? 'warning'
              : 'info',
        status: 'open',
        affectedScope: [
          alert.clusterId ?? 'cluster',
          alert.namespace ?? '-',
          alert.resourceType ?? 'Resource',
          alert.resourceName ?? '-',
        ].join('/'),
        confidence: alert.severity === 'critical' ? 86 : 72,
        startedAt: alert.firedAt,
        evidenceCount: 2,
        topologyImpact: alert.resourceType
          ? `${alert.resourceType}/${alert.resourceName ?? '-'}`
          : '待关联资源',
        source: alerts.dataSource === 'monitoring-alert' ? 'alert' : 'derived',
      }),
    );
    const incidentsFromInspection: AiopsIncidentItem[] = inspection.items
      .slice(0, Math.max(0, 12 - incidentsFromAlerts.length))
      .map((issue) => ({
        id: `inspection:${issue.id}`,
        title: issue.title,
        severity: issue.severity,
        status: 'investigating',
        affectedScope: issue.resourceRef,
        confidence: issue.severity === 'critical' ? 78 : 62,
        startedAt: inspection.timestamp,
        evidenceCount: issue.evidence ? 2 : 1,
        topologyImpact: issue.resourceRef,
        source: 'inspection',
      }));
    const incidentQueue = this.ensureUniqueIncidentIds([
      ...incidentsFromAlerts,
      ...incidentsFromInspection,
    ]).slice(0, 12);
    const critical = incidentQueue.filter(
      (item) => item.severity === 'critical',
    ).length;
    const warning = incidentQueue.filter(
      (item) => item.severity === 'warning',
    ).length;
    const groups = this.buildCorrelationGroups(incidentQueue);
    const recommendations = incidentQueue.slice(0, 6).map((incident) =>
      this.buildRecommendation(incident),
    );

    return {
      range: observability.range,
      timestamp: new Date().toISOString(),
      anomalyOverview: {
        total: incidentQueue.length,
        critical,
        warning,
        source: observability.activeAlerts.degraded
          ? 'workload-derived'
          : 'monitoring-alert',
        degraded: observability.degraded || alerts.degraded,
      },
      incidentQueue,
      correlationGroups: groups,
      topImpactedServices: groups.slice(0, 5).map((group) => ({
        key: group.id,
        label: group.title,
        severity: group.severity,
        incidentCount: group.incidentCount,
      })),
      rootCauseCandidates: incidentQueue.slice(0, 6).map((incident) => ({
        incidentId: incident.id,
        title: this.buildRootCauseTitle(incident),
        confidence: incident.confidence,
        evidence: [
          `${incident.source} 事件：${incident.title}`,
          `影响面：${incident.affectedScope}`,
        ],
        modelType: incident.source === 'alert' ? 'rule' : 'statistical',
        humanState: 'unreviewed',
      })),
      recommendations,
      auditState: {
        readOnly: true,
        approvalRequiredForMutations: true,
        auditTrailReady: true,
      },
      degraded: observability.degraded || alerts.degraded,
      note:
        observability.note ||
        (alerts.degraded
          ? 'AIOps 当前使用派生告警和巡检问题构建事故队列。'
          : undefined),
    };
  }

  private buildCorrelationGroups(incidents: AiopsIncidentItem[]) {
    const groups = new Map<string, AiopsIncidentItem[]>();
    for (const incident of incidents) {
      const key = incident.affectedScope.split('/').slice(0, 2).join('/');
      const items = groups.get(key) ?? [];
      items.push(incident);
      groups.set(key, items);
    }
    return [...groups.entries()].map(([key, items]) => ({
      id: `group:${key}`,
      title: key,
      severity: items.some((item) => item.severity === 'critical')
        ? ('critical' as const)
        : items.some((item) => item.severity === 'warning')
          ? ('warning' as const)
          : ('info' as const),
      incidentCount: items.length,
      affectedScopes: items.map((item) => item.affectedScope),
      evidence: items.slice(0, 3).map((item) => item.title),
    }));
  }

  private ensureUniqueIncidentIds(
    incidents: AiopsIncidentItem[],
  ): AiopsIncidentItem[] {
    const counts = new Map<string, number>();
    return incidents.map((incident) => {
      const nextCount = (counts.get(incident.id) ?? 0) + 1;
      counts.set(incident.id, nextCount);
      if (nextCount === 1) {
        return incident;
      }
      return {
        ...incident,
        id: `${incident.id}:${nextCount}`,
      };
    });
  }

  private buildRootCauseTitle(incident: AiopsIncidentItem): string {
    if (incident.severity === 'critical') {
      return '关键资源异常触发级联风险';
    }
    if (incident.source === 'inspection') {
      return '巡检信号显示资源配置或状态偏离';
    }
    return '告警信号显示服务健康下降';
  }

  private buildRecommendation(
    incident: AiopsIncidentItem,
  ): AiopsRecommendationItem {
    const mutable = incident.severity === 'critical';
    return {
      id: `rec:${incident.id}`,
      incidentId: incident.id,
      type: mutable ? 'safe-action' : 'runbook',
      riskLevel: mutable ? 'medium' : 'low',
      summary: mutable
        ? '先执行只读诊断与影响面确认，再准备人工审批处置。'
        : '查看关联资源详情、日志和事件，按 runbook 继续定位。',
      expectedResult: '缩小故障范围并给出可审计的下一步。',
      rollbackHint: mutable
        ? '所有变更动作必须带审批、审计记录和回滚说明。'
        : '当前建议不改变集群状态，无需回滚。',
      approvalRequired: mutable,
      precheckStatus: mutable ? 'pending' : 'not-required',
    };
  }

  async precheckRecommendation(
    recommendationId: string,
    actor?: AiopsActionActor,
  ): Promise<AiopsRecommendationPrecheckResponse> {
    const recommendation = this.parseRecommendationId(recommendationId);
    const mutable = recommendationId.includes(':alert:');
    const checks = [
      {
        key: 'identity',
        label: '推荐动作标识',
        status: recommendation ? ('passed' as const) : ('blocked' as const),
        message: recommendation
          ? '推荐动作与事故标识可解析。'
          : '推荐动作标识无效。',
      },
      {
        key: 'approval',
        label: '人工审批',
        status: mutable ? ('passed' as const) : ('passed' as const),
        message: mutable
          ? '该动作需要人工审批，precheck 不执行集群变更。'
          : '该动作为只读 runbook 建议，无需审批。',
      },
      {
        key: 'rollback',
        label: '回滚提示',
        status: 'passed' as const,
        message: mutable
          ? '执行前必须确认回滚说明和影响范围。'
          : '只读建议不改变集群状态。',
      },
    ];
    const status = checks.some((item) => item.status === 'blocked')
      ? 'blocked'
      : 'passed';
    const audit =
      recommendation && actor
        ? appendAudit({
            actor: actor.username ?? 'system',
            role: actor.role ?? 'read-only',
            action: 'query',
            resourceType: 'aiops-recommendation',
            resourceId: recommendationId,
            result: status === 'passed' ? 'success' : 'failure',
            reason: 'aiops recommendation precheck',
            requestId: recommendationId,
          })
        : undefined;

    return {
      recommendationId,
      incidentId: recommendation?.incidentId ?? '',
      status,
      checks,
      approvalRequired: mutable,
      audit,
      rollbackHint: mutable
        ? '如后续执行动作失败，按推荐动作中的 rollbackHint 恢复配置或回滚发布。'
        : '当前只读建议无需回滚。',
      timestamp: new Date().toISOString(),
    };
  }

  async approveRecommendation(
    recommendationId: string,
    actor?: AiopsActionActor,
  ): Promise<AiopsRecommendationApprovalResponse> {
    assertWritePermission(actor);
    const recommendation = this.parseRecommendationId(recommendationId);
    const audit = appendAudit({
      actor: actor?.username ?? 'system',
      role: actor?.role ?? 'read-only',
      action: 'sync',
      resourceType: 'aiops-recommendation',
      resourceId: recommendationId,
      result: recommendation ? 'success' : 'failure',
      reason:
        'aiops recommendation approved; execution intentionally not performed by this endpoint',
      requestId: recommendationId,
    });

    return {
      recommendationId,
      incidentId: recommendation?.incidentId ?? '',
      approved: Boolean(recommendation),
      executionStatus: 'not-executed',
      audit,
      message: recommendation
        ? '审批已记录。该端点只登记审批和审计，不执行集群变更。'
        : '推荐动作标识无效，审批未执行。',
      rollbackHint:
        '真实变更执行前必须通过独立执行端点再次确认 precheck、影响范围和回滚路径。',
      timestamp: new Date().toISOString(),
    };
  }

  private parseRecommendationId(
    recommendationId: string,
  ): { incidentId: string } | null {
    const normalized = recommendationId.trim();
    if (!normalized.startsWith('rec:')) {
      return null;
    }
    const incidentId = normalized.slice('rec:'.length);
    if (!incidentId) {
      return null;
    }
    return { incidentId };
  }
}
