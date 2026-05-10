import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  UploadedFile,
  UseInterceptors,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../common/auth.guard';
import { type PlatformRole } from '../common/governance';
import { AiAssistantService } from './ai-assistant.service';
import {
  AiActionExecutorService,
  type AiActionExecuteInput,
} from './ai-action-executor.service';
import type {
  AiActionDescriptor,
  AiMessageAttachment,
  AiVoiceInputMeta,
  CreateSessionInput,
} from './types';
import {
  readAiConfig,
  saveAiConfig,
  type AiModelConfig,
} from './ai-config.util';

export interface CreateAiAssistantSessionRequest extends CreateSessionInput {
  message?: string;
}

export interface SendAiAssistantMessageRequest {
  message: string;
  attachments?: AiMessageAttachment[];
  voiceInput?: AiVoiceInputMeta;
  clusterId?: string;
  namespace?: string;
  resourceKind?: string;
  resourceName?: string;
}

export interface ExecuteAiActionRequest {
  action: AiActionExecuteInput;
}

export interface ChatRequest {
  message: string;
  context?: string;
}

export interface SaveAiConfigRequest {
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

type AiAssistantRequestUser = {
  user?: {
    id?: string;
    username?: string;
    role?: string;
  };
};

type AiAssistantRequest = {
  user?: AiAssistantRequestUser | Record<string, unknown>;
  auth?: Record<string, unknown>;
  principal?: Record<string, unknown>;
  actor?: Record<string, unknown>;
};

type AiAssistantActor = {
  id?: string;
  username?: string;
  role?: string;
};

const AI_ASSISTANT_ADMIN_ROLES = new Set(['admin', 'platform-admin']);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeRoleValue(role: unknown): string {
  if (Array.isArray(role)) {
    for (const entry of role) {
      const normalized = normalizeRoleValue(entry);
      if (normalized) {
        return normalized;
      }
    }
    return '';
  }

  if (typeof role !== 'string') {
    return '';
  }

  const normalized = role.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const compact = normalized.replace(/_/g, '-');

  if (compact.includes(',') || compact.includes(' ')) {
    const tokens = compact
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    for (const token of tokens) {
      const tokenRole = normalizeRoleValue(token);
      if (tokenRole) {
        return tokenRole;
      }
    }
    return '';
  }

  if (compact === 'platform-admin' || compact === 'platformadmin') {
    return 'platform-admin';
  }

  return compact;
}

function readStringField(
  sources: Array<Record<string, unknown> | null>,
  keys: string[],
): string | undefined {
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized) {
          return normalized;
        }
      }
    }
  }
  return undefined;
}

function readRoleField(
  sources: Array<Record<string, unknown> | null>,
): string | undefined {
  for (const source of sources) {
    if (!source) {
      continue;
    }

    for (const key of ['role', 'userRole', 'platformRole', 'scope']) {
      const normalized = normalizeRoleValue(source[key]);
      if (normalized) {
        return normalized;
      }
    }

    for (const key of ['roles', 'roleNames', 'scopes']) {
      const normalized = normalizeRoleValue(source[key]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}

function extractActorFromRequest(req: AiAssistantRequest): AiAssistantActor {
  const reqRecord = asRecord(req);
  const requestUser = asRecord(reqRecord?.user);
  const nestedUser = asRecord(requestUser?.user);
  const auth = asRecord(reqRecord?.auth);
  const authUser = asRecord(auth?.user);
  const principal = asRecord(reqRecord?.principal);
  const actor = asRecord(reqRecord?.actor);

  const sources = [
    nestedUser,
    requestUser,
    authUser,
    actor,
    principal,
    auth,
    reqRecord,
  ];

  return {
    id: readStringField(sources, ['id', 'userId', 'uid', 'sub']),
    username: readStringField(sources, [
      'username',
      'email',
      'name',
      'displayName',
    ]),
    role: readRoleField(sources),
  };
}

function requireAiAssistantAdmin(req: AiAssistantRequest): AiAssistantActor {
  const actor = extractActorFromRequest(req);
  const role = normalizeRoleValue(actor.role);
  if (!AI_ASSISTANT_ADMIN_ROLES.has(role)) {
    throw new ForbiddenException('AI 助手仅管理员可用');
  }
  return {
    ...actor,
    role,
  };
}

function normalizePlatformRole(role: string | undefined): PlatformRole {
  const normalized = String(role ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'platform-admin' || normalized === 'admin') {
    return 'platform-admin';
  }
  if (normalized === 'cluster-operator') {
    return 'cluster-operator';
  }
  return 'read-only';
}

@Controller('api/ai-assistant')
@UseGuards(AuthGuard)
export class AiAssistantController {
  constructor(
    private readonly aiAssistantService: AiAssistantService,
    private readonly aiActionExecutorService: AiActionExecutorService,
  ) {}

  private isAutoQueryBridgeEnabled(): boolean {
    const raw = process.env.AI_ASSISTANT_AUTO_QUERY_BRIDGE;
    if (raw === undefined || raw === null) {
      return true;
    }
    const normalized = raw.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    return !['0', 'false', 'off', 'no'].includes(normalized);
  }

  private shouldAutoRunQueryAction(message: string): boolean {
    const text = message.trim().toLowerCase();
    if (!text) {
      return false;
    }
    const blockedPatterns = [
      /不要执行/u,
      /别执行/u,
      /先别/u,
      /仅建议/u,
      /只给建议/u,
      /不操作/u,
    ];
    if (blockedPatterns.some((pattern) => pattern.test(text))) {
      return false;
    }
    const queryIntentPatterns = [
      /查询/u,
      /查下/u,
      /看看/u,
      /看下/u,
      /列出/u,
      /概览/u,
      /状态/u,
      /有哪些/u,
      /\blist\b/u,
      /\bshow\b/u,
      /\boverview\b/u,
      /\bquery\b/u,
    ];
    return queryIntentPatterns.some((pattern) => pattern.test(text));
  }

  private pickAutoQueryDescriptor(
    descriptors: AiActionDescriptor[] | undefined,
  ): AiActionDescriptor | undefined {
    return (descriptors ?? []).find((descriptor) => {
      if (descriptor.kind !== 'resource-operation') {
        return false;
      }
      if (typeof descriptor.operation !== 'string') {
        return false;
      }
      return descriptor.operation.trim().toLowerCase().startsWith('query-');
    });
  }

  private buildAutoQueryAction(
    descriptor: AiActionDescriptor,
    fallbackContext: {
      sessionId: string;
      clusterId?: string;
      namespace?: string;
      resourceKind?: string;
      resourceName?: string;
    },
  ): AiActionExecuteInput | undefined {
    const operation = descriptor.operation?.trim();
    if (!operation || !operation.toLowerCase().startsWith('query-')) {
      return undefined;
    }

    const clusterId =
      descriptor.target?.clusterId?.trim() || fallbackContext.clusterId?.trim();
    if (!clusterId) {
      return undefined;
    }

    const target: NonNullable<AiActionExecuteInput['target']> = {
      ...(descriptor.target ?? {}),
      clusterId,
    };

    const namespace =
      descriptor.target?.namespace?.trim() ||
      descriptor.options?.namespace?.trim() ||
      fallbackContext.namespace?.trim();
    if (namespace) {
      target.namespace = namespace;
    }

    if (!target.kind && fallbackContext.resourceKind?.trim()) {
      target.kind = fallbackContext.resourceKind.trim();
    }
    if (!target.name && fallbackContext.resourceName?.trim()) {
      target.name = fallbackContext.resourceName.trim();
    }

    return {
      operation: operation as AiActionExecuteInput['operation'],
      target,
      options: descriptor.options ? { ...descriptor.options } : undefined,
      sessionId: fallbackContext.sessionId,
    };
  }

  @Get('presets')
  getPresets(@Req() req: AiAssistantRequest) {
    requireAiAssistantAdmin(req);
    return this.aiAssistantService.getPresetQuestions();
  }

  @Post('chat')
  chat(@Body() body: ChatRequest, @Req() req: AiAssistantRequest) {
    requireAiAssistantAdmin(req);
    const message = body?.message?.trim();
    if (!message) {
      throw new BadRequestException('message is required');
    }
    return this.aiAssistantService.chat(message, body?.context);
  }

  @Get('suggestions')
  async getSuggestions(@Req() req: AiAssistantRequest) {
    requireAiAssistantAdmin(req);
    return this.aiAssistantService.getSuggestions();
  }

  /**
   * GET /api/ai-assistant/config/ping
   * 实际调用 LLM 发送测试消息，验证配置的连通性。
   * 返回 ok=true 时 message 为模型响应内容，ok=false 时为错误信息。
   */
  @Get('config/ping')
  async pingLlm(@Req() req: AiAssistantRequest): Promise<{
    ok: boolean;
    message: string;
    config: { baseUrl: string; modelName: string; isConfigured: boolean };
  }> {
    requireAiAssistantAdmin(req);
    const configInfo = readAiConfig();
    try {
      const result = await this.aiAssistantService.testLlmConnection();
      return {
        ok: true,
        message: result,
        config: {
          baseUrl: configInfo.baseUrl,
          modelName: configInfo.modelName,
          isConfigured: configInfo.isConfigured,
        },
      };
    } catch (e) {
      return {
        ok: false,
        message: (e as Error).message,
        config: {
          baseUrl: configInfo.baseUrl,
          modelName: configInfo.modelName,
          isConfigured: configInfo.isConfigured,
        },
      };
    }
  }

  /**
   * GET /api/ai-assistant/config
   * 返回当前 AI 模型配置；apiKey 做脱敏处理，仅返回是否已配置。
   */
  @Get('config')
  getConfig(
    @Req() req: AiAssistantRequest,
  ): Omit<AiModelConfig, 'apiKey'> & { apiKeyMasked: string } {
    requireAiAssistantAdmin(req);
    const config = readAiConfig();
    const { apiKey, ...rest } = config;
    const apiKeyMasked = apiKey
      ? `${apiKey.slice(0, 4)}${'*'.repeat(Math.max(0, apiKey.length - 8))}${apiKey.slice(-4)}`
      : '';
    return { ...rest, apiKeyMasked };
  }

  /**
   * PUT /api/ai-assistant/config
   * 保存 AI 模型配置到内存（process.env）并持久化到 .env.ai.local。
   */
  @Put('config')
  saveConfig(
    @Req() req: AiAssistantRequest,
    @Body() body: SaveAiConfigRequest,
  ): Omit<AiModelConfig, 'apiKey'> & { apiKeyMasked: string } {
    requireAiAssistantAdmin(req);
    const updated = saveAiConfig({
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      modelName: body.modelName,
      maxTokens:
        body.maxTokens !== undefined ? Number(body.maxTokens) : undefined,
      timeoutMs:
        body.timeoutMs !== undefined ? Number(body.timeoutMs) : undefined,
    });
    const { apiKey, ...rest } = updated;
    const apiKeyMasked = apiKey
      ? `${apiKey.slice(0, 4)}${'*'.repeat(Math.max(0, apiKey.length - 8))}${apiKey.slice(-4)}`
      : '';
    return { ...rest, apiKeyMasked };
  }

  @Post('sessions')
  async createSession(
    @Body() body: CreateAiAssistantSessionRequest,
    @Req() req: AiAssistantRequest,
  ) {
    const actor = requireAiAssistantAdmin(req);
    const session = await this.aiAssistantService.createSession({
      ownerUserId: actor.id,
      title: body?.title,
      presetQuestionId: body?.presetQuestionId,
      surface: body?.surface,
      attachments: body?.attachments,
      voiceInput: body?.voiceInput,
      clusterId: body?.clusterId,
      namespace: body?.namespace,
      resourceKind: body?.resourceKind,
      resourceName: body?.resourceName,
    });

    const firstMessage = body?.message?.trim();
    if (!firstMessage) {
      return session;
    }

    return this.aiAssistantService.appendUserAndReply(
      actor.id,
      session.id,
      firstMessage,
      body?.attachments,
      body?.voiceInput,
    );
  }

  @Get('sessions')
  listSessions(@Req() req: AiAssistantRequest) {
    const actor = requireAiAssistantAdmin(req);
    return this.aiAssistantService.listSessions(actor.id);
  }

  @Get('sessions/:sessionId')
  getSessionHistory(
    @Param('sessionId') sessionId: string,
    @Req() req: AiAssistantRequest,
  ) {
    const actor = requireAiAssistantAdmin(req);
    return this.aiAssistantService.getSession(actor.id, sessionId);
  }

  @Delete('sessions/:sessionId')
  deleteSession(
    @Param('sessionId') sessionId: string,
    @Req() req: AiAssistantRequest,
  ) {
    const actor = requireAiAssistantAdmin(req);
    return this.aiAssistantService.deleteSession(actor.id, sessionId);
  }

  @Post('sessions/:sessionId/messages')
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() body: SendAiAssistantMessageRequest,
    @Req() req: AiAssistantRequest,
  ) {
    const actor = requireAiAssistantAdmin(req);
    const message = body?.message?.trim();
    if (!message) {
      throw new BadRequestException('message is required');
    }

    const reply = await this.aiAssistantService.appendUserAndReply(
      actor.id,
      sessionId,
      message,
      body?.attachments,
      body?.voiceInput,
      {
        clusterId: body?.clusterId,
        namespace: body?.namespace,
        resourceKind: body?.resourceKind,
        resourceName: body?.resourceName,
      },
    );

    if (
      this.isAutoQueryBridgeEnabled() &&
      this.shouldAutoRunQueryAction(message)
    ) {
      const descriptor = this.pickAutoQueryDescriptor(reply.actionDescriptors);
      const autoAction = descriptor
        ? this.buildAutoQueryAction(descriptor, {
            sessionId,
            clusterId: body?.clusterId,
            namespace: body?.namespace,
            resourceKind: body?.resourceKind,
            resourceName: body?.resourceName,
          })
        : undefined;

      if (autoAction) {
        await this.aiActionExecutorService.execute(
          {
            userId: actor.id,
            username: actor.username,
            role: normalizePlatformRole(actor.role),
          },
          autoAction,
        );
        const refreshedSession = await this.aiAssistantService.getSession(
          actor.id,
          sessionId,
        );
        return {
          ...reply,
          session: refreshedSession,
        };
      }
    }

    return reply;
  }

  @Post('uploads')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @Req() req: AiAssistantRequest,
    @UploadedFile()
    file?: {
      originalname: string;
      mimetype: string;
      size: number;
    },
  ) {
    requireAiAssistantAdmin(req);
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const now = new Date().toISOString();
    return {
      id: `att-${Date.now().toString(36)}`,
      fileName: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      category: file.mimetype?.startsWith('image/') ? 'image' : 'file',
      uploadedAt: now,
      url: `/api/ai-assistant/uploads/${encodeURIComponent(file.originalname)}`,
      placeholder: true,
    };
  }

  @Post('actions/execute')
  executeAction(
    @Req() req: AiAssistantRequest,
    @Body() body: ExecuteAiActionRequest,
  ) {
    const actor = requireAiAssistantAdmin(req);
    return this.aiActionExecutorService.execute(
      {
        userId: actor.id,
        username: actor.username,
        role: normalizePlatformRole(actor.role),
      },
      body?.action,
    );
  }

  @Post('actions/preview')
  previewAction(
    @Body() body: ExecuteAiActionRequest,
    @Req() req: AiAssistantRequest,
  ) {
    requireAiAssistantAdmin(req);
    return this.aiActionExecutorService.preview(body?.action);
  }
}
