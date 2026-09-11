import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  appendAudit,
  assertWritePermission,
  type PlatformRole,
} from '../common/governance';
import { PrismaService } from '../platform/database/prisma.service';

export const OBSERVABILITY_KINDS = [
  'prometheus',
  'grafana',
  'alertmanager',
  'elasticsearch',
  'kibana',
] as const;
export type ObservabilityKind = (typeof OBSERVABILITY_KINDS)[number];
export type ObservabilityStatus =
  | 'unknown'
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'disabled';
export const NOTIFICATION_CHANNELS = [
  'feishu',
  'dingtalk',
  'wecom',
  'email',
  'webhook',
  'slack',
  'pagerduty',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
type Severity = 'critical' | 'warning' | 'info';

export interface ObservabilityActor {
  username?: string;
  role?: PlatformRole;
}

export interface DataSourceInput {
  clusterId?: string;
  kind: ObservabilityKind;
  name: string;
  endpoint: string;
  secretRef?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DataSourceView extends DataSourceInput {
  id: string;
  status: ObservabilityStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceHealthResult {
  id: string;
  status: ObservabilityStatus;
  latencyMs: number | null;
  checkedAt: string;
  error: string | null;
}
type ProbeResult = Omit<SourceHealthResult, 'id' | 'checkedAt'>;

export interface AlertTemplateInput {
  name: string;
  severity: Severity;
  expression: string;
  duration?: string;
  enabled?: boolean;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface AlertTemplateView extends AlertTemplateInput {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplateInput {
  name: string;
  channel: NotificationChannel;
  endpoint: string;
  secretRef?: string;
  bodyTemplate: string;
  enabled?: boolean;
}

export interface NotificationTemplateView extends NotificationTemplateInput {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_SOURCE_ENV: Record<ObservabilityKind, string> = {
  prometheus: 'OBSERVABILITY_PROMETHEUS_URL',
  grafana: 'OBSERVABILITY_GRAFANA_URL',
  alertmanager: 'OBSERVABILITY_ALERTMANAGER_URL',
  elasticsearch: 'OBSERVABILITY_ELASTICSEARCH_URL',
  kibana: 'OBSERVABILITY_KIBANA_URL',
};

const PROBE_PATHS: Record<ObservabilityKind, string> = {
  prometheus: '/-/ready',
  grafana: '/api/health',
  alertmanager: '/-/ready',
  elasticsearch: '/_cluster/health',
  kibana: '/api/status',
};

@Injectable()
export class ObservabilityService {
  private readonly probeTimeoutMs = 2_000;

  constructor(private readonly prisma: PrismaService) {}

  async listDataSources(clusterId?: string): Promise<{
    items: DataSourceView[];
    total: number;
    timestamp: string;
  }> {
    const normalizedClusterId = this.normalizeOptional(clusterId);
    const records = await this.prisma.monitoringDataSource.findMany({
      where: normalizedClusterId
        ? { OR: [{ clusterId: normalizedClusterId }, { clusterId: null }] }
        : {},
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    const configuredKinds = new Set(records.map((record) => record.kind));
    const defaults = Object.entries(DEFAULT_SOURCE_ENV)
      .map(([kind, envName]) => {
        const endpoint = process.env[envName];
        if (!endpoint || configuredKinds.has(kind)) return null;
        return this.defaultDataSource(kind as ObservabilityKind, endpoint);
      })
      .filter((item): item is DataSourceView => Boolean(item));
    const items = [...records.map((record) => this.toDataSourceView(record)), ...defaults];
    return { items, total: items.length, timestamp: new Date().toISOString() };
  }

  async getDataSourceScope(id: string): Promise<{ clusterId: string | null } | null> {
    return this.prisma.monitoringDataSource.findUnique({
      where: { id },
      select: { clusterId: true },
    });
  }

  async createDataSource(
    actor: ObservabilityActor | undefined,
    input: DataSourceInput,
  ): Promise<DataSourceView> {
    assertWritePermission(actor);
    const data = this.validateDataSource(input);
    const created = await this.prisma.monitoringDataSource.create({ data });
    this.audit(actor, 'create', created.id, created.clusterId);
    return this.toDataSourceView(created);
  }

  async updateDataSource(
    actor: ObservabilityActor | undefined,
    id: string,
    input: Partial<DataSourceInput>,
  ): Promise<DataSourceView> {
    assertWritePermission(actor);
    const existing = await this.prisma.monitoringDataSource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('可观测性数据源不存在');
    const patch: Prisma.MonitoringDataSourceUpdateInput = {};
    if (input.name !== undefined) patch.name = this.requiredText(input.name, 'name');
    if (input.endpoint !== undefined) patch.endpoint = this.validEndpoint(input.endpoint);
    if (input.kind !== undefined) patch.kind = this.validKind(input.kind);
    if (input.clusterId !== undefined) {
      patch.cluster = input.clusterId?.trim()
        ? { connect: { id: input.clusterId.trim() } }
        : { disconnect: true };
    }
    if (input.secretRef !== undefined) patch.secretRef = this.normalizeOptional(input.secretRef);
    if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
    if (input.metadata !== undefined) patch.metadata = input.metadata as Prisma.InputJsonValue;
    const updated = await this.prisma.monitoringDataSource.update({ where: { id }, data: patch });
    this.audit(actor, 'update', id, updated.clusterId);
    return this.toDataSourceView(updated);
  }

  async deleteDataSource(actor: ObservabilityActor | undefined, id: string): Promise<{ id: string; deleted: true }> {
    assertWritePermission(actor);
    const existing = await this.prisma.monitoringDataSource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('可观测性数据源不存在');
    await this.prisma.monitoringDataSource.delete({ where: { id } });
    this.audit(actor, 'delete', id, existing.clusterId);
    return { id, deleted: true };
  }

  async testDataSource(id: string): Promise<SourceHealthResult> {
    const existing = await this.prisma.monitoringDataSource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('可观测性数据源不存在');
    return this.probeAndPersist(existing);
  }

  async testEndpoint(kind: ObservabilityKind, endpoint: string): Promise<ProbeResult> {
    const validatedKind = this.validKind(kind);
    const url = this.validEndpoint(endpoint);
    return this.probe(validatedKind, url);
  }

  async listAlertTemplates(): Promise<{ items: AlertTemplateView[]; total: number; timestamp: string }> {
    const items = await this.prisma.monitoringAlertTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
    return { items: items.map((item) => this.toAlertTemplateView(item)), total: items.length, timestamp: new Date().toISOString() };
  }

  async createAlertTemplate(actor: ObservabilityActor | undefined, input: AlertTemplateInput): Promise<AlertTemplateView> {
    assertWritePermission(actor);
    const data = this.validateAlertTemplate(input);
    const created = await this.prisma.monitoringAlertTemplate.create({ data });
    this.audit(actor, 'create', created.id);
    return this.toAlertTemplateView(created);
  }

  async updateAlertTemplate(actor: ObservabilityActor | undefined, id: string, input: Partial<AlertTemplateInput>): Promise<AlertTemplateView> {
    assertWritePermission(actor);
    const existing = await this.prisma.monitoringAlertTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('告警模板不存在');
    const data: Prisma.MonitoringAlertTemplateUpdateInput = {};
    if (input.name !== undefined) data.name = this.requiredText(input.name, 'name');
    if (input.severity !== undefined) data.severity = this.validSeverity(input.severity);
    if (input.expression !== undefined) data.expression = this.requiredText(input.expression, 'expression');
    if (input.duration !== undefined) data.duration = this.requiredText(input.duration, 'duration');
    if (input.enabled !== undefined) data.enabled = Boolean(input.enabled);
    if (input.labels !== undefined) data.labels = input.labels as Prisma.InputJsonValue;
    if (input.annotations !== undefined) data.annotations = input.annotations as Prisma.InputJsonValue;
    data.version = { increment: 1 };
    const updated = await this.prisma.monitoringAlertTemplate.update({ where: { id }, data });
    this.audit(actor, 'update', id);
    return this.toAlertTemplateView(updated);
  }

  async deleteAlertTemplate(actor: ObservabilityActor | undefined, id: string): Promise<{ id: string; deleted: true }> {
    assertWritePermission(actor);
    await this.requireById('monitoringAlertTemplate', id, '告警模板不存在');
    await this.prisma.monitoringAlertTemplate.delete({ where: { id } });
    this.audit(actor, 'delete', id);
    return { id, deleted: true };
  }

  async listNotificationTemplates(): Promise<{ items: NotificationTemplateView[]; total: number; timestamp: string }> {
    const items = await this.prisma.monitoringNotificationTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
    return { items: items.map((item) => this.toNotificationTemplateView(item)), total: items.length, timestamp: new Date().toISOString() };
  }

  async createNotificationTemplate(actor: ObservabilityActor | undefined, input: NotificationTemplateInput): Promise<NotificationTemplateView> {
    assertWritePermission(actor);
    const data = this.validateNotificationTemplate(input);
    const created = await this.prisma.monitoringNotificationTemplate.create({ data });
    this.audit(actor, 'create', created.id);
    return this.toNotificationTemplateView(created);
  }

  async updateNotificationTemplate(actor: ObservabilityActor | undefined, id: string, input: Partial<NotificationTemplateInput>): Promise<NotificationTemplateView> {
    assertWritePermission(actor);
    const existing = await this.prisma.monitoringNotificationTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('通知模板不存在');
    const data: Prisma.MonitoringNotificationTemplateUpdateInput = {};
    if (input.name !== undefined) data.name = this.requiredText(input.name, 'name');
    if (input.channel !== undefined) data.channel = this.validChannel(input.channel);
    if (input.endpoint !== undefined) data.endpoint = this.validEndpoint(input.endpoint);
    if (input.secretRef !== undefined) data.secretRef = this.normalizeOptional(input.secretRef);
    if (input.bodyTemplate !== undefined) data.bodyTemplate = this.requiredText(input.bodyTemplate, 'bodyTemplate');
    if (input.enabled !== undefined) data.enabled = Boolean(input.enabled);
    data.version = { increment: 1 };
    const updated = await this.prisma.monitoringNotificationTemplate.update({ where: { id }, data });
    this.audit(actor, 'update', id);
    return this.toNotificationTemplateView(updated);
  }

  async deleteNotificationTemplate(actor: ObservabilityActor | undefined, id: string): Promise<{ id: string; deleted: true }> {
    assertWritePermission(actor);
    await this.requireById('monitoringNotificationTemplate', id, '通知模板不存在');
    await this.prisma.monitoringNotificationTemplate.delete({ where: { id } });
    this.audit(actor, 'delete', id);
    return { id, deleted: true };
  }

  private async probeAndPersist(record: any): Promise<SourceHealthResult> {
    const checkedAt = new Date();
    const result = await this.probe(this.validKind(record.kind), record.endpoint);
    await this.prisma.monitoringDataSource.update({
      where: { id: record.id },
      data: { status: result.status, lastCheckedAt: checkedAt, lastError: result.error },
    });
    return { id: record.id, ...result, checkedAt: checkedAt.toISOString() };
  }

  private async probe(kind: ObservabilityKind, endpoint: string): Promise<ProbeResult> {
    const started = Date.now();
    const probeUrl = new URL(PROBE_PATHS[kind], endpoint.endsWith('/') ? endpoint : `${endpoint}/`).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    try {
      const response = await fetch(probeUrl, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json' } });
      const status: ObservabilityStatus = response.ok ? 'healthy' : response.status >= 500 ? 'degraded' : 'unavailable';
      return { status, latencyMs: Date.now() - started, error: response.ok ? null : `HTTP ${response.status}` };
    } catch (error) {
      return { status: 'unavailable', latencyMs: Date.now() - started, error: this.safeError(error) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private defaultDataSource(kind: ObservabilityKind, endpoint: string): DataSourceView {
    const now = new Date().toISOString();
    return { id: `env-${kind}`, clusterId: undefined, kind, name: `default-${kind}`, endpoint, enabled: true, status: 'unknown', secretRef: undefined, metadata: undefined, lastCheckedAt: null, lastError: null, createdAt: now, updatedAt: now };
  }

  private toDataSourceView(record: any): DataSourceView {
    return { id: record.id, clusterId: record.clusterId ?? undefined, kind: this.validKind(record.kind), name: record.name, endpoint: record.endpoint, secretRef: record.secretRef ?? undefined, enabled: record.enabled, status: this.validStatus(record.status), metadata: this.asRecord(record.metadata), lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null, lastError: record.lastError ?? null, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
  }

  private toAlertTemplateView(record: any): AlertTemplateView {
    return { id: record.id, name: record.name, severity: this.validSeverity(record.severity), expression: record.expression, duration: record.duration, enabled: record.enabled, labels: this.asStringMap(record.labels), annotations: this.asStringMap(record.annotations), version: record.version, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
  }

  private toNotificationTemplateView(record: any): NotificationTemplateView {
    return { id: record.id, name: record.name, channel: this.validChannel(record.channel), endpoint: record.endpoint, secretRef: record.secretRef ?? undefined, bodyTemplate: record.bodyTemplate, enabled: record.enabled, version: record.version, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
  }

  private validateDataSource(input: DataSourceInput): Prisma.MonitoringDataSourceCreateInput {
    return { kind: this.validKind(input.kind), name: this.requiredText(input.name, 'name'), endpoint: this.validEndpoint(input.endpoint), cluster: input.clusterId?.trim() ? { connect: { id: input.clusterId.trim() } } : undefined, secretRef: this.normalizeOptional(input.secretRef), enabled: input.enabled ?? true, metadata: input.metadata as Prisma.InputJsonValue | undefined };
  }

  private validateAlertTemplate(input: AlertTemplateInput): Prisma.MonitoringAlertTemplateCreateInput {
    return { name: this.requiredText(input.name, 'name'), severity: this.validSeverity(input.severity), expression: this.requiredText(input.expression, 'expression'), duration: input.duration ? this.requiredText(input.duration, 'duration') : '5m', enabled: input.enabled ?? true, labels: input.labels as Prisma.InputJsonValue | undefined, annotations: input.annotations as Prisma.InputJsonValue | undefined };
  }

  private validateNotificationTemplate(input: NotificationTemplateInput): Prisma.MonitoringNotificationTemplateCreateInput {
    return { name: this.requiredText(input.name, 'name'), channel: this.validChannel(input.channel), endpoint: this.validEndpoint(input.endpoint), secretRef: this.normalizeOptional(input.secretRef), bodyTemplate: this.requiredText(input.bodyTemplate, 'bodyTemplate'), enabled: input.enabled ?? true };
  }

  private async requireById(model: 'monitoringAlertTemplate' | 'monitoringNotificationTemplate', id: string, message: string): Promise<void> {
    const exists = await (model === 'monitoringAlertTemplate' ? this.prisma.monitoringAlertTemplate.findUnique({ where: { id } }) : this.prisma.monitoringNotificationTemplate.findUnique({ where: { id } }));
    if (!exists) throw new NotFoundException(message);
  }

  private validKind(value: string): ObservabilityKind { if ((OBSERVABILITY_KINDS as readonly string[]).includes(value)) return value as ObservabilityKind; throw new BadRequestException('kind 不受支持'); }
  private validSeverity(value: string): Severity { if (value === 'critical' || value === 'warning' || value === 'info') return value; throw new BadRequestException('severity 仅支持 critical/warning/info'); }
  private validChannel(value: string): NotificationChannel { if ((NOTIFICATION_CHANNELS as readonly string[]).includes(value)) return value as NotificationChannel; throw new BadRequestException('channel 不受支持'); }
  private validStatus(value: string): ObservabilityStatus { return ['unknown', 'healthy', 'degraded', 'unavailable', 'disabled'].includes(value) ? value as ObservabilityStatus : 'unknown'; }
  private requiredText(value: string, field: string): string { const text = value?.trim(); if (!text) throw new BadRequestException(`${field} 不能为空`); return text; }
  private validEndpoint(value: string): string { const text = this.requiredText(value, 'endpoint'); let parsed: URL; try { parsed = new URL(text); } catch { throw new BadRequestException('endpoint 必须是合法 URL'); } if (!['http:', 'https:'].includes(parsed.protocol)) throw new BadRequestException('endpoint 仅支持 HTTP/HTTPS'); return text.replace(/\/$/, ''); }
  private normalizeOptional(value?: string): string | undefined { const text = value?.trim(); return text || undefined; }
  private asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
  private asStringMap(value: unknown): Record<string, string> | undefined { const record = this.asRecord(value); if (!record) return undefined; return Object.fromEntries(Object.entries(record).filter(([, item]) => typeof item === 'string')) as Record<string, string>; }
  private safeError(error: unknown): string { if (error instanceof Error && error.name === 'AbortError') return '探针超时'; return error instanceof Error ? error.message.slice(0, 240) : '连接失败'; }
  private audit(actor: ObservabilityActor | undefined, action: 'create' | 'update' | 'delete', resourceId: string, _clusterId?: string | null): void { appendAudit({ actor: actor?.username ?? 'unknown', role: actor?.role ?? 'read-only', action, resourceType: 'observability', resourceId, result: 'success' }); }
}
