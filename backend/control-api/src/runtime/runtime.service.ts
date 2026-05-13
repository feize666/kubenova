import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { ClustersService } from '../clusters/clusters.service';
import { K8sClientService } from '../clusters/k8s-client.service';
import {
  RuntimeSessionService,
  type RuntimeTokenPayload,
  type RuntimeGatewayPath,
} from './runtime-session.service';

export interface CreateRuntimeSessionRequest {
  type: 'terminal' | 'logs';
  userId?: string;
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  previous?: boolean;
  level?: 'INFO' | 'WARN' | 'ERROR';
  keyword?: string;
  command?: string;
  tailLines?: number;
  sinceSeconds?: number;
  follow?: boolean;
  timestamps?: boolean;
}

export interface RuntimeGatewayAccessContext {
  requestHost?: string;
  requestProtocol?: 'http' | 'https';
  requestOrigin?: string;
}

export interface RuntimeSessionBootstrapResponse {
  sessionId: string;
  runtimeToken: string;
  gatewayWsUrl: string;
  expiresAt: string;
  reconnectable: boolean;
  sessionState: 'ready' | 'expired' | 'closed';
  target: RuntimeSessionTargetContext;
}

export interface RuntimeSessionTargetContext {
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  availableContainers: string[];
  podPhase?: string;
}

export interface RuntimeGatewaySessionBootstrap {
  sessionId: string;
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  type: 'terminal' | 'logs';
  path: RuntimeGatewayPath;
  kubeconfig: string;
  shellCommand: string[];
  logStreamOptions?: {
    level?: 'INFO' | 'WARN' | 'ERROR';
    keyword?: string;
    tailLines?: number;
    sinceSeconds?: number;
    follow?: boolean;
    previous?: boolean;
    timestamps?: boolean;
  };
  expiresAt: string;
  reconnectable: boolean;
  sessionState: 'active' | 'expired' | 'closed';
  target: RuntimeSessionTargetContext;
}

@Injectable()
export class RuntimeService {
  private readonly logger = new Logger(RuntimeService.name);
  private readonly sessionTtlSeconds = 30 * 60;
  private readonly runtimeGatewayInternalSecret =
    process.env.RUNTIME_GATEWAY_INTERNAL_SECRET?.trim() ||
    process.env.RUNTIME_TOKEN_SECRET?.trim() ||
    'dev-runtime-token-secret';
  private readonly runtimeGatewayPublicBase = this.normalizeGatewayBase(
    process.env.RUNTIME_GATEWAY_PUBLIC_BASE_URL ?? '',
  );
  private readonly runtimeGatewayBase = this.normalizeGatewayBase(
    process.env.RUNTIME_GATEWAY_BASE_URL ??
      process.env.RUNTIME_GATEWAY_WS_BASE ??
      'ws://localhost:4100',
  );

  constructor(
    private readonly runtimeSessionService: RuntimeSessionService,
    private readonly clustersService: ClustersService,
    private readonly k8sClientService: K8sClientService,
  ) {}

  async createSession(
    input: CreateRuntimeSessionRequest,
    access?: RuntimeGatewayAccessContext,
  ): Promise<RuntimeSessionBootstrapResponse> {
    this.validateInput(input);
    const target = await this.validateTarget(input);

    const sessionId = randomUUID();
    const path = this.resolveGatewayPath(input.type);
    const expiresAtEpochSeconds =
      Math.floor(Date.now() / 1000) + this.sessionTtlSeconds;
    const expiresAtDate = new Date(expiresAtEpochSeconds * 1000);
    const expiresAt = expiresAtDate.toISOString();
    const runtimeToken = this.runtimeSessionService.createRuntimeToken({
      sessionId,
      userId: input.userId?.trim() || 'unknown-user',
      type: input.type,
      clusterId: input.clusterId,
      namespace: input.namespace,
      pod: input.pod,
      container: input.container,
      availableContainers: target.availableContainers,
      podPhase: target.podPhase,
      level: input.type === 'logs' ? input.level : undefined,
      keyword: input.type === 'logs' ? input.keyword?.trim() : undefined,
      tailLines: input.type === 'logs' ? input.tailLines : undefined,
      sinceSeconds: input.type === 'logs' ? input.sinceSeconds : undefined,
      follow: input.type === 'logs' ? input.follow : undefined,
      previous: input.type === 'logs' ? input.previous : undefined,
      timestamps: input.type === 'logs' ? input.timestamps : undefined,
      path,
      exp: expiresAtEpochSeconds,
    } satisfies RuntimeTokenPayload);

    await this.runtimeSessionService.persistSession({
      id: sessionId,
      clusterId: input.clusterId,
      userId: input.userId,
      type: input.type,
      namespace: input.namespace,
      pod: input.pod,
      container: input.container,
      expiresAt: expiresAtDate,
    });

    this.logger.log(
      `runtime session created: sessionId=${sessionId}, type=${input.type}, clusterId=${input.clusterId}, namespace=${input.namespace}, pod=${input.pod}, container=${input.container}`,
    );

    return {
      sessionId,
      runtimeToken,
      gatewayWsUrl: this.buildGatewayUrl(
        input,
        sessionId,
        runtimeToken,
        path,
        access,
      ),
      expiresAt,
      reconnectable: true,
      sessionState: 'ready',
      target,
    };
  }

  async getGatewaySessionBootstrap(input: {
    sessionId: string;
    runtimeToken: string;
    path: RuntimeGatewayPath;
    internalSecret?: string;
  }): Promise<RuntimeGatewaySessionBootstrap> {
    if (!this.isValidInternalSecret(input.internalSecret)) {
      throw new ForbiddenException(
        'runtime gateway internal secret is invalid',
      );
    }

    const validation =
      await this.runtimeSessionService.validateSessionTokenDetailed({
        sessionId: input.sessionId,
        runtimeToken: input.runtimeToken,
        expectedPath: input.path,
      });
    if (!validation.payload) {
      this.logger.warn(
        `runtime bootstrap rejected: sessionId=${input.sessionId}, path=${input.path}, code=${validation.code ?? 'UNKNOWN'}`,
      );
      throw new BadRequestException({
        code: validation.code ?? 'RUNTIME_SESSION_UNAUTHORIZED',
        message: validation.message ?? 'runtime session token 无效或已过期',
      });
    }
    const payload = validation.payload;

    const kubeconfig = await this.clustersService.getKubeconfig(
      payload.clusterId,
    );
    if (!kubeconfig) {
      this.logger.warn(
        `runtime bootstrap rejected: sessionId=${payload.sessionId}, clusterId=${payload.clusterId}, reason=KUBECONFIG_MISSING`,
      );
      throw new BadRequestException(
        `目标集群未配置 kubeconfig，无法建立真实${payload.type === 'logs' ? '日志' : '终端'}连接`,
      );
    }

    return {
      sessionId: payload.sessionId,
      clusterId: payload.clusterId,
      namespace: payload.namespace,
      pod: payload.pod,
      container: payload.container,
      type: payload.type,
      path: payload.path,
      kubeconfig,
      shellCommand: this.buildShellCommand(),
      logStreamOptions:
        payload.type === 'logs'
          ? {
              level: payload.level,
              keyword: payload.keyword,
              tailLines: payload.tailLines,
              sinceSeconds: payload.sinceSeconds,
              follow: payload.follow,
              previous: payload.previous,
              timestamps: payload.timestamps,
            }
          : undefined,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      reconnectable: true,
      sessionState: 'active',
      target: {
        clusterId: payload.clusterId,
        namespace: payload.namespace,
        pod: payload.pod,
        container: payload.container,
        availableContainers: payload.availableContainers ?? [payload.container],
        podPhase: payload.podPhase,
      },
    };
  }

  private validateInput(input: CreateRuntimeSessionRequest): void {
    this.assertRequiredString(input.clusterId, 'clusterId');
    this.assertRequiredString(input.namespace, 'namespace');
    this.assertRequiredString(input.pod, 'pod');
    this.assertRequiredString(input.container, 'container');
    if (input.type !== 'terminal' && input.type !== 'logs') {
      throw new BadRequestException('type 必须为 terminal 或 logs');
    }

    if (input.command !== undefined && input.command.trim().length === 0) {
      throw new BadRequestException('command 不能为空字符串');
    }
    if (input.keyword !== undefined && input.keyword.trim().length === 0) {
      throw new BadRequestException('keyword 不能为空字符串');
    }
    if (
      input.level !== undefined &&
      !['INFO', 'WARN', 'ERROR'].includes(input.level)
    ) {
      throw new BadRequestException('level 必须为 INFO、WARN 或 ERROR');
    }
    if (input.previous !== undefined && typeof input.previous !== 'boolean') {
      throw new BadRequestException('previous 必须为 boolean');
    }

    this.assertTailLines(input.tailLines, 'tailLines');
    this.assertPositiveInt(input.sinceSeconds, 'sinceSeconds');
    this.assertBoolean(input.follow, 'follow');
    this.assertBoolean(input.previous, 'previous');
    this.assertBoolean(input.timestamps, 'timestamps');
  }

  private assertRequiredString(value: string | undefined, field: string): void {
    if (!value || value.trim().length === 0) {
      throw new BadRequestException(`${field} 是必填字段`);
    }
  }

  private assertPositiveInt(value: number | undefined, field: string): void {
    if (value === undefined) {
      return;
    }

    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} 必须为正整数`);
    }
  }

  private assertTailLines(value: number | undefined, field: string): void {
    if (value === undefined) {
      return;
    }
    if (!Number.isInteger(value) || (value <= 0 && value !== -1)) {
      throw new BadRequestException(`${field} 必须为正整数或 -1`);
    }
  }

  private assertBoolean(value: boolean | undefined, field: string): void {
    if (value === undefined) {
      return;
    }
    if (typeof value !== 'boolean') {
      throw new BadRequestException(`${field} 必须为布尔值`);
    }
  }

  private async validateTarget(
    input: CreateRuntimeSessionRequest,
  ): Promise<RuntimeSessionTargetContext> {
    const kubeconfig = await this.clustersService.getKubeconfig(
      input.clusterId,
    );
    if (!kubeconfig) {
      throw new BadRequestException({
        code: 'RUNTIME_CLUSTER_KUBECONFIG_MISSING',
        message: '目标集群未配置 kubeconfig，无法创建运行时会话',
      });
    }

    const coreApi = this.k8sClientService.getCoreApi(kubeconfig);
    let pod: k8s.V1Pod;
    try {
      pod = await coreApi.readNamespacedPod({
        name: input.pod,
        namespace: input.namespace,
      });
    } catch (error) {
      if (this.getKubernetesErrorCode(error) === 404) {
        throw new BadRequestException({
          code: 'RUNTIME_POD_NOT_FOUND',
          message: `Pod ${input.namespace}/${input.pod} 不存在，请返回资源页重新进入终端`,
        });
      }
      throw new BadRequestException({
        code: 'RUNTIME_TARGET_VALIDATE_FAILED',
        message: `读取目标 Pod 失败：${this.extractErrorMessage(error)}`,
      });
    }

    const availableContainers = (pod.spec?.containers ?? [])
      .map((item) => item.name?.trim() ?? '')
      .filter((name): name is string => Boolean(name));
    if (availableContainers.length === 0) {
      throw new BadRequestException({
        code: 'RUNTIME_POD_CONTAINERS_EMPTY',
        message: `Pod ${input.namespace}/${input.pod} 不包含可执行容器`,
      });
    }

    if (!availableContainers.includes(input.container)) {
      throw new BadRequestException({
        code: 'RUNTIME_CONTAINER_NOT_FOUND',
        message: `容器 ${input.container} 不存在于 Pod ${input.namespace}/${input.pod}`,
        details: {
          availableContainers,
        },
      });
    }

    const podPhase = pod.status?.phase?.trim();
    if (input.type === 'terminal' && podPhase && podPhase !== 'Running') {
      throw new BadRequestException({
        code: 'RUNTIME_POD_NOT_RUNNING',
        message: `Pod ${input.namespace}/${input.pod} 当前状态为 ${podPhase}，无法建立终端`,
        details: {
          podPhase,
        },
      });
    }

    return {
      clusterId: input.clusterId,
      namespace: input.namespace,
      pod: input.pod,
      container: input.container,
      availableContainers,
      podPhase,
    };
  }

  private getKubernetesErrorCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }
    const record = error as { code?: unknown };
    return typeof record.code === 'number' ? record.code : undefined;
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    return 'unknown kubernetes error';
  }

  private buildGatewayUrl(
    input: CreateRuntimeSessionRequest,
    sessionId: string,
    runtimeToken: string,
    path: '/ws/terminal' | '/ws/logs',
    access?: RuntimeGatewayAccessContext,
  ): string {
    const query = new URLSearchParams({
      sessionId,
      runtimeToken,
      clusterId: input.clusterId,
      namespace: input.namespace,
      pod: input.pod,
      container: input.container,
    });
    if (input.type === 'logs') {
      if (input.level) {
        query.set('level', input.level);
      }
      if (input.keyword) {
        query.set('keyword', input.keyword.trim());
      }
      if (input.tailLines !== undefined) {
        query.set('tailLines', String(input.tailLines));
      }
      if (input.sinceSeconds) {
        query.set('sinceSeconds', String(input.sinceSeconds));
      }
      if (input.previous) {
        query.set('previous', 'true');
      }
      if (typeof input.follow === 'boolean') {
        query.set('follow', String(input.follow));
      }
      if (typeof input.previous === 'boolean') {
        query.set('previous', String(input.previous));
      }
      if (typeof input.timestamps === 'boolean') {
        query.set('timestamps', String(input.timestamps));
      }
    }
    const gatewayBase = this.resolveGatewayBaseForClient(access);
    return `${gatewayBase}${path}?${query.toString()}`;
  }

  private resolveGatewayPath(
    type: CreateRuntimeSessionRequest['type'],
  ): '/ws/terminal' | '/ws/logs' {
    return type === 'terminal' ? '/ws/terminal' : '/ws/logs';
  }

  private normalizeGatewayBase(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (!trimmed) {
      return '';
    }
    if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
      return trimmed;
    }
    if (trimmed.startsWith('http://')) {
      return `ws://${trimmed.slice('http://'.length)}`;
    }
    if (trimmed.startsWith('https://')) {
      return `wss://${trimmed.slice('https://'.length)}`;
    }
    return trimmed;
  }

  private resolveGatewayBaseForClient(
    access?: RuntimeGatewayAccessContext,
  ): string {
    if (this.runtimeGatewayPublicBase) {
      return this.runtimeGatewayPublicBase;
    }

    const configuredBase = this.runtimeGatewayBase;
    if (configuredBase.startsWith('/')) {
      const requestHost =
        access?.requestHost?.trim() || this.extractHostFromOrigin(access?.requestOrigin);
      const requestProtocol =
        access?.requestProtocol ||
        this.extractProtocolFromOrigin(access?.requestOrigin);
      const wsProtocol = requestProtocol === 'https' ? 'wss' : 'ws';
      if (requestHost) {
        return `${wsProtocol}://${requestHost}${configuredBase}`.replace(/\/+$/, '');
      }
      return configuredBase;
    }
    let configured: URL;
    try {
      configured = new URL(configuredBase);
    } catch {
      return configuredBase;
    }

    const requestHost = access?.requestHost?.trim();
    const requestProtocol = access?.requestProtocol;
    const requestOrigin = access?.requestOrigin?.trim();
    let parsedOrigin: URL | null = null;
    if (requestOrigin) {
      try {
        parsedOrigin = new URL(requestOrigin);
      } catch {
        parsedOrigin = null;
      }
    }

    if (requestProtocol === 'https') {
      configured.protocol = 'wss:';
    } else if (requestProtocol === 'http') {
      configured.protocol = 'ws:';
    } else if (parsedOrigin) {
      configured.protocol = parsedOrigin.protocol === 'https:' ? 'wss:' : 'ws:';
    }

    const requestHostName = this.extractHostName(requestHost);
    const requestHostWithPort = this.extractHostWithPort(requestHost);
    const requestOriginHost = parsedOrigin?.hostname ?? undefined;
    const requestOriginHostWithPort = parsedOrigin?.host ?? undefined;

    const isConfiguredLoopback =
      configured.hostname === 'localhost' ||
      configured.hostname === '127.0.0.1' ||
      configured.hostname === '::1';
    const isOriginLoopback =
      requestOriginHost === 'localhost' ||
      requestOriginHost === '127.0.0.1' ||
      requestOriginHost === '::1';
    // If the page called control-api through the frontend host, prefer that exact
    // host:port so browsers can reuse the same-origin /ws proxy instead of direct
    // access to the gateway port.
    if (isConfiguredLoopback && requestHostWithPort) {
      configured.host = requestHostWithPort;
    } else if (
      isConfiguredLoopback &&
      requestOriginHostWithPort &&
      !isOriginLoopback
    ) {
      configured.host = requestOriginHostWithPort;
    }

    return configured.toString().replace(/\/+$/, '');
  }

  private extractHostName(value: string | undefined): string {
    if (!value) {
      return '';
    }
    const normalized = value.trim();
    if (!normalized) {
      return '';
    }
    if (normalized.startsWith('[')) {
      const closing = normalized.indexOf(']');
      if (closing > 1) {
        return normalized.slice(1, closing);
      }
    }
    const lastColon = normalized.lastIndexOf(':');
    if (lastColon > 0 && normalized.indexOf(':') === lastColon) {
      return normalized.slice(0, lastColon);
    }
    return normalized;
  }

  private extractHostWithPort(value: string | undefined): string {
    if (!value) {
      return '';
    }
    return value.trim();
  }

  private extractHostFromOrigin(value: string | undefined): string {
    if (!value) {
      return '';
    }
    try {
      return new URL(value).host;
    } catch {
      return '';
    }
  }

  private extractProtocolFromOrigin(
    value: string | undefined,
  ): 'http' | 'https' | undefined {
    if (!value) {
      return undefined;
    }
    try {
      const protocol = new URL(value).protocol;
      if (protocol === 'https:') {
        return 'https';
      }
      if (protocol === 'http:') {
        return 'http';
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private isValidInternalSecret(secret: string | undefined): boolean {
    if (!secret) {
      return false;
    }

    const left = Buffer.from(secret);
    const right = Buffer.from(this.runtimeGatewayInternalSecret);
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  }

  private buildShellCommand(): string[] {
    return [
      '/bin/sh',
      '-c',
      'if command -v bash >/dev/null 2>&1; then exec bash; elif command -v sh >/dev/null 2>&1; then exec sh; else exec /bin/sh; fi',
    ];
  }
}
