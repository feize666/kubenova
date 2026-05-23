import { BadRequestException, Injectable } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { ClustersService } from '../clusters/clusters.service';
import { K8sClientService } from '../clusters/k8s-client.service';
import type {
  CreateRuntimeSessionRequest,
  RuntimeGatewayAccessContext,
  RuntimeSessionBootstrapResponse,
} from '../runtime/runtime.service';
import { RuntimeService } from '../runtime/runtime.service';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

interface LogRecord {
  id: string;
  clusterId: string;
  namespace: string;
  pod: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

type EmptyReason =
  | 'TARGET_REQUIRED'
  | 'NO_LOG_LINES'
  | 'NO_PARSEABLE_TIMESTAMPS'
  | 'TIME_RANGE_NO_MATCH'
  | 'FILTER_NO_MATCH';

interface ParsedLogLine {
  line: string;
  message: string;
  timestamp?: Date;
}

export interface LogsQueryRequest {
  clusterId?: string;
  namespace?: string;
  pod?: string;
  container?: string;
  level?: LogLevel;
  keyword?: string;
  tailLines?: string;
  sinceSeconds?: string;
  sinceTime?: string;
  untilTime?: string;
  refreshIntervalSeconds?: string;
  previous?: string;
  timestamps?: string;
  page?: string;
  pageSize?: string;
}

export interface LogsQueryResponse {
  items: LogRecord[];
  page: number;
  pageSize: number;
  total: number;
  lastLogTimestamp?: string;
  emptyReason?: EmptyReason;
  timestamp: string;
}

export interface LogsStreamBootstrapRequest {
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  level?: LogLevel;
  keyword?: string;
  tailLines?: number;
  sinceSeconds?: number;
  sinceTime?: string;
  untilTime?: string;
  refreshIntervalSeconds?: number;
  follow?: boolean;
  previous?: boolean;
  timestamps?: boolean;
}

@Injectable()
export class LogsService {
  constructor(
    private readonly runtimeService: RuntimeService,
    private readonly clustersService: ClustersService,
    private readonly k8sClientService: K8sClientService,
  ) {}

  async query(input: LogsQueryRequest): Promise<LogsQueryResponse> {
    const clusterId = this.firstNonEmpty(
      input.clusterId,
      this.readAlias(input, 'cluster'),
    );
    const namespace = this.firstNonEmpty(
      input.namespace,
      this.readAlias(input, 'ns'),
    );
    const pod = this.firstNonEmpty(input.pod, this.readAlias(input, 'podName'));
    const container = this.firstNonEmpty(
      input.container,
      this.readAlias(input, 'containerName'),
    );
    const page = this.parsePositiveInt(input.page, 1, 'page');
    const pageSize = this.parsePositiveInt(input.pageSize, 20, 'pageSize');
    const tailLines = this.parseTailLines(input.tailLines);
    const sinceSeconds = this.parseOptionalPositiveInt(
      input.sinceSeconds,
      'sinceSeconds',
    );
    const sinceTime = this.parseOptionalRfc3339(input.sinceTime, 'sinceTime');
    const untilTime = this.parseOptionalRfc3339(input.untilTime, 'untilTime');
    this.assertTimeRange(sinceTime, untilTime);
    this.parseOptionalRefreshInterval(input.refreshIntervalSeconds);
    const previous = this.parseBooleanString(input.previous, false);
    const timestamps = this.parseBooleanString(input.timestamps, true);

    if (
      input.level !== undefined &&
      !['INFO', 'WARN', 'ERROR'].includes(input.level)
    ) {
      throw new BadRequestException('level 必须为 INFO、WARN 或 ERROR');
    }

    if (!clusterId || !namespace || !pod) {
      return {
        items: [],
        page,
        pageSize,
        total: 0,
        emptyReason: 'TARGET_REQUIRED',
        timestamp: new Date().toISOString(),
      };
    }

    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new BadRequestException(
        '该集群未配置 kubeconfig，无法读取真实日志',
      );
    }

    const coreApi = this.k8sClientService.getCoreApi(kubeconfig);
    let rawText = '';
    try {
      const podResult = await coreApi.readNamespacedPod({
        name: pod,
        namespace,
      });

      const selectedContainer = this.resolveContainerName(podResult, container);
      const raw = await coreApi.readNamespacedPodLog(
        {
          name: pod,
          namespace,
          container: selectedContainer,
          follow: false,
          timestamps,
          tailLines: tailLines > 0 ? tailLines : undefined,
          // Absolute filters are applied below against parsed log text. Do not
          // push sinceTime to Kubernetes here because app logs such as nginx
          // carry their own timestamp inside the message body.
          sinceSeconds: sinceTime || untilTime ? undefined : sinceSeconds,
          previous,
        },
      );
      rawText = this.extractLogText(raw);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Kubernetes 日志接口调用失败';
      throw new BadRequestException(`读取日志失败：${message}`);
    }

    const normalizedKeyword = input.keyword?.trim().toLowerCase();
    const lines = rawText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const parsedLines = lines.map((line) => this.parseLogLine(line));
    const hasAbsoluteTimeFilter = Boolean(sinceTime || untilTime);
    const parseableLines = hasAbsoluteTimeFilter
      ? parsedLines.filter((line) => line.timestamp)
      : parsedLines;
    const rangedLines = parseableLines.filter((line) => {
      if (!line.timestamp) return true;
      if (sinceTime && line.timestamp.getTime() < sinceTime.getTime()) {
        return false;
      }
      if (untilTime && line.timestamp.getTime() > untilTime.getTime()) {
        return false;
      }
      return true;
    });

    const parsed: LogRecord[] = rangedLines.map((line, index) => {
      const timestamp = line.timestamp ?? new Date();
      const message = line.message;
      const upper = message.toUpperCase();
      const level: LogLevel = upper.includes('ERROR')
        ? 'ERROR'
        : upper.includes('WARN')
          ? 'WARN'
          : 'INFO';
      return {
        id: `${clusterId}-${namespace}-${pod}-${index}`,
        clusterId,
        namespace,
        pod,
        level,
        message,
        timestamp: timestamp.toISOString(),
      };
    });

    const filtered = parsed.filter((item) => {
      if (input.level && item.level !== input.level) return false;
      if (
        normalizedKeyword &&
        !item.message.toLowerCase().includes(normalizedKeyword)
      ) {
        return false;
      }
      return true;
    });

    const total = filtered.length;
    const start = Math.max(total - page * pageSize, 0);
    const end = total - (page - 1) * pageSize;
    const items = filtered.slice(start, end).reverse();
    const lastLogTimestamp = this.resolveLastLogTimestamp(filtered);
    const emptyReason = this.resolveEmptyReason({
      rawLineCount: lines.length,
      parseableLineCount: parseableLines.length,
      rangedLineCount: rangedLines.length,
      filteredCount: filtered.length,
      hasAbsoluteTimeFilter,
    });

    return {
      items,
      page,
      pageSize,
      total,
      lastLogTimestamp,
      emptyReason,
      timestamp: new Date().toISOString(),
    };
  }

  createStreamSession(
    input: LogsStreamBootstrapRequest,
    access?: RuntimeGatewayAccessContext,
  ): Promise<RuntimeSessionBootstrapResponse> {
    this.assertRequired(input.clusterId, 'clusterId');
    this.assertRequired(input.namespace, 'namespace');
    this.assertRequired(input.pod, 'pod');
    this.assertRequired(input.container, 'container');
    if (
      input.level !== undefined &&
      !['INFO', 'WARN', 'ERROR'].includes(input.level)
    ) {
      throw new BadRequestException('level 必须为 INFO、WARN 或 ERROR');
    }

    const sinceTime = this.parseOptionalRfc3339(input.sinceTime, 'sinceTime');
    const untilTime = this.parseOptionalRfc3339(input.untilTime, 'untilTime');
    this.assertTimeRange(sinceTime, untilTime);
    const refreshIntervalSeconds = this.parseOptionalRefreshInterval(
      input.refreshIntervalSeconds,
    );

    const sessionInput: CreateRuntimeSessionRequest = {
      type: 'logs',
      clusterId: input.clusterId,
      namespace: input.namespace,
      pod: input.pod,
      container: input.container,
      level: input.level,
      keyword: input.keyword,
      tailLines: input.tailLines,
      sinceSeconds: sinceTime ? undefined : input.sinceSeconds,
      sinceTime: sinceTime?.toISOString(),
      untilTime: untilTime?.toISOString(),
      refreshIntervalSeconds,
      follow: input.follow,
      previous: input.previous,
      timestamps: input.timestamps,
    };
    return this.runtimeService.createSession(sessionInput, access);
  }

  private parsePositiveInt(
    raw: string | undefined,
    fallback: number,
    field: string,
  ): number {
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new BadRequestException(`${field} 必须为正整数`);
    }
    return parsed;
  }

  private parseOptionalPositiveInt(
    raw: string | undefined,
    field: string,
  ): number | undefined {
    if (!raw) return undefined;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new BadRequestException(`${field} 必须为正整数`);
    }
    return parsed;
  }

  private parseOptionalRefreshInterval(
    raw: string | number | undefined,
  ): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const parsed =
      typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isInteger(parsed) || (parsed !== 0 && parsed < 2)) {
      throw new BadRequestException(
        'refreshIntervalSeconds 必须为 0 或不小于 2 的整数',
      );
    }
    return parsed === 0 ? undefined : parsed;
  }

  private parseOptionalRfc3339(
    raw: string | undefined,
    field: string,
  ): Date | undefined {
    if (!raw) return undefined;
    const trimmed = raw.trim();
    const rfc3339Pattern =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
    if (!rfc3339Pattern.test(trimmed)) {
      throw new BadRequestException(`${field} 必须为 ISO/RFC3339 时间`);
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} 必须为有效时间`);
    }
    if (parsed.getTime() > Date.now()) {
      throw new BadRequestException(`${field} 不能晚于当前时间`);
    }
    return parsed;
  }

  private assertTimeRange(sinceTime?: Date, untilTime?: Date): void {
    if (sinceTime && untilTime && sinceTime.getTime() > untilTime.getTime()) {
      throw new BadRequestException('sinceTime 不能晚于 untilTime');
    }
  }

  private parseTailLines(raw: string | undefined): number {
    if (!raw) return 500;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || (parsed <= 0 && parsed !== -1)) {
      throw new BadRequestException('tailLines 必须为正整数或 -1');
    }
    return parsed;
  }

  private parseBooleanString(
    raw: string | undefined,
    fallback: boolean,
  ): boolean {
    if (!raw) return fallback;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    throw new BadRequestException('布尔参数格式错误');
  }

  private assertRequired(value: string | undefined, field: string): void {
    if (!value || value.trim().length === 0) {
      throw new BadRequestException(`${field} 是必填字段`);
    }
  }

  private readAlias(input: LogsQueryRequest, key: string): string | undefined {
    const candidate = (input as Record<string, unknown>)[key];
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private firstNonEmpty(
    ...values: Array<string | undefined>
  ): string | undefined {
    for (const value of values) {
      if (value && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  private resolveContainerName(
    podResult: unknown,
    requestedContainer: string | undefined,
  ): string | undefined {
    const withBody =
      podResult && typeof podResult === 'object'
        ? (podResult as {
            body?: { spec?: { containers?: Array<{ name?: string }> } };
            spec?: { containers?: Array<{ name?: string }> };
          })
        : undefined;
    const pod = withBody?.body ?? withBody;
    const containers = pod?.spec?.containers ?? [];
    if (requestedContainer) {
      const matched = containers.some(
        (item) => item?.name === requestedContainer,
      );
      if (!matched) {
        throw new BadRequestException(
          `容器 ${requestedContainer} 不存在于目标 Pod 中`,
        );
      }
      return requestedContainer;
    }
    const first = containers.find(
      (item) => typeof item?.name === 'string',
    )?.name;
    return first;
  }

  private extractLogText(raw: unknown): string {
    if (typeof raw === 'string') {
      return raw;
    }
    if (raw && typeof raw === 'object') {
      const maybeBody = (raw as Record<string, unknown>).body;
      if (typeof maybeBody === 'string') {
        return maybeBody;
      }
    }
    return '';
  }

  private parseLogLine(line: string): ParsedLogLine {
    const rfc3339 = this.parseRfc3339Prefix(line);
    if (rfc3339) {
      return {
        line,
        message: line.slice(rfc3339.raw.length).trimStart(),
        timestamp: rfc3339.timestamp,
      };
    }

    const nginx = this.parseNginxCommonLogTime(line);
    return {
      line,
      message: line,
      timestamp: nginx,
    };
  }

  private parseRfc3339Prefix(
    line: string,
  ): { raw: string; timestamp: Date } | undefined {
    const match = line.match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))(?:\s|$)/,
    );
    if (!match) return undefined;
    const parsed = new Date(match[1]);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return { raw: match[1], timestamp: parsed };
  }

  private parseNginxCommonLogTime(line: string): Date | undefined {
    const match = line.match(
      /\[(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\]/,
    );
    if (!match) return undefined;

    const month = this.nginxMonthToIndex(match[2]);
    if (month === undefined) return undefined;

    const offset = match[7];
    const iso = `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}T${match[4]}:${match[5]}:${match[6]}${offset.slice(0, 3)}:${offset.slice(3)}`;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
  }

  private nginxMonthToIndex(month: string): number | undefined {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const index = months.findIndex(
      (candidate) => candidate.toLowerCase() === month.toLowerCase(),
    );
    return index >= 0 ? index : undefined;
  }

  private resolveLastLogTimestamp(items: LogRecord[]): string | undefined {
    return items.reduce<string | undefined>((latest, item) => {
      if (!latest) return item.timestamp;
      return Date.parse(item.timestamp) > Date.parse(latest)
        ? item.timestamp
        : latest;
    }, undefined);
  }

  private resolveEmptyReason(input: {
    rawLineCount: number;
    parseableLineCount: number;
    rangedLineCount: number;
    filteredCount: number;
    hasAbsoluteTimeFilter: boolean;
  }): EmptyReason | undefined {
    if (input.filteredCount > 0) return undefined;
    if (input.rawLineCount === 0) return 'NO_LOG_LINES';
    if (input.hasAbsoluteTimeFilter && input.parseableLineCount === 0) {
      return 'NO_PARSEABLE_TIMESTAMPS';
    }
    if (input.hasAbsoluteTimeFilter && input.rangedLineCount === 0) {
      return 'TIME_RANGE_NO_MATCH';
    }
    return 'FILTER_NO_MATCH';
  }
}
