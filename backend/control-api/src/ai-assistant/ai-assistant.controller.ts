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
  Optional,
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
import { AiProviderService } from './ai-provider.service';
import { AiActionApprovalService } from './ai-action-approval.service';
import { AiAssistantAccessService } from './ai-assistant-access.service';

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
  approvalId?: string;
}

export interface ChatRequest {
  message: string;
  context?: string;
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
    private readonly aiProviderService: AiProviderService,
    @Optional() private readonly aiActionApprovalService?: AiActionApprovalService,
    @Optional() private readonly aiAssistantAccessService?: AiAssistantAccessService,
  ) {}

  private async requireAiAssistantUse(
    req: AiAssistantRequest,
    context: { clusterId?: string; namespace?: string; mutation?: boolean; requireScope?: boolean } = {},
  ): Promise<AiAssistantActor> {
    const actor = extractActorFromRequest(req);
    if (!this.aiAssistantAccessService) return requireAiAssistantAdmin(req);
    const authorized = await this.aiAssistantAccessService.authorize({
      userId: actor.id,
      username: actor.username,
      role: normalizePlatformRole(actor.role),
    }, context);
    return { id: authorized.userId, username: authorized.username, role: authorized.role };
  }

  private async authorizeAction(
    req: AiAssistantRequest,
    action: AiActionExecuteInput,
  ): Promise<AiAssistantActor> {
    const mutation = !action?.operation?.startsWith('query-');
    const targets = action?.targets?.length ? action.targets : [action?.target ?? {}];
    const optionNamespace = action?.options?.namespace?.trim();
    // Authorization and execution must resolve to the same namespace. Query
    // executors prefer options.namespace, whereas mutations use the target.
    // Reject ambiguity instead of silently choosing a different resource scope.
    for (const target of targets) {
      const targetNamespace = (target.namespace ?? action?.target?.namespace)?.trim();
      if (optionNamespace && targetNamespace && optionNamespace !== targetNamespace) {
        throw new BadRequestException('命名空间参数不一致，请核对操作目标与查询条件');
      }
    }
    let authorized: AiAssistantActor | undefined;
    for (const target of targets) {
      authorized = await this.requireAiAssistantUse(req, {
        clusterId: target.clusterId ?? action?.target?.clusterId,
        namespace: target.namespace ?? action?.target?.namespace ?? action?.options?.namespace,
        mutation,
        requireScope: true,
      });
    }
    return authorized ?? this.requireAiAssistantUse(req, { mutation, requireScope: true });
  }

  @Get('access')
  getAccess(@Req() req: AiAssistantRequest) {
    if (!this.aiAssistantAccessService) {
      const actor = requireAiAssistantAdmin(req);
      return { allowed: true, fullAccess: true, scopes: [], actorId: actor.id };
    }
    const actor = extractActorFromRequest(req);
    return this.aiAssistantAccessService.getAccess({
      userId: actor.id,
      username: actor.username,
      role: normalizePlatformRole(actor.role),
    });
  }

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
  async getPresets(@Req() req: AiAssistantRequest) {
    await this.requireAiAssistantUse(req);
    return this.aiAssistantService.getPresetQuestions();
  }

  @Get('providers/catalog')
  getProviderCatalog(@Req() req: AiAssistantRequest) {
    requireAiAssistantAdmin(req);
    return this.aiProviderService.listVendors();
  }

  @Get('providers')
  listProviders(@Req() req: AiAssistantRequest) {
    requireAiAssistantAdmin(req);
    return this.aiProviderService.listProviders();
  }

  @Post('providers')
  createProvider(@Req() req: AiAssistantRequest, @Body() body: any) {
    const actor = requireAiAssistantAdmin(req);
    return this.aiProviderService.createProvider(body, actor);
  }

  @Put('providers/:providerId')
  updateProvider(@Req() req: AiAssistantRequest, @Param('providerId') providerId: string, @Body() body: any) {
    const actor = requireAiAssistantAdmin(req);
    return this.aiProviderService.updateProvider(providerId, body, actor);
  }

  @Delete('providers/:providerId')
  deleteProvider(@Req() req: AiAssistantRequest, @Param('providerId') providerId: string) {
    const actor = requireAiAssistantAdmin(req);
    return this.aiProviderService.deleteProvider(providerId, actor);
  }

  @Post('providers/:providerId/test')
  testProvider(@Req() req: AiAssistantRequest, @Param('providerId') providerId: string) {
    requireAiAssistantAdmin(req);
    return this.aiProviderService.testProvider(providerId);
  }

  @Get('agents')
  listAgents(@Req() req: AiAssistantRequest) {
    requireAiAssistantAdmin(req);
    return this.aiProviderService.listAgents();
  }

  @Post('agents')
  createAgent(@Req() req: AiAssistantRequest, @Body() body: any) {
    const actor = requireAiAssistantAdmin(req);
    return this.aiProviderService.createAgent(body, actor);
  }

  @Put('agents/:agentId')
  updateAgent(@Req() req: AiAssistantRequest, @Param('agentId') agentId: string, @Body() body: any) {
    const actor = requireAiAssistantAdmin(req);
    return this.aiProviderService.updateAgent(agentId, body, actor);
  }

  @Post('agents/chat')
  agentChat(@Req() req: AiAssistantRequest, @Body() body: { agentId?: string; messages?: Array<{ role: string; content: string }> }) {
    requireAiAssistantAdmin(req);
    if (!Array.isArray(body?.messages) || body.messages.length === 0) throw new BadRequestException('messages is required');
    return this.aiProviderService.chat(body.agentId, body.messages);
  }

  @Post('chat')
  async chat(@Body() body: ChatRequest, @Req() req: AiAssistantRequest) {
    await this.requireAiAssistantUse(req);
    const message = body?.message?.trim();
    if (!message) {
      throw new BadRequestException('message is required');
    }
    return this.aiAssistantService.chat(message, body?.context);
  }

  @Get('suggestions')
  async getSuggestions(@Req() req: AiAssistantRequest) {
    await this.requireAiAssistantUse(req);
    return this.aiAssistantService.getSuggestions();
  }

  /**
   * GET /api/ai-assistant/config/ping
   * 实际调用 LLM 发送测试消息，验证当前默认 Provider 的连通性。
   * 返回的 config 来自数据库 Provider，是本平台唯一的模型配置源。
   */
  @Get('config/ping')
  async pingLlm(@Req() req: AiAssistantRequest): Promise<{
    ok: boolean;
    message: string;
    config: {
      providerName: string;
      vendor: string;
      baseUrl: string;
      modelName: string;
      isConfigured: boolean;
    };
  }> {
    requireAiAssistantAdmin(req);
    const configInfo = await this.resolveActiveProviderConfig();
    try {
      const result = await this.aiAssistantService.testLlmConnection();
      return { ok: true, message: result, config: configInfo };
    } catch (e) {
      return { ok: false, message: (e as Error).message, config: configInfo };
    }
  }

  /**
   * 读取当前生效的 Provider 摘要（默认且启用的 Provider，其次任一启用的 Provider）。
   * AI 配置只存于数据库并加密保存，不再读取任何环境变量或磁盘密钥文件。
   */
  private async resolveActiveProviderConfig(): Promise<{
    providerName: string;
    vendor: string;
    baseUrl: string;
    modelName: string;
    isConfigured: boolean;
  }> {
    const providers = await this.aiProviderService.listProviders();
    const active =
      providers.find((item) => item.enabled && item.isDefault) ??
      providers.find((item) => item.enabled);
    if (!active) {
      return {
        providerName: '',
        vendor: '',
        baseUrl: '',
        modelName: '',
        isConfigured: false,
      };
    }
    return {
      providerName: active.name,
      vendor: active.vendor,
      baseUrl: active.baseUrl,
      modelName: active.modelName,
      isConfigured: Boolean(active.apiKeyConfigured),
    };
  }

  @Post('sessions')
  async createSession(
    @Body() body: CreateAiAssistantSessionRequest,
    @Req() req: AiAssistantRequest,
  ) {
    const requestedActor = extractActorFromRequest(req);
    const platformAdmin = ['admin', 'platform-admin'].includes(String(requestedActor.role ?? '').toLowerCase());
    const actor = await this.requireAiAssistantUse(req, {
      clusterId: body?.clusterId,
      namespace: body?.namespace,
    });
    const session = await this.aiAssistantService.createSession({
      ownerUserId: actor.id,
      title: body?.title,
      presetQuestionId: body?.presetQuestionId,
      surface: platformAdmin ? body?.surface : 'console',
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
  async listSessions(@Req() req: AiAssistantRequest) {
    const actor = await this.requireAiAssistantUse(req);
    const sessions = await this.aiAssistantService.listSessions(actor.id);
    const visible: typeof sessions = [];
    const isAdmin = ['admin', 'platform-admin'].includes(String(actor.role ?? '').toLowerCase());
    for (const session of sessions) {
      try {
        if (session.surface === 'mini' && !isAdmin) continue;
        await this.requireAiAssistantUse(req, {
          clusterId: session.clusterContext?.clusterId,
          namespace: session.clusterContext?.namespace,
          requireScope: true,
        });
        visible.push(session);
      } catch (error) {
        // Revoked scopes must not leave historical cluster data visible.
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return visible;
  }

  @Get('sessions/:sessionId')
  async getSessionHistory(
    @Param('sessionId') sessionId: string,
    @Req() req: AiAssistantRequest,
  ) {
    const actor = await this.requireAiAssistantUse(req);
    const session = await this.aiAssistantService.getSession(actor.id, sessionId);
    if (session.surface === 'mini' && !['admin', 'platform-admin'].includes(String(actor.role ?? '').toLowerCase())) {
      throw new ForbiddenException('该历史会话包含全群集上下文，当前授权范围不可访问');
    }
    await this.requireAiAssistantUse(req, {
      clusterId: session.clusterContext?.clusterId,
      namespace: session.clusterContext?.namespace,
      requireScope: true,
    });
    return session;
  }

  @Delete('sessions/:sessionId')
  async deleteSession(
    @Param('sessionId') sessionId: string,
    @Req() req: AiAssistantRequest,
  ) {
    const actor = await this.requireAiAssistantUse(req);
    return this.aiAssistantService.deleteSession(actor.id, sessionId);
  }

  @Post('sessions/:sessionId/messages')
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() body: SendAiAssistantMessageRequest,
    @Req() req: AiAssistantRequest,
  ) {
    const baseActor = await this.requireAiAssistantUse(req);
    const isAdmin = ['admin', 'platform-admin'].includes(String(baseActor.role ?? '').toLowerCase());
    const previousSession = await this.aiAssistantService.getSession(baseActor.id, sessionId);
    if (previousSession.surface === 'mini' && !isAdmin) {
      throw new ForbiddenException('该历史会话包含全群集上下文，当前授权范围不可访问');
    }
    const actor = await this.requireAiAssistantUse(req, {
      clusterId: body?.clusterId ?? previousSession.clusterContext?.clusterId,
      namespace: body?.namespace ?? previousSession.clusterContext?.namespace,
    });
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
        const authorizedActor = await this.authorizeAction(req, autoAction);
        await this.aiActionExecutorService.execute({
          userId: authorizedActor.id,
          username: authorizedActor.username,
          role: normalizePlatformRole(authorizedActor.role),
        }, autoAction);
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
  async uploadAttachment(
    @Req() req: AiAssistantRequest,
    @UploadedFile()
    file?: {
      originalname: string;
      mimetype: string;
      size: number;
    },
  ) {
    await this.requireAiAssistantUse(req);
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
  async executeAction(
    @Req() req: AiAssistantRequest,
    @Body() body: ExecuteAiActionRequest,
  ) {
    const actor = await this.authorizeAction(req, body?.action);
    const executionActor = {
      userId: actor.id,
      username: actor.username,
      role: normalizePlatformRole(actor.role),
    };
    if (this.aiActionApprovalService) {
      return this.aiActionApprovalService.execute(
        executionActor,
        body?.action,
        body?.approvalId,
      );
    }
    if (!body?.action?.operation?.startsWith('query-')) {
      throw new ForbiddenException('写操作审批服务不可用');
    }
    return this.aiActionExecutorService.execute(
      executionActor,
      body?.action,
    );
  }

  @Post('actions/preview')
  async previewAction(
    @Body() body: ExecuteAiActionRequest,
    @Req() req: AiAssistantRequest,
  ) {
    const actor = await this.authorizeAction(req, body?.action);
    if (!this.aiActionApprovalService) {
      if (!body?.action?.operation?.startsWith('query-')) {
        throw new ForbiddenException('写操作审批服务不可用');
      }
      return this.aiActionExecutorService.preview({
        userId: actor.id,
        username: actor.username,
        role: normalizePlatformRole(actor.role),
      }, body?.action);
    }
    return this.aiActionApprovalService.preview({
      userId: actor.id,
      username: actor.username,
      role: normalizePlatformRole(actor.role),
    }, body?.action);
  }
}
