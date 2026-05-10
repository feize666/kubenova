import { apiRequest } from "./client";

export interface AiSuggestion {
  id: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  affectedResources: string[];
}

export interface AiSuggestionsResponse {
  items: AiSuggestion[];
  total?: number;
  timestamp?: string;
}

export interface ChatReply {
  reply: string;
  category: string;
  timestamp: string;
}

export type AiAssistantSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AiAssistantActionKind = "navigate" | "apply-filter" | "resource-operation";
export type AiAssistantActionRiskLevel = "critical" | "high" | "medium" | "low";
export type AiAssistantCanonicalOperation =
  | "enable"
  | "disable"
  | "batch-enable"
  | "batch-disable"
  | "query-pods-overview"
  | "query-deployments-overview"
  | "query-nodes-overview"
  | "query-pvcs"
  | "query-storageclasses"
  | "query-configmaps"
  | "query-pv-pvc-bindings"
  | "query-helm-releases"
  | "query-helm-repositories"
  | "import-helm-repository-presets"
  | "restart-workload"
  | "vm-power-on"
  | "vm-power-off"
  | "vm-restart";
export type AiAssistantActionOperationAlias =
  | "query-configmaps-overview"
  | "query-pvc-overview"
  | "query-storageclass-overview"
  | "vm-power-restart";
export type AiAssistantActionOperation = AiAssistantCanonicalOperation | AiAssistantActionOperationAlias;

export interface AiAssistantActionTarget {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  name?: string;
  resourceType?: string;
  resourceId?: string;
  provider?: string;
  vmId?: string;
  reason?: string;
}

export interface AiAssistantActionOptions {
  namespace?: string;
  limit?: number;
  includeDeleted?: boolean;
  keyword?: string;
  presetNames?: string[];
  sync?: boolean;
}

export interface AiActionDescriptor {
  id: string;
  label: string;
  kind: AiAssistantActionKind;
  routePath?: string;
  filterKey?: string;
  filterValue?: string;
  resourceType?: string;
  resourceId?: string;
  operation?: AiAssistantActionOperation | string;
  target?: AiAssistantActionTarget;
  options?: AiAssistantActionOptions;
  confirmation?: {
    required?: boolean;
    title?: string;
    summary?: string;
  };
  riskLevel: AiAssistantActionRiskLevel;
}

export interface AssistantStructuredResponse {
  summary: string;
  severity: AiAssistantSeverity;
  impactedResources: string[];
  recommendations: string[];
  actions: string[];
}

export type AiConversationRole = "user" | "assistant";

export interface AiConversationMessage {
  id: string;
  role: AiConversationRole;
  content: string;
  createdAt: string;
  attachments?: AiMessageAttachment[];
  voiceInput?: AiVoiceInputMeta;
  structured?: AssistantStructuredResponse;
  actionDescriptors?: AiActionDescriptor[];
}

export interface AiConversationSession {
  id: string;
  title: string;
  surface?: "shared" | "mini" | "console";
  clusterContext?: {
    clusterId?: string;
    namespace?: string;
    resourceKind?: string;
    resourceName?: string;
  };
  createdAt: string;
  updatedAt: string;
  messages: AiConversationMessage[];
}

export interface PresetQuestion {
  id: string;
  title: string;
  question: string;
  category: "告警分析" | "故障定位" | "容量与成本" | "发布风险";
}

export interface CreateSessionInput {
  title?: string;
  presetQuestionId?: string;
  message?: string;
  attachments?: AiMessageAttachment[];
  voiceInput?: AiVoiceInputMeta;
  surface?: "shared" | "mini" | "console";
  clusterId?: string;
  namespace?: string;
  resourceKind?: string;
  resourceName?: string;
}

export interface AiMessageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  category: "image" | "file";
  uploadedAt: string;
  url?: string;
  placeholder?: boolean;
}

export interface AiVoiceInputMeta {
  transcript: string;
  durationMs?: number;
  language?: string;
}

export interface SendMessageResponse {
  user: AiConversationMessage;
  assistant: AiConversationMessage;
  session: AiConversationSession;
  actionDescriptors: AiActionDescriptor[];
}

export interface AiActionExecuteRequest {
  operation: AiAssistantActionOperation;
  target?: AiAssistantActionTarget;
  reason?: string;
  options?: AiAssistantActionOptions;
  sessionId?: string;
}

export interface AiActionExecutionResult {
  status: "success" | "failure";
  requestId: string;
  operation: AiAssistantCanonicalOperation;
  result?: Array<{
    resourceType: string;
    resourceId: string;
    action: string;
    status: "success" | "rejected";
    details?: Record<string, unknown>;
  }>;
  rollbackSuggestion?: string;
  error?: {
    code: string;
    message: string;
  };
  writeback?: {
    persisted: boolean;
    sessionId?: string;
    messageId?: string;
    error?: string;
  };
}

const OPERATION_ALIASES: Record<
  AiAssistantActionOperationAlias,
  AiAssistantCanonicalOperation
> = {
  "query-configmaps-overview": "query-configmaps",
  "query-pvc-overview": "query-pvcs",
  "query-storageclass-overview": "query-storageclasses",
  "vm-power-restart": "vm-restart",
};

const CANONICAL_OPERATIONS = new Set<AiAssistantCanonicalOperation>([
  "enable",
  "disable",
  "batch-enable",
  "batch-disable",
  "query-pods-overview",
  "query-deployments-overview",
  "query-nodes-overview",
  "query-pvcs",
  "query-storageclasses",
  "query-configmaps",
  "query-pv-pvc-bindings",
  "query-helm-releases",
  "query-helm-repositories",
  "import-helm-repository-presets",
  "restart-workload",
  "vm-power-on",
  "vm-power-off",
  "vm-restart",
]);

export function normalizeAiAssistantActionOperation(
  operation: string | undefined | null,
): AiAssistantCanonicalOperation | undefined {
  const normalized = operation?.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized in OPERATION_ALIASES) {
    return OPERATION_ALIASES[normalized as AiAssistantActionOperationAlias];
  }
  if (CANONICAL_OPERATIONS.has(normalized as AiAssistantCanonicalOperation)) {
    return normalized as AiAssistantCanonicalOperation;
  }
  return undefined;
}

function normalizeActionDescriptor(descriptor: AiActionDescriptor): AiActionDescriptor {
  const operation = normalizeAiAssistantActionOperation(
    typeof descriptor.operation === "string" ? descriptor.operation : undefined,
  );
  return operation ? { ...descriptor, operation } : descriptor;
}

function normalizeConversationMessage(message: AiConversationMessage): AiConversationMessage {
  const actionDescriptors = message.actionDescriptors?.map(normalizeActionDescriptor);
  return actionDescriptors ? { ...message, actionDescriptors } : message;
}

function normalizeConversationSession(session: AiConversationSession): AiConversationSession {
  return {
    ...session,
    messages: (session.messages ?? []).map(normalizeConversationMessage),
  };
}

function normalizeSendMessageResponse(response: SendMessageResponse): SendMessageResponse {
  return {
    ...response,
    user: normalizeConversationMessage(response.user),
    assistant: normalizeConversationMessage(response.assistant),
    session: normalizeConversationSession(response.session),
    actionDescriptors: (response.actionDescriptors ?? []).map(normalizeActionDescriptor),
  };
}

export async function getAiSuggestions(token?: string): Promise<AiSuggestionsResponse> {
  return apiRequest<AiSuggestionsResponse>("/api/ai-assistant/suggestions", {
    method: "GET",
    token,
  });
}

export async function getPresetQuestions(token?: string): Promise<PresetQuestion[]> {
  return apiRequest<PresetQuestion[]>("/api/ai-assistant/presets", {
    method: "GET",
    token,
  });
}

export async function createSession(
  input: CreateSessionInput,
  token?: string,
): Promise<SendMessageResponse | AiConversationSession> {
  const response = await apiRequest<SendMessageResponse | AiConversationSession>("/api/ai-assistant/sessions", {
    method: "POST",
    token,
    body: input,
  });
  if ("session" in response) {
    return normalizeSendMessageResponse(response as SendMessageResponse);
  }
  return normalizeConversationSession(response as AiConversationSession);
}

export async function getSession(sessionId: string, token?: string): Promise<AiConversationSession> {
  const session = await apiRequest<AiConversationSession>(`/api/ai-assistant/sessions/${sessionId}`, {
    method: "GET",
    token,
  });
  return normalizeConversationSession(session);
}

export async function listSessions(token?: string): Promise<AiConversationSession[]> {
  const sessions = await apiRequest<AiConversationSession[]>("/api/ai-assistant/sessions", {
    method: "GET",
    token,
  });
  return sessions.map(normalizeConversationSession);
}

export async function deleteSession(sessionId: string, token?: string): Promise<{ deleted: boolean; sessionId: string }> {
  return apiRequest<{ deleted: boolean; sessionId: string }>(`/api/ai-assistant/sessions/${sessionId}`, {
    method: "DELETE",
    token,
  });
}

export async function sendMessage(
  sessionId: string,
  payload: {
    message: string;
    attachments?: AiMessageAttachment[];
    voiceInput?: AiVoiceInputMeta;
    clusterId?: string;
    namespace?: string;
    resourceKind?: string;
    resourceName?: string;
  },
  token?: string,
): Promise<SendMessageResponse> {
  const response = await apiRequest<SendMessageResponse>(`/api/ai-assistant/sessions/${sessionId}/messages`, {
    method: "POST",
    token,
    body: payload,
  });
  return normalizeSendMessageResponse(response);
}

export async function previewAction(
  action: AiActionExecuteRequest,
  token?: string,
): Promise<{
  status: "ok" | "invalid";
  operation?: AiAssistantCanonicalOperation;
  rollbackSuggestion?: string;
  error?: { code: string; message: string };
}> {
  const normalizedOperation = normalizeAiAssistantActionOperation(action.operation);
  const payload: AiActionExecuteRequest = normalizedOperation
    ? { ...action, operation: normalizedOperation }
    : action;
  const response = await apiRequest<{
    status: "ok" | "invalid";
    operation?: string;
    rollbackSuggestion?: string;
    error?: { code: string; message: string };
  }>("/api/ai-assistant/actions/preview", {
    method: "POST",
    token,
    body: { action: payload },
  });
  return {
    ...response,
    operation: normalizeAiAssistantActionOperation(response.operation),
  };
}

export async function executeAction(
  action: AiActionExecuteRequest,
  token?: string,
): Promise<AiActionExecutionResult> {
  const normalizedOperation = normalizeAiAssistantActionOperation(action.operation);
  const payload: AiActionExecuteRequest = normalizedOperation
    ? { ...action, operation: normalizedOperation }
    : action;
  const response = await apiRequest<AiActionExecutionResult>("/api/ai-assistant/actions/execute", {
    method: "POST",
    token,
    body: { action: payload },
  });
  return {
    ...response,
    operation:
      normalizeAiAssistantActionOperation(response.operation) ?? "query-pods-overview",
  };
}

export async function uploadAttachment(file: File, token?: string): Promise<AiMessageAttachment> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<AiMessageAttachment>("/api/ai-assistant/uploads", {
    method: "POST",
    token,
    body: form,
  });
}

export async function sendChatMessage(message: string, token?: string): Promise<ChatReply> {
  return apiRequest<ChatReply>("/api/ai-assistant/chat", {
    method: "POST",
    token,
    body: { message },
  });
}

// ---------------------------------------------------------------------------
// AI 模型配置
// ---------------------------------------------------------------------------

export interface AiModelConfig {
  baseUrl: string;
  /** 读取时为脱敏字符串（如 sk-xx****xxxx），写入时为明文 */
  apiKeyMasked: string;
  modelName: string;
  maxTokens: number;
  timeoutMs?: number;
  isConfigured: boolean;
}

export interface SaveAiConfigInput {
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiConfigPingResult {
  ok: boolean;
  message: string;
  config: {
    baseUrl: string;
    modelName: string;
    isConfigured: boolean;
  };
}

/** GET /api/ai-assistant/config - 读取当前 AI 模型配置（apiKey 已脱敏） */
export async function getAiConfig(token?: string): Promise<AiModelConfig> {
  return apiRequest<AiModelConfig>("/api/ai-assistant/config", {
    method: "GET",
    token,
  });
}

/** PUT /api/ai-assistant/config - 保存 AI 模型配置 */
export async function saveAiConfig(
  config: SaveAiConfigInput,
  token?: string,
): Promise<AiModelConfig> {
  return apiRequest<AiModelConfig>("/api/ai-assistant/config", {
    method: "PUT",
    token,
    body: config,
  });
}

export async function pingAiConfig(token?: string): Promise<AiConfigPingResult> {
  return apiRequest<AiConfigPingResult>("/api/ai-assistant/config/ping", {
    method: "GET",
    token,
  });
}
