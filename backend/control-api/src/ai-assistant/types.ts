export type AiAssistantSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';
export type AiAssistantActionKind =
  | 'navigate'
  | 'apply-filter'
  | 'resource-operation';
export type AiAssistantActionRiskLevel = 'critical' | 'high' | 'medium' | 'low';

export type AiAssistantActionOperation =
  | 'enable'
  | 'disable'
  | 'batch-enable'
  | 'batch-disable'
  | 'query-pods-overview'
  | 'query-deployments-overview'
  | 'query-nodes-overview'
  | 'query-pv-pvc-bindings'
  | 'query-pvcs'
  | 'query-storageclasses'
  | 'query-configmaps'
  | 'query-helm-releases'
  | 'query-helm-repositories'
  | 'import-helm-repository-presets'
  | 'restart-workload'
  | 'vm-power-on'
  | 'vm-power-off'
  | 'vm-restart'
  | 'query-configmaps-overview'
  | 'query-pvc-overview'
  | 'query-storageclass-overview'
  | 'vm-power-restart';

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

export interface PresetQuestion {
  id: string;
  title: string;
  question: string;
  category: '告警分析' | '故障定位' | '容量与成本' | '发布风险';
}

export interface AssistantStructuredResponse {
  summary: string;
  severity: AiAssistantSeverity;
  impactedResources: string[];
  recommendations: string[];
  actions: string[];
}

export type AiConversationRole = 'user' | 'assistant';

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
  surface?: 'shared' | 'mini' | 'console';
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

export interface CreateSessionInput {
  ownerUserId?: string;
  title?: string;
  presetQuestionId?: string;
  message?: string;
  attachments?: AiMessageAttachment[];
  voiceInput?: AiVoiceInputMeta;
  surface?: 'shared' | 'mini' | 'console';
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
  category: 'image' | 'file';
  uploadedAt: string;
  url?: string;
}

export interface AiVoiceInputMeta {
  transcript: string;
  durationMs?: number;
  language?: string;
}
