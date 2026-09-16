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
export type GrafanaPanelTimeRange = '15m' | '1h' | '6h' | '24h' | '7d';
export type GrafanaPanelTheme = 'light' | 'dark' | 'auto';

/** Only non-sensitive dashboard presentation metadata crosses the API boundary. */
export interface GrafanaPanelMetadata {
  dashboardUid?: string;
  panelId?: number;
  defaultTimeRange?: GrafanaPanelTimeRange;
  theme?: GrafanaPanelTheme;
  variableMapping?: Record<string, string>;
}

export interface GrafanaPanelConfiguration {
  clusterId: string;
  available: boolean;
  status: 'available' | 'unavailable';
  state: 'available' | 'unavailable';
  reason: string | null;
  embedUrl: string | null;
  origin: string | null;
  dashboardUid: string | null;
  panelId: number | null;
  defaultTimeRange: GrafanaPanelTimeRange;
  theme: GrafanaPanelTheme;
  variableMapping: Record<string, string>;
}
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
    const nextKind = input.kind !== undefined ? this.validKind(input.kind) : this.validKind(existing.kind);
    if (input.kind !== undefined) patch.kind = nextKind;
    if (nextKind === 'grafana') {
      const endpoint = this.validGrafanaEndpoint(input.endpoint ?? existing.endpoint);
      if (!this.isGrafanaOriginAllowed(new URL(endpoint).origin)) {
        throw new BadRequestException('Grafana origin 不在允许列表中');
      }
    }
    if (input.clusterId !== undefined) {
      patch.cluster = input.clusterId?.trim()
        ? { connect: { id: input.clusterId.trim() } }
        : { disconnect: true };
    }
    if (input.secretRef !== undefined) patch.secretRef = this.normalizeOptional(input.secretRef);
    if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
    if (input.metadata !== undefined) patch.metadata = this.validateMetadata(nextKind, input.metadata);
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
    const url = validatedKind === 'grafana'
      ? this.validGrafanaEndpoint(endpoint)
      : this.validEndpoint(endpoint);
    return this.probe(validatedKind, url);
  }

  /**
   * Resolve a cluster's Grafana dashboard without exposing credentials. The
   * endpoint is selected server-side, checked against the origin allowlist,
   * and probed before an iframe URL is returned.
   */
  async getGrafanaPanelConfiguration(
    clusterId: string,
    range?: string,
  ): Promise<GrafanaPanelConfiguration> {
    const normalizedClusterId = this.requiredText(clusterId, 'clusterId');
    const requestedRange = range ? this.validGrafanaTimeRange(range) : undefined;
    const records = await this.prisma.monitoringDataSource.findMany({
      where: {
        kind: 'grafana',
        enabled: true,
        OR: [{ clusterId: normalizedClusterId }, { clusterId: null }],
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    const record =
      records.find((item) => item.clusterId === normalizedClusterId) ??
      records.find((item) => item.clusterId === null);
    const endpoint = record?.endpoint ?? process.env.OBSERVABILITY_GRAFANA_URL;
    const metadata = record?.metadata ?? this.environmentGrafanaMetadata();
    const defaults = this.safeGrafanaMetadata(metadata);
    if (!endpoint) {
      return this.unavailableGrafanaConfiguration(
        normalizedClusterId,
        'Grafana 未配置',
        defaults,
      );
    }

    let validatedEndpoint: string;
    let validatedMetadata: GrafanaPanelMetadata;
    try {
      validatedEndpoint = this.validGrafanaEndpoint(endpoint);
      validatedMetadata = this.validateGrafanaMetadata(metadata);
    } catch (error) {
      return this.unavailableGrafanaConfiguration(
        normalizedClusterId,
        `Grafana 配置无效：${this.safeError(error)}`,
        defaults,
      );
    }
    if (!validatedMetadata.dashboardUid || !validatedMetadata.panelId) {
      return this.unavailableGrafanaConfiguration(
        normalizedClusterId,
        'Grafana 未配置 dashboard UID 或 panel ID',
        validatedMetadata,
      );
    }
    let origin: string;
    try {
      origin = new URL(validatedEndpoint).origin;
    } catch {
      return this.unavailableGrafanaConfiguration(
        normalizedClusterId,
        'Grafana Endpoint 无效',
        validatedMetadata,
      );
    }
    if (!this.isGrafanaOriginAllowed(origin)) {
      return this.unavailableGrafanaConfiguration(
        normalizedClusterId,
        'Grafana origin 不在允许列表中',
        validatedMetadata,
      );
    }

    const probe = await this.probe('grafana', validatedEndpoint);
    if (probe.status !== 'healthy') {
      return this.unavailableGrafanaConfiguration(
        normalizedClusterId,
        `Grafana 探针不可用${probe.error ? `：${probe.error}` : ''}`,
        validatedMetadata,
        origin,
      );
    }

    const defaultTimeRange = validatedMetadata.defaultTimeRange ?? '24h';
    const selectedRange = requestedRange ?? defaultTimeRange;
    const embedUrl = this.buildGrafanaEmbedUrl(
      validatedEndpoint,
      validatedMetadata,
      normalizedClusterId,
      selectedRange,
    );
    return {
      clusterId: normalizedClusterId,
      available: true,
      status: 'available',
      state: 'available',
      reason: null,
      embedUrl,
      origin,
      dashboardUid: validatedMetadata.dashboardUid,
      panelId: validatedMetadata.panelId,
      defaultTimeRange,
      theme: validatedMetadata.theme ?? 'auto',
      variableMapping: validatedMetadata.variableMapping ?? {},
    };
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

  async testNotificationTemplate(id: string): Promise<{ id: string; success: boolean; statusCode: number | null; latencyMs: number; error: string | null }> {
    const template = await this.prisma.monitoringNotificationTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('通知模板不存在');
    const started = Date.now();
    const payload = template.bodyTemplate.replace(/\{\{\s*message\s*\}\}/g, 'KubeNova 通知渠道测试').replace(/\{\{\s*title\s*\}\}/g, 'KubeNova 测试通知');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let response: Response | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await fetch(template.endpoint, {
        method: template.channel === 'email' ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: template.channel === 'email' ? undefined : payload,
        signal: controller.signal,
          });
          if (response.ok || attempt === 1) break;
        } catch (error) { lastError = error; if (attempt === 1) throw error; }
      }
      clearTimeout(timeout);
      if (!response) throw lastError ?? new Error('通知发送失败');
      return { id, success: response.ok, statusCode: response.status, latencyMs: Date.now() - started, error: response.ok ? null : `HTTP ${response.status}` };
    } catch (error) {
      return { id, success: false, statusCode: null, latencyMs: Date.now() - started, error: error instanceof Error ? error.message.slice(0, 240) : '连接失败' };
    }
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
    const kind = this.validKind(record.kind);
    return { id: record.id, clusterId: record.clusterId ?? undefined, kind, name: record.name, endpoint: record.endpoint, secretRef: record.secretRef ?? undefined, enabled: record.enabled, status: this.validStatus(record.status), metadata: this.safeMetadataForView(kind, record.metadata), lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null, lastError: record.lastError ?? null, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
  }

  private toAlertTemplateView(record: any): AlertTemplateView {
    return { id: record.id, name: record.name, severity: this.validSeverity(record.severity), expression: record.expression, duration: record.duration, enabled: record.enabled, labels: this.asStringMap(record.labels), annotations: this.asStringMap(record.annotations), version: record.version, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
  }

  private toNotificationTemplateView(record: any): NotificationTemplateView {
    return { id: record.id, name: record.name, channel: this.validChannel(record.channel), endpoint: record.endpoint, secretRef: record.secretRef ?? undefined, bodyTemplate: record.bodyTemplate, enabled: record.enabled, version: record.version, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
  }

  private validateDataSource(input: DataSourceInput): Prisma.MonitoringDataSourceCreateInput {
    const kind = this.validKind(input.kind);
    const endpoint = kind === 'grafana'
      ? this.validGrafanaEndpoint(input.endpoint)
      : this.validEndpoint(input.endpoint);
    if (kind === 'grafana' && !this.isGrafanaOriginAllowed(new URL(endpoint).origin)) {
      throw new BadRequestException('Grafana origin 不在允许列表中');
    }
    return { kind, name: this.requiredText(input.name, 'name'), endpoint, cluster: input.clusterId?.trim() ? { connect: { id: input.clusterId.trim() } } : undefined, secretRef: this.normalizeOptional(input.secretRef), enabled: input.enabled ?? true, metadata: this.validateMetadata(kind, input.metadata) };
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

  private validateMetadata(
    kind: ObservabilityKind,
    metadata: Record<string, unknown> | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (metadata === undefined) return undefined;
    return kind === 'grafana'
      ? (this.validateGrafanaMetadata(metadata) as Prisma.InputJsonValue)
      : (metadata as Prisma.InputJsonValue);
  }

  private validateGrafanaMetadata(value: unknown): GrafanaPanelMetadata {
    if (value === undefined || value === null) return {};
    const record = this.asRecord(value);
    if (!record) throw new BadRequestException('Grafana metadata 必须是对象');
    const result: GrafanaPanelMetadata = {};
    if (record.dashboardUid !== undefined) {
      const dashboardUid = this.requiredText(String(record.dashboardUid), 'dashboardUid');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(dashboardUid)) {
        throw new BadRequestException('dashboardUid 包含不支持的字符');
      }
      result.dashboardUid = dashboardUid;
    }
    if (record.panelId !== undefined) {
      if (typeof record.panelId !== 'number' || !Number.isSafeInteger(record.panelId) || record.panelId < 1 || record.panelId > 2_147_483_647) {
        throw new BadRequestException('panelId 必须是正整数');
      }
      result.panelId = record.panelId;
    }
    if (record.defaultTimeRange !== undefined) {
      result.defaultTimeRange = this.validGrafanaTimeRange(String(record.defaultTimeRange));
    }
    if (record.theme !== undefined) {
      const theme = String(record.theme);
      if (theme !== 'light' && theme !== 'dark' && theme !== 'auto') {
        throw new BadRequestException('Grafana theme 仅支持 light/dark/auto');
      }
      result.theme = theme;
    }
    if (record.variableMapping !== undefined) {
      const mapping = this.asRecord(record.variableMapping);
      if (!mapping) throw new BadRequestException('variableMapping 必须是对象');
      result.variableMapping = {};
      for (const [key, rawValue] of Object.entries(mapping)) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) {
          throw new BadRequestException('Grafana variable 名称无效');
        }
        if (typeof rawValue !== 'string' || rawValue.length > 256) {
          throw new BadRequestException('Grafana variable 值无效');
        }
        result.variableMapping[key] = rawValue;
      }
    }
    return result;
  }

  private safeGrafanaMetadata(value: unknown): GrafanaPanelMetadata {
    try {
      return this.validateGrafanaMetadata(value);
    } catch {
      return {};
    }
  }

  private safeMetadataForView(
    kind: ObservabilityKind,
    value: unknown,
  ): Record<string, unknown> | undefined {
    if (kind !== 'grafana') return this.asRecord(value);
    try {
      return this.validateGrafanaMetadata(value) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private environmentGrafanaMetadata(): GrafanaPanelMetadata {
    const variableMapping = process.env.OBSERVABILITY_GRAFANA_VARIABLE_MAPPING;
    let parsedMapping: Record<string, string> | undefined;
    if (variableMapping?.trim()) {
      try {
        parsedMapping = JSON.parse(variableMapping) as Record<string, string>;
      } catch {
        parsedMapping = undefined;
      }
    }
    return this.safeGrafanaMetadata({
      dashboardUid: process.env.OBSERVABILITY_GRAFANA_DASHBOARD_UID,
      panelId: process.env.OBSERVABILITY_GRAFANA_PANEL_ID
        ? Number(process.env.OBSERVABILITY_GRAFANA_PANEL_ID)
        : undefined,
      defaultTimeRange: process.env.OBSERVABILITY_GRAFANA_DEFAULT_TIME_RANGE,
      theme: process.env.OBSERVABILITY_GRAFANA_THEME,
      variableMapping: parsedMapping,
    });
  }

  private validGrafanaTimeRange(value: string): GrafanaPanelTimeRange {
    if (value === '15m' || value === '1h' || value === '6h' || value === '24h' || value === '7d') {
      return value;
    }
    throw new BadRequestException('Grafana time range 仅支持 15m/1h/6h/24h/7d');
  }

  private isGrafanaOriginAllowed(origin: string): boolean {
    const configured = (process.env.OBSERVABILITY_GRAFANA_ALLOWED_ORIGINS ?? '')
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (configured.length === 0) return true;
    return configured.some((item) => {
      try {
        return new URL(item).origin === origin;
      } catch {
        return false;
      }
    });
  }

  private buildGrafanaEmbedUrl(
    endpoint: string,
    metadata: GrafanaPanelMetadata,
    clusterId: string,
    range: GrafanaPanelTimeRange,
  ): string {
    const base = new URL(endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
    base.username = '';
    base.password = '';
    base.hash = '';
    const pathname = base.pathname.replace(/\/+$/, '');
    base.pathname = `${pathname}/d-solo/${encodeURIComponent(metadata.dashboardUid ?? '')}`;
    base.search = '';
    base.searchParams.set('panelId', String(metadata.panelId));
    base.searchParams.set('from', `now-${range}`);
    base.searchParams.set('to', 'now');
    if (metadata.theme && metadata.theme !== 'auto') base.searchParams.set('theme', metadata.theme);
    for (const [key, mappedValue] of Object.entries(metadata.variableMapping ?? {})) {
      const value = mappedValue === '$clusterId' || mappedValue === '{{clusterId}}' || mappedValue === 'clusterId'
        ? clusterId
        : mappedValue;
      base.searchParams.set(`var-${key}`, value);
    }
    return base.toString();
  }

  private unavailableGrafanaConfiguration(
    clusterId: string,
    reason: string,
    metadata: GrafanaPanelMetadata,
    origin: string | null = null,
  ): GrafanaPanelConfiguration {
    return {
      clusterId,
      available: false,
      status: 'unavailable',
      state: 'unavailable',
      reason,
      embedUrl: null,
      origin,
      dashboardUid: metadata.dashboardUid ?? null,
      panelId: metadata.panelId ?? null,
      defaultTimeRange: metadata.defaultTimeRange ?? '24h',
      theme: metadata.theme ?? 'auto',
      variableMapping: metadata.variableMapping ?? {},
    };
  }

  private validKind(value: string): ObservabilityKind { if ((OBSERVABILITY_KINDS as readonly string[]).includes(value)) return value as ObservabilityKind; throw new BadRequestException('kind 不受支持'); }
  private validSeverity(value: string): Severity { if (value === 'critical' || value === 'warning' || value === 'info') return value; throw new BadRequestException('severity 仅支持 critical/warning/info'); }
  private validChannel(value: string): NotificationChannel { if ((NOTIFICATION_CHANNELS as readonly string[]).includes(value)) return value as NotificationChannel; throw new BadRequestException('channel 不受支持'); }
  private validStatus(value: string): ObservabilityStatus { return ['unknown', 'healthy', 'degraded', 'unavailable', 'disabled'].includes(value) ? value as ObservabilityStatus : 'unknown'; }
  private requiredText(value: string, field: string): string { const text = value?.trim(); if (!text) throw new BadRequestException(`${field} 不能为空`); return text; }
  private validEndpoint(value: string): string { const text = this.requiredText(value, 'endpoint'); let parsed: URL; try { parsed = new URL(text); } catch { throw new BadRequestException('endpoint 必须是合法 URL'); } if (!['http:', 'https:'].includes(parsed.protocol)) throw new BadRequestException('endpoint 仅支持 HTTP/HTTPS'); return text.replace(/\/$/, ''); }
  private validGrafanaEndpoint(value: string): string { const endpoint = this.validEndpoint(value); const parsed = new URL(endpoint); if (parsed.username || parsed.password) throw new BadRequestException('Grafana endpoint 不得包含用户名或密码'); return endpoint; }
  private normalizeOptional(value?: string): string | undefined { const text = value?.trim(); return text || undefined; }
  private asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
  private asStringMap(value: unknown): Record<string, string> | undefined { const record = this.asRecord(value); if (!record) return undefined; return Object.fromEntries(Object.entries(record).filter(([, item]) => typeof item === 'string')) as Record<string, string>; }
  private safeError(error: unknown): string { if (error instanceof Error && error.name === 'AbortError') return '探针超时'; return error instanceof Error ? error.message.slice(0, 240) : '连接失败'; }
  private audit(actor: ObservabilityActor | undefined, action: 'create' | 'update' | 'delete', resourceId: string, _clusterId?: string | null): void { appendAudit({ actor: actor?.username ?? 'unknown', role: actor?.role ?? 'read-only', action, resourceType: 'observability', resourceId, result: 'success' }); }
}
