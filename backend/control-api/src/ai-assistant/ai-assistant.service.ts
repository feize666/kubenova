import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { randomUUID } from 'node:crypto';
import type {
  AiConversationMessage as AiConversationMessageRecord,
  AiConversationSession as AiConversationSessionRecord,
  Prisma,
} from '@prisma/client';
import { HelmService } from '../helm/helm.service';
import { PrismaService } from '../platform/database/prisma.service';
import {
  AiMessageAttachment,
  AiActionDescriptor,
  AiAssistantActionOperation,
  AiAssistantActionOptions,
  AiAssistantActionTarget,
  AiConversationMessage,
  AiConversationSession,
  AiVoiceInputMeta,
  AssistantStructuredResponse,
  CreateSessionInput,
  PresetQuestion,
} from './types';
import { readAiConfigFromFile } from './ai-config.util';

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helmService: HelmService,
  ) {}

  private static readonly CLUSTER_CONTEXT_KEYS = [
    'clusterId',
    'namespace',
    'resourceKind',
    'resourceName',
  ] as const;

  private readonly presetQuestions: PresetQuestion[] = [
    {
      id: 'preset-critical-pod-restart',
      title: '告警摘要：Pod 重启异常',
      question:
        '请总结最近 30 分钟内 Pod 重启异常的影响范围、严重级别与优先处理建议。',
      category: '告警分析',
    },
    {
      id: 'preset-image-pullbackoff',
      title: '故障定位：镜像拉取失败',
      question:
        'ImagePullBackOff 持续出现时，应如何快速定位根因并给出处理动作？',
      category: '故障定位',
    },
    {
      id: 'preset-cpu-throttle',
      title: '容量分析：CPU 限流热点',
      question:
        '请分析 CPU throttling 高的名称空间与工作负载，并给出资源优化建议。',
      category: '容量与成本',
    },
    {
      id: 'preset-release-risk',
      title: '发布风险：灰度阶段告警收敛',
      question: '请基于近期事件给出本次灰度发布风险评级和回滚建议。',
      category: '发布风险',
    },
  ];

  getPresets(): PresetQuestion[] {
    return this.getPresetQuestions();
  }

  getPresetQuestions(): PresetQuestion[] {
    return [...this.presetQuestions];
  }

  async createSession(
    input: CreateSessionInput = {},
  ): Promise<AiConversationSession> {
    const ownerUserId = this.requireOwnerUserId(input.ownerUserId);
    const created = await this.prisma.aiConversationSession.create({
      data: {
        ownerUserId,
        title: input.title?.trim() || 'AI 告警会话',
        surface: input.surface?.trim() || 'shared',
        clusterContextJson: this.buildClusterContext(input),
      },
    });

    if (input.message?.trim()) {
      await this.appendUserAndReply(
        ownerUserId,
        created.id,
        input.message,
        input.attachments,
        input.voiceInput,
      );
      return this.getSession(ownerUserId, created.id);
    }

    if (input.presetQuestionId) {
      const preset = this.presetQuestions.find(
        (item) => item.id === input.presetQuestionId,
      );
      if (preset) {
        await this.appendUserAndReply(ownerUserId, created.id, preset.question);
        return this.getSession(ownerUserId, created.id);
      }
    }

    return this.mapSession(created, []);
  }

  async listSessions(ownerUserId?: string): Promise<AiConversationSession[]> {
    const normalizedOwnerUserId = this.requireOwnerUserId(ownerUserId);
    const sessions = await this.prisma.aiConversationSession.findMany({
      where: {
        ownerUserId: normalizedOwnerUserId,
        deletedAt: null,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return sessions.map((session) =>
      this.mapSession(session, session.messages),
    );
  }

  async deleteSession(
    ownerUserId: string | undefined,
    sessionId: string,
  ): Promise<{ deleted: boolean; sessionId: string }> {
    const session = await this.requireSession(ownerUserId, sessionId);
    await this.prisma.aiConversationSession.delete({
      where: { id: session.id },
    });
    return { deleted: true, sessionId };
  }

  async getSession(
    ownerUserId: string | undefined,
    sessionId: string,
  ): Promise<AiConversationSession> {
    const session = await this.requireSession(ownerUserId, sessionId);
    const messages = await this.prisma.aiConversationMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return this.mapSession(session, messages);
  }

  getSessionHistory(
    ownerUserId: string | undefined,
    sessionId: string,
  ): Promise<AiConversationSession> {
    return this.getSession(ownerUserId, sessionId);
  }

  async appendUserMessage(
    ownerUserId: string | undefined,
    sessionId: string,
    content: string,
    attachments?: AiMessageAttachment[],
    voiceInput?: AiVoiceInputMeta,
  ): Promise<AiConversationMessage> {
    const session = await this.requireSession(ownerUserId, sessionId);
    const cleanContent = content.trim();
    if (!cleanContent) {
      throw new BadRequestException('用户消息不能为空');
    }

    const createdAt = new Date();
    const message = await this.prisma.aiConversationMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: cleanContent,
        attachmentsJson:
          attachments
            ?.filter((item) => item.fileName && item.mimeType)
            .map((item) => ({ ...item })) ?? undefined,
        voiceInputJson: voiceInput ? { ...voiceInput } : undefined,
        createdAt,
      },
    });
    await this.prisma.aiConversationSession.update({
      where: { id: session.id },
      data: { updatedAt: createdAt },
    });
    return this.mapMessage(message);
  }

  async generateAssistantMessage(
    ownerUserId: string | undefined,
    sessionId: string,
  ): Promise<AiConversationMessage> {
    const sessionRecord = await this.requireSession(ownerUserId, sessionId);
    const messageRecords = await this.prisma.aiConversationMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    const session = this.mapSession(sessionRecord, messageRecords);
    const latestUserPrompt = [...session.messages]
      .reverse()
      .find((item) => item.role === 'user')
      ?.content?.trim();

    const clusterContext = await this.resolveEffectiveClusterContext(
      ownerUserId,
      sessionRecord,
      latestUserPrompt,
    );
    const systemAppend = await this.buildClusterAwareSystemAppend(
      clusterContext,
      latestUserPrompt,
    );
    let content = '';
    let structured: AssistantStructuredResponse | undefined = latestUserPrompt
      ? this.buildStructuredResponse(latestUserPrompt)
      : undefined;
    let actionDescriptors: AiActionDescriptor[] = latestUserPrompt
      ? this.buildActionDescriptors(
          latestUserPrompt,
          structured!,
          clusterContext,
        )
      : [];

    try {
      content = await this.callLLM(session.messages, { systemAppend });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : '模型中转站调用失败';
      content = [
        '⚠️ AIOps中台模型调用失败',
        '',
        reason,
        '',
        '请检查模型中转站配置（Base URL / API Key / Model）和网络连通性。',
      ].join('\n');
      if (systemAppend?.includes('## 集群实时查询结果')) {
        content = `${content}\n\n${systemAppend}`;
      }
      if (!structured || actionDescriptors.length === 0) {
        structured = latestUserPrompt
          ? this.buildStructuredResponse(latestUserPrompt)
          : undefined;
        actionDescriptors =
          latestUserPrompt && structured
            ? this.buildActionDescriptors(
                latestUserPrompt,
                structured,
                clusterContext,
              )
            : [];
      }
      if (structured) {
        content = `${content}\n\n${this.buildAssistantText(structured)}`;
      }
    }

    const createdAt = new Date();
    const message = await this.prisma.aiConversationMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content,
        structuredJson: structured ? this.toJsonValue(structured) : undefined,
        actionDescriptorsJson: this.toJsonValue(actionDescriptors),
        createdAt,
      },
    });
    await this.prisma.aiConversationSession.update({
      where: { id: sessionId },
      data: { updatedAt: createdAt },
    });
    return this.mapMessage(message);
  }

  async appendUserAndReply(
    ownerUserId: string | undefined,
    sessionId: string,
    content: string,
    attachments?: AiMessageAttachment[],
    voiceInput?: AiVoiceInputMeta,
    context?: Pick<
      CreateSessionInput,
      'clusterId' | 'namespace' | 'resourceKind' | 'resourceName'
    >,
  ): Promise<{
    user: AiConversationMessage;
    assistant: AiConversationMessage;
    session: AiConversationSession;
    actionDescriptors: AiActionDescriptor[];
  }> {
    if (context) {
      const nextContext = this.buildClusterContext(context);
      if (nextContext) {
        await this.prisma.aiConversationSession.update({
          where: { id: sessionId },
          data: { clusterContextJson: nextContext },
        });
      }
    }
    const user = await this.appendUserMessage(
      ownerUserId,
      sessionId,
      content,
      attachments,
      voiceInput,
    );
    const assistant = await this.generateAssistantMessage(
      ownerUserId,
      sessionId,
    );
    const session = await this.getSession(ownerUserId, sessionId);
    const actionDescriptors = assistant.actionDescriptors ?? [];

    return { user, assistant, session, actionDescriptors };
  }

  async sendMessage(
    ownerUserId: string | undefined,
    sessionId: string,
    body: {
      message: string;
      clusterId?: string;
      namespace?: string;
      resourceKind?: string;
      resourceName?: string;
    },
  ): Promise<{
    sessionId: string;
    userMessage: AiConversationMessage;
    assistantMessage: AiConversationMessage;
    structured: AssistantStructuredResponse;
    actionDescriptors: AiActionDescriptor[];
  }> {
    const { user, assistant } = await this.appendUserAndReply(
      ownerUserId,
      sessionId,
      body.message,
      undefined,
      undefined,
      {
        clusterId: body.clusterId,
        namespace: body.namespace,
        resourceKind: body.resourceKind,
        resourceName: body.resourceName,
      },
    );
    const structured: AssistantStructuredResponse = assistant.structured ?? {
      summary: assistant.content.slice(0, 140),
      severity: 'info',
      impactedResources: [],
      recommendations: [],
      actions: [],
    };
    return {
      sessionId,
      userMessage: user,
      assistantMessage: assistant,
      structured,
      actionDescriptors: assistant.actionDescriptors ?? [],
    };
  }

  /**
   * 调用 LLM API（OpenAI 兼容格式）。
   * 每次调用时从文件直接读取最新配置，支持热更新（无需重启进程）。
   * 调用失败时抛出明确异常，禁止静默回退到本地 mock。
   */
  private async callLLM(
    history: AiConversationMessage[],
    opts?: { systemAppend?: string },
  ): Promise<string> {
    // 每次调用重新从文件读取，确保配置热更新无需重启
    const config = readAiConfigFromFile();
    const { baseUrl, apiKey, modelName: model } = config;
    const effectiveMaxTokens = Math.max(
      512,
      Number.isFinite(Number(config.maxTokens)) ? Number(config.maxTokens) : 0,
    );
    const timeoutMs = Math.max(20000, config.timeoutMs || 30000);

    if (!apiKey) {
      throw new BadRequestException(
        'AI_MODEL_API_KEY 未配置，请在 AIOps中台模型设置中填写 API Key。',
      );
    }

    const systemPrompt = [
      '你是一位专业的 Kubernetes AIOps 智能运维助手，运行于企业级 K8s 管理平台。',
      '',
      '## 能力范围',
      '- **集群状态分析**：解读 Node/Pod/Deployment/StatefulSet 健康状态，识别异常模式',
      '- **告警根因分析**：关联告警时间线与变更记录，定位 OOMKilled、CrashLoopBackOff、ImagePullBackOff 等常见故障',
      '- **资源配置建议**：分析 CPU/内存 requests/limits 设置，给出基于 p95 使用率的优化方案',
      '- **Pod 故障排查**：指导用户执行 kubectl describe/logs 排查步骤，解读 Events 与错误日志',
      '- **性能优化**：HPA/VPA 配置、节点亲和性、PDB 设置、镜像分层优化等建议',
      '- **发布风险评估**：灰度发布阶段告警收敛分析，回滚时机判断',
      '',
      '## 回答规范',
      '1. 使用简洁清晰的**中文**，重要结论使用 Markdown 标题/加粗/列表结构化呈现。',
      '2. 给出可直接执行的 kubectl 命令或配置片段（用代码块包裹）。',
      '3. 涉及集群变更操作时，在操作前明确标注风险等级（低/中/高/严重）。',
      '4. 若用户描述不完整，主动询问：名称空间、工作负载名、错误日志、集群版本等关键上下文。',
      '5. 对于超出 K8s 运维范围的问题，礼貌说明并引导回运维相关话题。',
      ...(opts?.systemAppend?.trim() ? ['', opts.systemAppend.trim()] : []),
    ].join('\n');

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    ];

    const attempts = this.resolveModelEndpoints(baseUrl);
    const errors: string[] = [];

    for (const attempt of attempts) {
      const maxAttemptRetry = 2;
      for (let retryIndex = 0; retryIndex < maxAttemptRetry; retryIndex += 1) {
        const abortController = new AbortController();
        const timer = setTimeout(() => abortController.abort(), timeoutMs);
        try {
          const response = await fetch(attempt.url, {
            method: 'POST',
            signal: abortController.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(
              attempt.kind === 'chat'
                ? {
                    model,
                    messages,
                    max_tokens: effectiveMaxTokens,
                    temperature: 0.7,
                  }
                : {
                    model,
                    input: messages.map((msg) => ({
                      role: msg.role,
                      content: [
                        {
                          type:
                            msg.role === 'assistant'
                              ? 'output_text'
                              : 'input_text',
                          text: msg.content,
                        },
                      ],
                    })),
                    max_output_tokens: effectiveMaxTokens,
                  },
            ),
          });

          const parsed = await this.parseModelResponse(response);
          if (!response.ok) {
            const errorText = this.extractErrorText(parsed);
            errors.push(
              `[${attempt.kind}] ${attempt.url} -> ${response.status} ${response.statusText}${
                errorText ? ` (${errorText})` : ''
              }`,
            );
            continue;
          }

          if (attempt.kind === 'chat') {
            if (parsed.format !== 'json') {
              errors.push(
                `[chat] ${attempt.url} -> unexpected content-type ${parsed.contentType} (${parsed.preview})`,
              );
              continue;
            }
            const data = parsed.data as {
              choices?: Array<{ message?: { content?: string } }>;
            };
            const content = data.choices?.[0]?.message?.content?.trim();
            if (content) {
              return content;
            }
            errors.push(`[chat] ${attempt.url} -> empty content`);
            break;
          }

          if (parsed.format !== 'json') {
            errors.push(
              `[responses] ${attempt.url} -> unexpected content-type ${parsed.contentType} (${parsed.preview})`,
            );
            continue;
          }

          const data = parsed.data as {
            output_text?: string;
            output?: Array<{
              content?: Array<{ type?: string; text?: string }>;
            }>;
          };
          const outputText =
            data.output_text?.trim() ||
            data.output
              ?.flatMap((item) => item.content ?? [])
              .map((item) => item.text ?? '')
              .join('\n')
              .trim();
          if (outputText) {
            return outputText;
          }
          errors.push(`[responses] ${attempt.url} -> empty content`);
          break;
        } catch (err) {
          if (
            err instanceof Error &&
            (err.name === 'AbortError' || err.message.includes('aborted'))
          ) {
            if (retryIndex < maxAttemptRetry - 1) {
              errors.push(
                `[${attempt.kind}] ${attempt.url} -> timeout>${timeoutMs}ms, retrying`,
              );
              continue;
            }
            errors.push(
              `[${attempt.kind}] ${attempt.url} -> timeout>${timeoutMs}ms`,
            );
            break;
          }
          errors.push(
            `[${attempt.kind}] ${attempt.url} -> ${(err as Error).message}`,
          );
          break;
        } finally {
          clearTimeout(timer);
        }
      }
    }

    const detail = errors.join(' | ');
    this.logger.error(`callLLM failed: ${detail}`);
    throw new ServiceUnavailableException(
      `模型中转站调用失败，请检查 Base URL / API Key / Model。详情：${detail}`,
    );
  }

  private resolveChatCompletionsEndpoint(baseUrl: string): string {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    return normalizedBaseUrl.endsWith('/chat/completions')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/chat/completions`;
  }

  private resolveResponsesEndpoint(baseUrl: string): string {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    return normalizedBaseUrl.endsWith('/responses')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/responses`;
  }

  private resolveModelEndpoints(
    baseUrl: string,
  ): Array<{ kind: 'chat' | 'responses'; url: string }> {
    const baseCandidates = this.resolveBaseUrlCandidates(baseUrl);
    const dedup = new Set<string>();
    const endpoints: Array<{ kind: 'chat' | 'responses'; url: string }> = [];

    for (const candidate of baseCandidates) {
      if (candidate.endsWith('/chat/completions')) {
        if (!dedup.has(candidate)) {
          dedup.add(candidate);
          endpoints.push({ kind: 'chat', url: candidate });
        }
        continue;
      }
      if (candidate.endsWith('/responses')) {
        if (!dedup.has(candidate)) {
          dedup.add(candidate);
          endpoints.push({ kind: 'responses', url: candidate });
        }
        continue;
      }

      const chatUrl = this.resolveChatCompletionsEndpoint(candidate);
      if (!dedup.has(chatUrl)) {
        dedup.add(chatUrl);
        endpoints.push({ kind: 'chat', url: chatUrl });
      }
      const responsesUrl = this.resolveResponsesEndpoint(candidate);
      if (!dedup.has(responsesUrl)) {
        dedup.add(responsesUrl);
        endpoints.push({ kind: 'responses', url: responsesUrl });
      }
    }

    return endpoints;
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  private resolveBaseUrlCandidates(baseUrl: string): string[] {
    const normalized = this.normalizeBaseUrl(baseUrl);
    if (
      normalized.endsWith('/chat/completions') ||
      normalized.endsWith('/responses')
    ) {
      const root = normalized
        .replace(/\/chat\/completions$/, '')
        .replace(/\/responses$/, '');
      return [normalized, root];
    }

    if (normalized.endsWith('/v1')) {
      return [normalized];
    }

    return [`${normalized}/v1`];
  }

  private async parseModelResponse(response: Response): Promise<{
    format: 'json' | 'text';
    data: unknown;
    contentType: string;
    preview: string;
  }> {
    const contentType =
      response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) {
      try {
        const data: unknown = await response.json();
        return {
          format: 'json',
          data,
          contentType,
          preview: '',
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'invalid json';
        return {
          format: 'text',
          data: null,
          contentType,
          preview: `invalid-json: ${reason}`,
        };
      }
    }

    const text = await response.text().catch(() => '');
    return {
      format: 'text',
      data: text,
      contentType: contentType || 'unknown',
      preview: this.limitErrorSnippet(text),
    };
  }

  private extractErrorText(parsed: {
    format: 'json' | 'text';
    data: unknown;
    preview: string;
  }): string {
    if (
      parsed.format === 'json' &&
      parsed.data &&
      typeof parsed.data === 'object'
    ) {
      const errorRecord = parsed.data as {
        message?: string;
        error?: { message?: string } | string;
      };
      if (
        typeof errorRecord.message === 'string' &&
        errorRecord.message.trim()
      ) {
        return this.limitErrorSnippet(errorRecord.message);
      }
      if (typeof errorRecord.error === 'string' && errorRecord.error.trim()) {
        return this.limitErrorSnippet(errorRecord.error);
      }
      if (
        errorRecord.error &&
        typeof errorRecord.error === 'object' &&
        typeof errorRecord.error.message === 'string'
      ) {
        return this.limitErrorSnippet(errorRecord.error.message);
      }
      return this.limitErrorSnippet(JSON.stringify(parsed.data));
    }
    if (
      typeof parsed.data === 'string' ||
      typeof parsed.data === 'number' ||
      typeof parsed.data === 'boolean'
    ) {
      return this.limitErrorSnippet(String(parsed.data));
    }
    return this.limitErrorSnippet(parsed.preview || '');
  }

  private limitErrorSnippet(value: string): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact) {
      return '';
    }
    return compact.length > 280 ? `${compact.slice(0, 280)}...` : compact;
  }

  /**
   * 测试 LLM 连通性：发送一条简单消息并返回响应内容。
   * 如果未配置 apiKey，抛出错误。
   * 如果调用失败，返回包含错误信息的字符串。
   */
  async testLlmConnection(): Promise<string> {
    const { apiKey } = readAiConfigFromFile();
    if (!apiKey) {
      throw new Error('AI_MODEL_API_KEY 未配置，请先在配置页面填写 API Key。');
    }
    const testHistory: AiConversationMessage[] = [
      {
        id: 'ping-test',
        role: 'user',
        content: '请用一句话介绍你自己。',
        createdAt: new Date().toISOString(),
      },
    ];
    return this.callLLM(testHistory);
  }

  private buildStructuredResponse(prompt: string): AssistantStructuredResponse {
    const text = prompt.toLowerCase();

    if (text.includes('imagepullbackoff') || text.includes('镜像')) {
      return {
        summary:
          '多个工作负载出现镜像拉取失败，核心风险为新版本副本不可用导致服务容量下降。',
        severity: 'high',
        impactedResources: [
          'Deployment/payment-api',
          'Deployment/order-worker',
          'Namespace/prod',
        ],
        recommendations: [
          '核对镜像仓库凭据与镜像 tag 是否一致',
          '检查节点到镜像仓库网络连通性与 DNS 解析',
          '优先恢复核心交易链路的副本可用性',
        ],
        actions: [
          '补充/更新 imagePullSecrets',
          '回滚到最近稳定镜像版本',
          '对拉取失败节点执行隔离与替换',
        ],
      };
    }

    if (
      text.includes('cpu') ||
      text.includes('throttle') ||
      text.includes('限流')
    ) {
      return {
        summary:
          '集群存在持续 CPU 限流热点，导致请求延迟抬升与批处理队列堆积。',
        severity: 'medium',
        impactedResources: [
          'Namespace/aiops',
          'Deployment/metrics-collector',
          'StatefulSet/log-indexer',
        ],
        recommendations: [
          '按近 1 小时 p95 使用率调整 requests/limits',
          '为批处理任务增加错峰与并发上限控制',
          '评估节点池扩容与自动伸缩阈值',
        ],
        actions: [
          '上调关键组件 CPU requests',
          '启用 HPA 目标利用率 65%',
          '迁移非核心任务到低优先级节点池',
        ],
      };
    }

    if (
      text.includes('重启') ||
      text.includes('crash') ||
      text.includes('oom')
    ) {
      return {
        summary:
          '关键业务 Pod 在短时间内反复重启，存在服务稳定性下降与错误率升高风险。',
        severity: 'critical',
        impactedResources: [
          'Deployment/gateway',
          'Deployment/auth-service',
          'Namespace/prod',
        ],
        recommendations: [
          '优先排查 OOMKilled 与探针失败日志',
          '冻结高风险发布并锁定变更窗口',
          '对核心流量入口启用降级保护策略',
        ],
        actions: [
          '扩容副本并提升内存上限',
          '回滚最近一次变更',
          '对异常节点执行驱逐与替换',
        ],
      };
    }

    if (
      text.includes('发布') ||
      text.includes('回滚') ||
      text.includes('灰度')
    ) {
      return {
        summary:
          '灰度发布阶段告警未收敛，当前风险高于基线，建议进入受控发布或回滚流程。',
        severity: 'high',
        impactedResources: [
          'Canary/release-v2',
          'Service/api-gateway',
          'Namespace/staging',
        ],
        recommendations: [
          '按业务指标与错误预算联合评估继续发布条件',
          '缩小灰度流量比例并延长观察窗口',
          '预置一键回滚与流量切换脚本',
        ],
        actions: [
          '将灰度流量下调至 5%',
          '触发回滚预案演练',
          '补充关键 SLO 告警阈值',
        ],
      };
    }

    return {
      summary: '告警已触发，当前需要先完成影响面收敛，再按优先级执行根因定位。',
      severity: 'medium',
      impactedResources: ['Namespace/default', 'Deployment/app-core'],
      recommendations: [
        '先确认告警时间线与变更记录关联',
        '优先处理用户面可感知故障',
        '对同类告警建立去重与聚合规则',
      ],
      actions: [
        '生成 30 分钟内事件摘要',
        '指派当班 SRE 建立处置记录',
        '在会话中补充更多上下文用于二次分析',
      ],
    };
  }

  private buildAssistantText(structured: AssistantStructuredResponse): string {
    return [
      `告警摘要：${structured.summary}`,
      `严重级别：${structured.severity}`,
      `影响资源：${structured.impactedResources.join('、')}`,
      `建议：${structured.recommendations.join('；')}`,
      `执行动作：${structured.actions.join('；')}`,
    ].join('\n');
  }

  private buildActionDescriptors(
    prompt: string,
    structured: AssistantStructuredResponse,
    clusterContext?: Record<string, string>,
  ): AiActionDescriptor[] {
    const text = prompt.toLowerCase();
    const actions: AiActionDescriptor[] = [];
    const risk = this.toRiskLevel(structured.severity);
    const primaryResource = structured.impactedResources[0];
    const vmTarget = this.extractVmTarget(prompt);
    const vmProvider = this.extractVmProvider(prompt);
    const primaryResourceRef = this.parseResourceRef(primaryResource);
    const defaultClusterId = clusterContext?.clusterId?.trim();
    const defaultNamespace = clusterContext?.namespace?.trim();

    const queryTarget: AiAssistantActionTarget | undefined =
      defaultClusterId || defaultNamespace
        ? {
            ...(defaultClusterId ? { clusterId: defaultClusterId } : {}),
            ...(defaultNamespace ? { namespace: defaultNamespace } : {}),
          }
        : undefined;
    const namespacedQueryOptions: AiAssistantActionOptions | undefined =
      defaultNamespace
        ? { namespace: defaultNamespace, limit: 20 }
        : { limit: 20 };
    const clusterQueryOptions: AiAssistantActionOptions = { limit: 20 };

    const hasPVC =
      text.includes('pvc') ||
      text.includes('persistentvolumeclaim') ||
      text.includes('卷声明');
    const hasPV =
      text.includes('pv') ||
      text.includes('persistentvolume') ||
      text.includes('持久卷');
    const hasStorageClass =
      text.includes('storageclass') ||
      /\bsc\b/.test(text) ||
      text.includes('存储类');
    const hasConfigMap =
      text.includes('configmap') ||
      /\bcm\b/.test(text) ||
      text.includes('配置');
    const hasHelm =
      text.includes('helm') ||
      text.includes('chart') ||
      text.includes('release') ||
      text.includes('仓库');
    const hasHelmRepositoryIntent =
      text.includes('repo') ||
      text.includes('repository') ||
      text.includes('仓库') ||
      text.includes('chart源') ||
      text.includes('源');
    const hasHelmSearchIntent =
      text.includes('搜索') ||
      text.includes('查找') ||
      text.includes('search') ||
      text.includes('find');
    const helmKeyword = this.extractHelmSearchKeyword(prompt);
    const suggestedPresetNames = this.derivePresetNamesFromKeyword(helmKeyword);

    if (hasHelm && (hasHelmRepositoryIntent || hasHelmSearchIntent)) {
      const helmQueryOptions: AiAssistantActionOptions = {
        limit: 20,
        ...(helmKeyword ? { keyword: helmKeyword } : {}),
      };
      actions.push(
        {
          id: this.createId('action'),
          label: helmKeyword
            ? `搜索 Helm 仓库/Chart（关键词：${helmKeyword}）`
            : '查询 Helm 仓库与 Chart',
          kind: 'resource-operation',
          routePath: '/workloads/helm/repositories',
          operation: 'query-helm-repositories',
          target: queryTarget,
          options: helmQueryOptions,
          riskLevel: 'low',
        },
        {
          id: this.createId('action'),
          label:
            suggestedPresetNames.length > 0
              ? `导入模板仓库并同步（${suggestedPresetNames.join('、')}）`
              : '导入常用模板仓库并同步',
          kind: 'resource-operation',
          routePath: '/workloads/helm/repositories',
          operation: 'import-helm-repository-presets',
          target: queryTarget,
          options: {
            ...(suggestedPresetNames.length > 0
              ? { presetNames: suggestedPresetNames }
              : {}),
            sync: true,
          },
          confirmation: {
            required: true,
            title: '确认导入 Helm 模板仓库',
            summary: '将写入仓库配置并同步索引，请确认集群上下文。',
          },
          riskLevel: 'medium',
        },
        {
          id: this.createId('action'),
          label: '查询 Helm Release 列表',
          kind: 'resource-operation',
          routePath: '/workloads/helm',
          operation: 'query-helm-releases',
          target: queryTarget,
          options: namespacedQueryOptions,
          riskLevel: 'low',
        },
        {
          id: this.createId('action'),
          label: '跳转到 Helm 仓库页面',
          kind: 'navigate',
          routePath: '/workloads/helm/repositories',
          riskLevel: 'low',
        },
      );
      return actions;
    }

    if (hasHelm) {
      actions.push(
        {
          id: this.createId('action'),
          label: '查询 Helm Release 列表',
          kind: 'resource-operation',
          routePath: '/workloads/helm',
          operation: 'query-helm-releases',
          target: queryTarget,
          options: namespacedQueryOptions,
          riskLevel: 'low',
        },
        {
          id: this.createId('action'),
          label: '跳转到 Helm 应用页面',
          kind: 'navigate',
          routePath: '/workloads/helm',
          riskLevel: 'low',
        },
      );
      return actions;
    }

    if (
      hasPVC &&
      (hasPV || text.includes('绑定') || text.includes('claimref'))
    ) {
      actions.push(
        {
          id: this.createId('action'),
          label: '查询 PV/PVC 绑定关系',
          kind: 'resource-operation',
          routePath: '/storage/pvc',
          operation: 'query-pv-pvc-bindings',
          target: queryTarget,
          options: namespacedQueryOptions,
          riskLevel: 'low',
        },
        {
          id: this.createId('action'),
          label: '查看 PVC 列表',
          kind: 'navigate',
          routePath: '/storage/pvc',
          riskLevel: 'low',
        },
      );
      return actions;
    }

    if (hasPVC) {
      actions.push(
        {
          id: this.createId('action'),
          label: '查询 PVC 列表',
          kind: 'resource-operation',
          routePath: '/storage/pvc',
          operation: 'query-pvcs',
          target: queryTarget,
          options: namespacedQueryOptions,
          riskLevel: 'low',
        },
        {
          id: this.createId('action'),
          label: '跳转到 PVC 页面',
          kind: 'navigate',
          routePath: '/storage/pvc',
          riskLevel: 'low',
        },
      );
      return actions;
    }

    if (hasStorageClass) {
      actions.push(
        {
          id: this.createId('action'),
          label: '查询 StorageClass 列表',
          kind: 'resource-operation',
          routePath: '/storage/sc',
          operation: 'query-storageclasses',
          target: queryTarget,
          options: clusterQueryOptions,
          riskLevel: 'low',
        },
        {
          id: this.createId('action'),
          label: '跳转到 StorageClass 页面',
          kind: 'navigate',
          routePath: '/storage/sc',
          riskLevel: 'low',
        },
      );
      return actions;
    }

    if (hasConfigMap) {
      actions.push(
        {
          id: this.createId('action'),
          label: '查询 ConfigMap 列表（需 namespace）',
          kind: 'resource-operation',
          routePath: '/configs/configmaps',
          operation: 'query-configmaps',
          target: queryTarget,
          options: namespacedQueryOptions,
          riskLevel: 'low',
        },
        {
          id: this.createId('action'),
          label: '跳转到 ConfigMap 页面',
          kind: 'navigate',
          routePath: '/configs/configmaps',
          riskLevel: 'low',
        },
      );
      return actions;
    }

    const hasVmContext =
      text.includes('虚拟机') ||
      text.includes('virtual machine') ||
      /\bvm\b/.test(text);
    const vmPowerOnIntent =
      text.includes('power on') ||
      text.includes('turn on') ||
      text.includes('开机') ||
      text.includes('启动') ||
      text.includes('上电');
    const vmPowerOffIntent =
      text.includes('power off') ||
      text.includes('turn off') ||
      text.includes('shutdown') ||
      text.includes('shut down') ||
      text.includes('关机') ||
      text.includes('停机') ||
      text.includes('断电');
    const vmRestartIntent =
      text.includes('restart') ||
      text.includes('reboot') ||
      text.includes('重启');

    if (
      hasVmContext &&
      (vmPowerOnIntent || vmPowerOffIntent || vmRestartIntent)
    ) {
      if (vmPowerOnIntent) {
        actions.push({
          id: this.createId('action'),
          label: vmTarget ? `虚拟机开机（${vmTarget}）` : '执行虚拟机开机',
          kind: 'resource-operation',
          resourceType: 'vm',
          resourceId: vmTarget
            ? `${vmProvider ?? 'provider-unknown'}/${vmTarget}`
            : undefined,
          operation: 'vm-power-on',
          target: {
            ...(defaultClusterId ? { clusterId: defaultClusterId } : {}),
            ...(defaultNamespace ? { namespace: defaultNamespace } : {}),
            ...(vmProvider ? { provider: vmProvider } : {}),
            ...(vmTarget ? { vmId: vmTarget } : {}),
          },
          confirmation: {
            required: true,
            title: '确认执行虚拟机开机',
            summary: '请确认 provider 与 vmId，避免误操作到生产实例。',
          },
          riskLevel: 'medium',
        });
      }
      if (vmPowerOffIntent) {
        actions.push({
          id: this.createId('action'),
          label: vmTarget ? `虚拟机关机（${vmTarget}）` : '执行虚拟机关机',
          kind: 'resource-operation',
          resourceType: 'vm',
          resourceId: vmTarget
            ? `${vmProvider ?? 'provider-unknown'}/${vmTarget}`
            : undefined,
          operation: 'vm-power-off',
          target: {
            ...(defaultClusterId ? { clusterId: defaultClusterId } : {}),
            ...(defaultNamespace ? { namespace: defaultNamespace } : {}),
            ...(vmProvider ? { provider: vmProvider } : {}),
            ...(vmTarget ? { vmId: vmTarget } : {}),
          },
          confirmation: {
            required: true,
            title: '确认执行虚拟机关机',
            summary: '该动作会导致实例不可用，请确认业务影响窗口。',
          },
          riskLevel: 'high',
        });
      }
      if (vmRestartIntent) {
        actions.push({
          id: this.createId('action'),
          label: vmTarget ? `虚拟机重启（${vmTarget}）` : '执行虚拟机重启',
          kind: 'resource-operation',
          resourceType: 'vm',
          resourceId: vmTarget
            ? `${vmProvider ?? 'provider-unknown'}/${vmTarget}`
            : undefined,
          operation: 'vm-restart',
          target: {
            ...(defaultClusterId ? { clusterId: defaultClusterId } : {}),
            ...(defaultNamespace ? { namespace: defaultNamespace } : {}),
            ...(vmProvider ? { provider: vmProvider } : {}),
            ...(vmTarget ? { vmId: vmTarget } : {}),
          },
          confirmation: {
            required: true,
            title: '确认执行虚拟机重启',
            summary: '该动作会中断实例连接，请确认目标实例标识。',
          },
          riskLevel: 'high',
        });
      }
      return actions;
    }

    if (text.includes('镜像') || text.includes('imagepullbackoff')) {
      actions.push(
        {
          id: this.createId('action'),
          label: '跳转到工作负载详情',
          kind: 'navigate',
          routePath: '/workloads/deployments',
          riskLevel: risk,
        },
        {
          id: this.createId('action'),
          label: '筛选 ImagePullBackOff 相关日志',
          kind: 'apply-filter',
          routePath: '/logs',
          filterKey: 'keyword',
          filterValue: 'ImagePullBackOff',
          riskLevel: 'medium',
        },
        {
          id: this.createId('action'),
          label: '查询 Pod 概览',
          kind: 'resource-operation',
          routePath: '/workloads/pods',
          operation: 'query-pods-overview',
          target: queryTarget,
          options: namespacedQueryOptions,
          riskLevel: 'medium',
        },
      );
      return actions;
    }

    if (
      text.includes('cpu') ||
      text.includes('throttle') ||
      text.includes('限流')
    ) {
      actions.push(
        {
          id: this.createId('action'),
          label: '跳转到监控总览',
          kind: 'navigate',
          routePath: '/monitoring',
          riskLevel: 'low',
        },
        {
          id: this.createId('action'),
          label: '查询 Deployment 健康概览',
          kind: 'resource-operation',
          routePath: '/workloads/deployments',
          operation: 'query-deployments-overview',
          target: queryTarget,
          options: namespacedQueryOptions,
          riskLevel: 'medium',
        },
      );
      return actions;
    }

    if (
      text.includes('重启') ||
      text.includes('crash') ||
      text.includes('oom')
    ) {
      actions.push(
        {
          id: this.createId('action'),
          label: '跳转到日志页排查重启原因',
          kind: 'navigate',
          routePath: '/logs',
          riskLevel: 'medium',
        },
        {
          id: this.createId('action'),
          label: '筛选 OOM 与重启相关日志',
          kind: 'apply-filter',
          routePath: '/logs',
          filterKey: 'keyword',
          filterValue: 'OOMKilled',
          riskLevel: 'medium',
        },
        {
          id: this.createId('action'),
          label: '执行工作负载重启',
          kind: 'resource-operation',
          routePath: '/workloads/deployments',
          resourceType: 'workload',
          resourceId: primaryResource,
          operation: 'restart-workload',
          target: {
            ...(defaultClusterId ? { clusterId: defaultClusterId } : {}),
            ...(defaultNamespace ? { namespace: defaultNamespace } : {}),
            kind:
              primaryResourceRef?.kind ??
              clusterContext?.resourceKind ??
              'Deployment',
            name:
              primaryResourceRef?.name ?? clusterContext?.resourceName ?? '',
          },
          confirmation: {
            required: true,
            title: '确认执行工作负载重启',
            summary: '请确认集群、名称空间、资源类型和名称后再执行。',
          },
          riskLevel: 'high',
        },
      );
      return actions;
    }

    if (
      text.includes('发布') ||
      text.includes('回滚') ||
      text.includes('灰度')
    ) {
      actions.push(
        {
          id: this.createId('action'),
          label: '跳转到发布相关工作负载',
          kind: 'navigate',
          routePath: '/workloads/deployments',
          riskLevel: 'medium',
        },
        {
          id: this.createId('action'),
          label: '筛选灰度发布事件',
          kind: 'apply-filter',
          routePath: '/monitoring',
          filterKey: 'keyword',
          filterValue: 'canary',
          riskLevel: 'medium',
        },
        {
          id: this.createId('action'),
          label: '查询节点状态概览',
          kind: 'resource-operation',
          routePath: '/clusters',
          operation: 'query-nodes-overview',
          target: queryTarget,
          options: clusterQueryOptions,
          riskLevel: 'high',
        },
      );
      return actions;
    }

    actions.push(
      {
        id: this.createId('action'),
        label: '跳转到告警监控页',
        kind: 'navigate',
        routePath: '/monitoring',
        riskLevel: 'low',
      },
      {
        id: this.createId('action'),
        label: '查询 Pod 概览',
        kind: 'resource-operation',
        routePath: '/workloads/pods',
        operation: 'query-pods-overview',
        target: queryTarget,
        options: namespacedQueryOptions,
        riskLevel: 'medium',
      },
    );

    return actions;
  }

  private extractHelmSearchKeyword(prompt: string): string | undefined {
    const source = prompt.trim();
    if (!source) {
      return undefined;
    }
    const patterns: RegExp[] = [
      /(?:关键词|关键字|keyword)\s*[:：=]\s*([a-zA-Z0-9._/-]{2,80})/i,
      /(?:repo|repository|仓库|chart)\s*[:：=]\s*([a-zA-Z0-9._/-]{2,80})/i,
      /(?:搜索|查找|search|find)\s*([a-zA-Z0-9._/-]{2,80})/i,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const keyword = match?.[1]?.trim().toLowerCase();
      if (!keyword) {
        continue;
      }
      return keyword;
    }
    return undefined;
  }

  private derivePresetNamesFromKeyword(keyword?: string): string[] {
    const normalized = keyword?.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    const all = new Set<string>();
    if (
      normalized.includes('bitnami') ||
      normalized.includes('mysql') ||
      normalized.includes('redis') ||
      normalized.includes('postgres') ||
      normalized.includes('nginx')
    ) {
      all.add('bitnami');
    }
    if (
      normalized.includes('prometheus') ||
      normalized.includes('alertmanager') ||
      normalized.includes('kube-prometheus')
    ) {
      all.add('prometheus-community');
    }
    if (
      normalized.includes('grafana') ||
      normalized.includes('loki') ||
      normalized.includes('tempo') ||
      normalized.includes('mimir')
    ) {
      all.add('grafana');
    }
    if (
      normalized.includes('ingress') ||
      normalized.includes('ingress-nginx') ||
      normalized.includes('controller')
    ) {
      all.add('ingress-nginx');
    }
    return Array.from(all);
  }

  private extractVmTarget(prompt: string): string | undefined {
    const source = prompt.trim();
    if (!source) {
      return undefined;
    }
    const patterns: RegExp[] = [
      /(?:vm(?:\s+name)?|虚拟机(?:名称|名字)?)[\s:=："'`“”‘’]+([a-zA-Z0-9][a-zA-Z0-9._-]{1,62})/i,
      /([a-zA-Z0-9][a-zA-Z0-9._-]{1,62})[\s"'`“”‘’]*(?:这台)?(?:虚拟机|\bvm\b)/i,
      /(?:target|目标)[\s:=："'`“”‘’]+([a-zA-Z0-9][a-zA-Z0-9._-]{1,62})/i,
    ];
    const stopWords = new Set([
      'power',
      'on',
      'off',
      'restart',
      'reboot',
      'shutdown',
      'start',
      'stop',
      'vm',
      'virtual',
      'machine',
      '虚拟机',
      '开机',
      '关机',
      '重启',
    ]);
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const candidate = match?.[1]?.trim();
      if (!candidate) {
        continue;
      }
      const normalized = candidate
        .replace(/^[\s"'`“”‘’]+/, '')
        .replace(/[\s"'`“”‘’]+$/, '')
        .trim();
      if (!normalized) {
        continue;
      }
      if (stopWords.has(normalized.toLowerCase())) {
        continue;
      }
      return normalized;
    }
    return undefined;
  }

  private extractVmProvider(prompt: string): string | undefined {
    const source = prompt.toLowerCase();
    const providerHints: Array<[RegExp, string]> = [
      [/\baliyun|alicloud|阿里云\b/, 'aliyun'],
      [/\baws|amazon\b/, 'aws'],
      [/\bazure\b/, 'azure'],
      [/\bopenstack\b/, 'openstack'],
      [/\bvsphere|vmware\b/, 'vsphere'],
      [/\bproxmox\b/, 'proxmox'],
      [/\bkvm|qemu\b/, 'kvm'],
    ];
    for (const [pattern, provider] of providerHints) {
      if (pattern.test(source)) {
        return provider;
      }
    }
    return undefined;
  }

  private parseResourceRef(
    value: string | undefined,
  ): { kind: string; name: string } | undefined {
    const source = value?.trim();
    if (!source) {
      return undefined;
    }
    const [kindRaw, nameRaw, ...rest] = source.split('/');
    if (rest.length > 0) {
      return undefined;
    }
    const kind = kindRaw?.trim();
    const name = nameRaw?.trim();
    if (!kind || !name) {
      return undefined;
    }
    return { kind, name };
  }

  private normalizeActionOperationAlias(
    operation: string | undefined,
  ): AiAssistantActionOperation | undefined {
    const normalized = operation?.trim();
    if (!normalized) {
      return undefined;
    }
    if (normalized === 'query-configmaps-overview') {
      return 'query-configmaps';
    }
    if (normalized === 'query-pvc-overview') {
      return 'query-pvcs';
    }
    if (normalized === 'query-storageclass-overview') {
      return 'query-storageclasses';
    }
    if (normalized === 'vm-power-restart') {
      return 'vm-restart';
    }
    return normalized as AiAssistantActionOperation;
  }

  private toRiskLevel(
    severity: AssistantStructuredResponse['severity'],
  ): AiActionDescriptor['riskLevel'] {
    if (severity === 'critical') {
      return 'critical';
    }
    if (severity === 'high') {
      return 'high';
    }
    if (severity === 'low' || severity === 'info') {
      return 'low';
    }
    return 'medium';
  }

  private requireOwnerUserId(ownerUserId?: string): string {
    const normalized = ownerUserId?.trim();
    if (!normalized) {
      throw new UnauthorizedException('未提供有效 AI 会话用户上下文');
    }
    return normalized;
  }

  private buildClusterContext(
    input: CreateSessionInput,
  ): Record<string, string> | undefined {
    const clusterId = input.clusterId?.trim();
    const namespace = input.namespace?.trim();
    const resourceKind = input.resourceKind?.trim();
    const resourceName = input.resourceName?.trim();
    const context = {
      ...(clusterId ? { clusterId } : {}),
      ...(namespace ? { namespace } : {}),
      ...(resourceKind ? { resourceKind } : {}),
      ...(resourceName ? { resourceName } : {}),
    };
    return Object.keys(context).length > 0 ? context : undefined;
  }

  private parseClusterContext(
    value: unknown,
  ): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const input = value as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of AiAssistantService.CLUSTER_CONTEXT_KEYS) {
      const v = input[key];
      if (typeof v === 'string' && v.trim()) {
        out[key] = v.trim();
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private extractNamespaceFromPrompt(
    prompt: string | undefined,
  ): string | undefined {
    const text = prompt?.trim();
    if (!text) {
      return undefined;
    }
    const patterns: RegExp[] = [
      /\bnamespace\s*[:=]\s*([a-z0-9]([a-z0-9-]*[a-z0-9])?)\b/i,
      /\bns\s*[:=]\s*([a-z0-9]([a-z0-9-]*[a-z0-9])?)\b/i,
      /名称空间\s*[:：]?\s*([a-z0-9]([a-z0-9-]*[a-z0-9])?)/i,
    ];
    for (const pattern of patterns) {
      const m = text.match(pattern);
      const ns = m?.[1]?.trim();
      if (ns) {
        return ns;
      }
    }
    return undefined;
  }

  private async resolveEffectiveClusterContext(
    ownerUserId: string | undefined,
    sessionRecord: AiConversationSessionRecord,
    latestUserPrompt: string | undefined,
  ): Promise<Record<string, string> | undefined> {
    const ownerId = this.requireOwnerUserId(ownerUserId);
    const existing = this.parseClusterContext(sessionRecord.clusterContextJson);

    const merged: Record<string, string> = { ...(existing ?? {}) };

    // 1) Try infer namespace from prompt without touching clusterId.
    if (!merged.namespace) {
      const ns = this.extractNamespaceFromPrompt(latestUserPrompt);
      if (ns) {
        merged.namespace = ns;
      }
    }

    // 2) If clusterId missing, reuse last cluster context from user's latest session.
    if (!merged.clusterId) {
      const last = await this.prisma.aiConversationSession.findFirst({
        where: {
          ownerUserId: ownerId,
          deletedAt: null,
          NOT: [{ id: sessionRecord.id }],
        },
        orderBy: { updatedAt: 'desc' },
        select: { clusterContextJson: true },
      });
      const lastCtx = this.parseClusterContext(last?.clusterContextJson);
      if (lastCtx?.clusterId) {
        merged.clusterId = lastCtx.clusterId;
        if (!merged.namespace && lastCtx.namespace) {
          merged.namespace = lastCtx.namespace;
        }
      }
    }

    // 3) If still missing, auto-select when platform has exactly one usable cluster.
    if (!merged.clusterId) {
      const clusters = await this.prisma.clusterRegistry.findMany({
        where: { deletedAt: null, status: { not: 'deleted' } },
        select: { id: true, metadata: true },
      });
      const usable = clusters.filter((c) => {
        if (
          !c.metadata ||
          typeof c.metadata !== 'object' ||
          Array.isArray(c.metadata)
        ) {
          return false;
        }
        const kubeconfig = (c.metadata as Record<string, unknown>).kubeconfig;
        return typeof kubeconfig === 'string' && kubeconfig.trim().length > 0;
      });
      if (usable.length === 1) {
        merged.clusterId = usable[0].id;
      }
    }

    if (Object.keys(merged).length === 0) {
      return undefined;
    }

    const changed = JSON.stringify(existing ?? {}) !== JSON.stringify(merged);
    if (changed) {
      await this.prisma.aiConversationSession.update({
        where: { id: sessionRecord.id },
        data: { clusterContextJson: { ...merged } },
      });
    }

    return merged;
  }

  private async loadKubeClients(clusterId: string): Promise<{
    coreApi: k8s.CoreV1Api;
    storageApi: k8s.StorageV1Api;
  }> {
    const cluster = await this.prisma.clusterRegistry.findUnique({
      where: { id: clusterId },
      select: { id: true, status: true, deletedAt: true, metadata: true },
    });
    if (!cluster || cluster.deletedAt || cluster.status === 'deleted') {
      throw new NotFoundException(`cluster not found: ${clusterId}`);
    }
    if (
      !cluster.metadata ||
      typeof cluster.metadata !== 'object' ||
      Array.isArray(cluster.metadata)
    ) {
      throw new BadRequestException(
        `cluster kubeconfig is not configured: ${clusterId}`,
      );
    }
    const kubeconfig = (cluster.metadata as Record<string, unknown>).kubeconfig;
    if (typeof kubeconfig !== 'string' || !kubeconfig.trim()) {
      throw new BadRequestException(
        `cluster kubeconfig is not configured: ${clusterId}`,
      );
    }

    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeconfig);
    return {
      coreApi: kc.makeApiClient(k8s.CoreV1Api),
      storageApi: kc.makeApiClient(k8s.StorageV1Api),
    };
  }

  private shouldAutoQuery(prompt: string | undefined): {
    pvPvcBindings: boolean;
    pvcs: boolean;
    storageClasses: boolean;
    configMaps: boolean;
    helmRepositories: boolean;
    helmReleases: boolean;
  } {
    const text = (prompt ?? '').toLowerCase();
    const hasPVC =
      text.includes('pvc') ||
      text.includes('persistentvolumeclaim') ||
      text.includes('卷声明');
    const hasPV =
      text.includes('pv') ||
      text.includes('persistentvolume') ||
      text.includes('持久卷');
    const bindings =
      hasPVC &&
      (hasPV ||
        text.includes('绑定') ||
        text.includes('claimref') ||
        text.includes('volume'));
    const storageClasses =
      text.includes('storageclass') ||
      /\bsc\b/.test(text) ||
      text.includes('存储类');
    const configMaps =
      text.includes('configmap') ||
      /\bcm\b/.test(text) ||
      text.includes('配置') ||
      text.includes('config map');
    const hasHelm =
      text.includes('helm') ||
      text.includes('chart') ||
      text.includes('release') ||
      text.includes('仓库');
    const helmRepositories =
      hasHelm &&
      (text.includes('repo') ||
        text.includes('repository') ||
        text.includes('仓库') ||
        text.includes('chart') ||
        text.includes('搜索') ||
        text.includes('查找') ||
        text.includes('search') ||
        text.includes('find'));
    const helmReleases =
      hasHelm &&
      (text.includes('release') ||
        text.includes('发布') ||
        text.includes('安装') ||
        text.includes('升级') ||
        text.includes('回滚') ||
        text.includes('卸载') ||
        text.includes('install') ||
        text.includes('upgrade') ||
        text.includes('rollback') ||
        text.includes('uninstall'));
    return {
      pvPvcBindings: bindings,
      pvcs: hasPVC && !bindings,
      storageClasses,
      configMaps,
      helmRepositories,
      helmReleases,
    };
  }

  private renderMarkdownTable(
    headers: string[],
    rows: Array<Array<string>>,
  ): string {
    const escape = (v: string) => v.replace(/\|/g, '\\|');
    const head = `| ${headers.map(escape).join(' | ')} |`;
    const sep = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows
      .map((r) => `| ${r.map((c) => escape(c)).join(' | ')} |`)
      .join('\n');
    return [head, sep, body].filter(Boolean).join('\n');
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private async buildClusterAwareSystemAppend(
    clusterContext: Record<string, string> | undefined,
    latestUserPrompt: string | undefined,
  ): Promise<string | undefined> {
    const ctx = clusterContext ?? {};
    const clusterId = ctx.clusterId;
    const namespace = ctx.namespace;

    const lines: string[] = [];
    lines.push('## 当前会话上下文');
    lines.push(`- clusterId: ${clusterId ?? '未设置'}`);
    lines.push(`- namespace: ${namespace ?? '未设置'}`);
    if (ctx.resourceKind) {
      lines.push(`- resourceKind: ${ctx.resourceKind}`);
    }
    if (ctx.resourceName) {
      lines.push(`- resourceName: ${ctx.resourceName}`);
    }
    lines.push('');
    lines.push('## 约束与回答要求');
    lines.push(
      '- 当用户提出只读问题且 clusterId 已知时：优先使用下方“集群实时查询结果”作答，不要再泛化追问。',
    );
    lines.push(
      '- 当 clusterId 未设置时：先给出需要的集群/名称空间信息，并列出平台可用的 clusterId 候选（如可获取）。',
    );

    const plan = this.shouldAutoQuery(latestUserPrompt);
    const helmKeyword = this.extractHelmSearchKeyword(latestUserPrompt ?? '');
    if (
      !clusterId ||
      !latestUserPrompt ||
      (!plan.pvPvcBindings &&
        !plan.pvcs &&
        !plan.storageClasses &&
        !plan.configMaps &&
        !plan.helmRepositories &&
        !plan.helmReleases)
    ) {
      if (!clusterId) {
        const clusters = await this.prisma.clusterRegistry.findMany({
          where: { deletedAt: null, status: { not: 'deleted' } },
          select: { id: true },
          take: 20,
        });
        if (clusters.length > 0) {
          lines.push('');
          lines.push('## 平台可用集群（部分）');
          lines.push(clusters.map((c) => `- ${c.id}`).join('\n'));
        }
      }
      return lines.join('\n').trim();
    }

    const queryBlocks: string[] = [];
    const needKubeClients =
      plan.pvPvcBindings || plan.pvcs || plan.storageClasses || plan.configMaps;
    let coreApi: k8s.CoreV1Api | undefined;
    let storageApi: k8s.StorageV1Api | undefined;
    if (needKubeClients) {
      try {
        const clients = await this.loadKubeClients(clusterId);
        coreApi = clients.coreApi;
        storageApi = clients.storageApi;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        queryBlocks.push('### Kubernetes 资源查询');
        queryBlocks.push(`> 查询失败：${reason}`);
      }
    }

    if (plan.pvPvcBindings && coreApi) {
      try {
        const [pvResp, pvcResp] = await Promise.all([
          coreApi.listPersistentVolume(),
          namespace
            ? coreApi.listNamespacedPersistentVolumeClaim({ namespace })
            : coreApi.listPersistentVolumeClaimForAllNamespaces(),
        ]);

        const pvByClaim = new Map<string, k8s.V1PersistentVolume>();
        const pvByName = new Map<string, k8s.V1PersistentVolume>();
        for (const pv of pvResp.items) {
          const name = pv.metadata?.name;
          if (name) {
            pvByName.set(name, pv);
          }
          const claimNs = pv.spec?.claimRef?.namespace;
          const claimName = pv.spec?.claimRef?.name;
          if (claimNs && claimName) {
            pvByClaim.set(`${claimNs}/${claimName}`, pv);
          }
        }

        const rows = pvcResp.items.slice(0, 50).map((pvc) => {
          const ns = pvc.metadata?.namespace ?? 'unknown';
          const name = pvc.metadata?.name ?? 'unknown';
          const pv =
            (pvc.spec?.volumeName
              ? pvByName.get(pvc.spec.volumeName)
              : undefined) ?? pvByClaim.get(`${ns}/${name}`);
          return [
            `${ns}/${name}`,
            pvc.status?.phase ?? 'unknown',
            pv?.metadata?.name ?? pvc.spec?.volumeName ?? '',
            pv?.status?.phase ?? '',
            pvc.spec?.storageClassName ?? pv?.spec?.storageClassName ?? '',
            pvc.spec?.resources?.requests?.storage ?? '',
          ];
        });

        queryBlocks.push('### PV/PVC 绑定关系（样本）');
        queryBlocks.push(
          this.renderMarkdownTable(
            ['PVC', 'PVC Phase', 'PV', 'PV Phase', 'StorageClass', 'Request'],
            rows,
          ),
        );
        queryBlocks.push(
          `> 总计：PV=${pvResp.items.length}，PVC=${pvcResp.items.length}（展示前 ${rows.length} 条）`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        queryBlocks.push('### PV/PVC 绑定关系');
        queryBlocks.push(`> 查询失败：${reason}`);
      }
    } else if (plan.pvPvcBindings && !coreApi) {
      queryBlocks.push('### PV/PVC 绑定关系');
      queryBlocks.push('> 查询失败：Kubernetes API 客户端不可用。');
    }

    if (plan.pvcs && coreApi) {
      try {
        const pvcResp = namespace
          ? await coreApi.listNamespacedPersistentVolumeClaim({ namespace })
          : await coreApi.listPersistentVolumeClaimForAllNamespaces();
        const rows = pvcResp.items
          .slice(0, 50)
          .map((pvc) => [
            `${pvc.metadata?.namespace ?? 'unknown'}/${pvc.metadata?.name ?? 'unknown'}`,
            pvc.status?.phase ?? 'unknown',
            pvc.spec?.storageClassName ?? '',
            pvc.spec?.volumeName ?? '',
            pvc.spec?.resources?.requests?.storage ?? '',
          ]);
        queryBlocks.push('### PVC 列表（样本）');
        queryBlocks.push(
          this.renderMarkdownTable(
            ['PVC', 'Phase', 'StorageClass', 'PV', 'Request'],
            rows,
          ),
        );
        queryBlocks.push(
          `> 总计：PVC=${pvcResp.items.length}（展示前 ${rows.length} 条）`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        queryBlocks.push('### PVC 列表');
        queryBlocks.push(`> 查询失败：${reason}`);
      }
    } else if (plan.pvcs && !coreApi) {
      queryBlocks.push('### PVC 列表');
      queryBlocks.push('> 查询失败：Kubernetes API 客户端不可用。');
    }

    if (plan.storageClasses && storageApi) {
      try {
        const resp = await storageApi.listStorageClass();
        const rows = resp.items.slice(0, 50).map((sc) => {
          const annotations = sc.metadata?.annotations ?? {};
          const isDefault =
            annotations['storageclass.kubernetes.io/is-default-class'] ===
              'true' ||
            annotations['storageclass.beta.kubernetes.io/is-default-class'] ===
              'true';
          return [
            sc.metadata?.name ?? 'unknown',
            sc.provisioner ?? 'unknown',
            sc.volumeBindingMode ?? '',
            String(sc.allowVolumeExpansion ?? false),
            isDefault ? 'default' : '',
          ];
        });
        queryBlocks.push('### StorageClass 列表（样本）');
        queryBlocks.push(
          this.renderMarkdownTable(
            ['Name', 'Provisioner', 'BindingMode', 'Expand', 'Default'],
            rows,
          ),
        );
        queryBlocks.push(
          `> 总计：StorageClass=${resp.items.length}（展示前 ${rows.length} 条）`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        queryBlocks.push('### StorageClass 列表');
        queryBlocks.push(`> 查询失败：${reason}`);
      }
    } else if (plan.storageClasses && !storageApi) {
      queryBlocks.push('### StorageClass 列表');
      queryBlocks.push('> 查询失败：Kubernetes API 客户端不可用。');
    }

    if (plan.configMaps && coreApi) {
      if (!namespace) {
        queryBlocks.push('### ConfigMap 列表');
        queryBlocks.push(
          '> 需要 namespace 才能查询 ConfigMap。请补充名称空间。',
        );
      } else {
        try {
          const resp = await coreApi.listNamespacedConfigMap({ namespace });
          const rows = resp.items
            .slice(0, 50)
            .map((cm) => [
              `${cm.metadata?.namespace ?? 'unknown'}/${cm.metadata?.name ?? 'unknown'}`,
              String(Object.keys(cm.data ?? {}).length),
            ]);
          queryBlocks.push('### ConfigMap 列表（样本）');
          queryBlocks.push(
            this.renderMarkdownTable(['ConfigMap', 'Data Keys'], rows),
          );
          queryBlocks.push(
            `> 总计：ConfigMap=${resp.items.length}（展示前 ${rows.length} 条）`,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          queryBlocks.push('### ConfigMap 列表');
          queryBlocks.push(`> 查询失败：${reason}`);
        }
      }
    } else if (plan.configMaps && !coreApi) {
      queryBlocks.push('### ConfigMap 列表');
      queryBlocks.push('> 查询失败：Kubernetes API 客户端不可用。');
    }

    if (plan.helmRepositories) {
      try {
        const repositoriesPayload = (await this.helmService.listRepositories({
          clusterId,
        })) as unknown;
        const repositoryItems = Array.isArray(
          this.asRecord(repositoriesPayload).items,
        )
          ? (this.asRecord(repositoriesPayload).items as unknown[])
          : [];
        const repositories = repositoryItems
          .map((item) => this.asRecord(item))
          .filter((item) => {
            if (!helmKeyword) {
              return true;
            }
            const name = this.asString(item.name).toLowerCase();
            const url = this.asString(item.url).toLowerCase();
            const message = this.asString(item.message).toLowerCase();
            return (
              name.includes(helmKeyword) ||
              url.includes(helmKeyword) ||
              message.includes(helmKeyword)
            );
          });
        const repositoryRows = repositories
          .slice(0, 50)
          .map((item) => [
            this.asString(item.name) || '-',
            this.asString(item.url) || '-',
            this.asString(item.syncStatus) || '-',
            this.asString(item.lastSyncAt) || '-',
          ]);
        queryBlocks.push('### Helm 仓库列表（样本）');
        queryBlocks.push(
          this.renderMarkdownTable(
            ['Repository', 'URL', 'SyncStatus', 'LastSyncAt'],
            repositoryRows,
          ),
        );
        queryBlocks.push(
          `> 总计：Helm Repository=${repositories.length}（展示前 ${repositoryRows.length} 条）`,
        );

        if (repositories.length > 0) {
          try {
            const chartsPayload = (await this.helmService.listCharts({
              clusterId,
              ...(helmKeyword ? { keyword: helmKeyword } : {}),
            })) as unknown;
            const chartItems = Array.isArray(this.asRecord(chartsPayload).items)
              ? (this.asRecord(chartsPayload).items as unknown[])
              : [];
            const chartRows = chartItems
              .slice(0, 50)
              .map((item) => this.asRecord(item))
              .map((item) => {
                const versions = Array.isArray(item.versions)
                  ? (item.versions as unknown[])
                      .map((version) => this.asRecord(version))
                      .map((version) => this.asString(version.version))
                      .filter(Boolean)
                  : [];
                return [
                  this.asString(item.fullName) || '-',
                  this.asString(item.repository) || '-',
                  versions.slice(0, 3).join(', ') || '-',
                ];
              });
            queryBlocks.push('### Helm Chart 列表（样本）');
            queryBlocks.push(
              this.renderMarkdownTable(
                ['Chart', 'Repository', 'Versions(top3)'],
                chartRows,
              ),
            );
            queryBlocks.push(
              `> 总计：Helm Chart=${chartItems.length}（展示前 ${chartRows.length} 条）`,
            );
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : String(error);
            queryBlocks.push('### Helm Chart 列表');
            queryBlocks.push(`> 查询失败：${reason}`);
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        queryBlocks.push('### Helm 仓库列表');
        queryBlocks.push(`> 查询失败：${reason}`);
      }
    }

    if (plan.helmReleases) {
      try {
        const releasesPayload = (await this.helmService.listReleases({
          clusterId,
          ...(namespace ? { namespace } : {}),
          ...(helmKeyword ? { keyword: helmKeyword } : {}),
          page: '1',
          pageSize: '50',
        })) as unknown;
        const releaseItems = Array.isArray(this.asRecord(releasesPayload).items)
          ? (this.asRecord(releasesPayload).items as unknown[])
          : [];
        const rows = releaseItems.slice(0, 50).map((item) => {
          const row = this.asRecord(item);
          return [
            this.asString(row.name) || '-',
            this.asString(row.namespace) || '-',
            this.asString(row.chart) || '-',
            this.asString(row.revision) || '-',
            this.asString(row.status) || '-',
            this.asString(row.updated) || '-',
          ];
        });
        queryBlocks.push('### Helm Release 列表（样本）');
        queryBlocks.push(
          this.renderMarkdownTable(
            ['Release', 'Namespace', 'Chart', 'Revision', 'Status', 'Updated'],
            rows,
          ),
        );
        queryBlocks.push(
          `> 总计：Helm Release=${releaseItems.length}（展示前 ${rows.length} 条）`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        queryBlocks.push('### Helm Release 列表');
        queryBlocks.push(`> 查询失败：${reason}`);
      }
    }

    if (queryBlocks.length === 0) {
      return lines.join('\n').trim();
    }

    return [...lines, '', '## 集群实时查询结果（只读）', ...queryBlocks]
      .join('\n')
      .trim();
  }

  private async requireSession(
    ownerUserId: string | undefined,
    sessionId: string,
  ): Promise<AiConversationSessionRecord> {
    const normalizedOwnerUserId = this.requireOwnerUserId(ownerUserId);
    const session = await this.prisma.aiConversationSession.findFirst({
      where: {
        id: sessionId,
        ownerUserId: normalizedOwnerUserId,
        deletedAt: null,
      },
    });
    if (!session) {
      throw new NotFoundException(`会话不存在: ${sessionId}`);
    }
    return session;
  }

  private mapSession(
    session: AiConversationSessionRecord,
    messages: AiConversationMessageRecord[],
  ): AiConversationSession {
    const clusterContext = this.parseClusterContext(session.clusterContextJson);
    return {
      id: session.id,
      title: session.title,
      surface:
        session.surface === 'mini' ||
        session.surface === 'console' ||
        session.surface === 'shared'
          ? session.surface
          : 'shared',
      clusterContext,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messages: messages.map((message) => this.mapMessage(message)),
    };
  }

  private mapMessage(
    message: AiConversationMessageRecord,
  ): AiConversationMessage {
    return {
      id: message.id,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      attachments: this.toAttachments(message.attachmentsJson),
      voiceInput: this.toVoiceInput(message.voiceInputJson),
      structured: this.toStructured(message.structuredJson),
      actionDescriptors: this.toActionDescriptors(
        message.actionDescriptorsJson,
      ),
    };
  }

  private toAttachments(value: unknown): AiMessageAttachment[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const items = value.filter(
      (item): item is AiMessageAttachment =>
        typeof item === 'object' &&
        item !== null &&
        'fileName' in item &&
        'mimeType' in item,
    );
    return items.length > 0 ? items.map((item) => ({ ...item })) : undefined;
  }

  private toVoiceInput(value: unknown): AiVoiceInputMeta | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const record = value as AiVoiceInputMeta;
    return typeof record.transcript === 'string' ? { ...record } : undefined;
  }

  private toStructured(
    value: unknown,
  ): AssistantStructuredResponse | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const record = value as AssistantStructuredResponse;
    return typeof record.summary === 'string' ? { ...record } : undefined;
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toActionDescriptors(
    value: unknown,
  ): AiActionDescriptor[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const items = value.filter(
      (item): item is AiActionDescriptor =>
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        'label' in item,
    );
    return items.length > 0
      ? items.map((item) => {
          const op = this.normalizeActionOperationAlias(
            typeof item.operation === 'string' ? item.operation : undefined,
          );
          const target =
            item.target && typeof item.target === 'object'
              ? ({
                  ...item.target,
                } as AiAssistantActionTarget)
              : undefined;
          const options =
            item.options && typeof item.options === 'object'
              ? ({
                  ...item.options,
                } as AiAssistantActionOptions)
              : undefined;
          return {
            ...item,
            ...(op ? { operation: op } : {}),
            ...(target ? { target } : {}),
            ...(options ? { options } : {}),
          };
        })
      : undefined;
  }

  async chat(
    message: string,
    context?: string,
  ): Promise<{
    reply: string;
    category: string;
    timestamp: string;
  }> {
    const history: AiConversationMessage[] = [
      {
        id: this.createId('msg'),
        role: 'user',
        content: context ? `${message}\n\n上下文：${context}` : message,
        createdAt: new Date().toISOString(),
      },
    ];
    const reply = await this.callLLM(history);
    return {
      reply,
      category: 'model-transit',
      timestamp: new Date().toISOString(),
    };
  }

  async getSuggestions(): Promise<{
    items: Array<{
      id: string;
      title: string;
      description: string;
      severity: string;
      category: string;
      affectedResources: string[];
    }>;
    total: number;
    timestamp: string;
  }> {
    const firingAlerts = await this.prisma.monitoringAlert.findMany({
      where: { status: 'firing' },
      orderBy: [{ severity: 'asc' }, { firedAt: 'desc' }],
      take: 10,
    });

    const items = firingAlerts.map((alert) => {
      const affectedResources: string[] = [];
      if (alert.namespace) {
        affectedResources.push(`Namespace/${alert.namespace}`);
      }
      if (alert.resourceType && alert.resourceName) {
        affectedResources.push(`${alert.resourceType}/${alert.resourceName}`);
      }

      let category = 'general';
      const titleLower = alert.title.toLowerCase();
      if (titleLower.includes('cpu') || titleLower.includes('memory')) {
        category = 'resource';
      } else if (
        titleLower.includes('restart') ||
        titleLower.includes('crash')
      ) {
        category = 'stability';
      } else if (
        titleLower.includes('disk') ||
        titleLower.includes('storage')
      ) {
        category = 'storage';
      }

      return {
        id: alert.id,
        title: alert.title,
        description: alert.message,
        severity: alert.severity,
        category,
        affectedResources:
          affectedResources.length > 0 ? affectedResources : ['unknown'],
      };
    });

    if (items.length === 0) {
      items.push({
        id: 'suggestion-default',
        title: '集群运行正常',
        description: '当前无 firing 状态告警，建议定期检查资源使用率趋势。',
        severity: 'info',
        category: 'general',
        affectedResources: ['cluster/all'],
      });
    }

    return {
      items,
      total: items.length,
      timestamp: new Date().toISOString(),
    };
  }

  private createId(prefix: string): string {
    const uuid = randomUUID();
    return `${prefix}_${uuid}`;
  }
}
