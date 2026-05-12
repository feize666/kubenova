import { apiRequest } from "./client";
import type {
  HpaBehaviorSpec,
  HpaMetricSpec,
} from "@/lib/contracts";

export type AutoscalingType = "HPA" | "VPA";

export interface HpaPolicyConfig {
  minReplicas: number;
  maxReplicas: number;
  targetCpuUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: number;
  metrics?: HpaMetricSpec[];
  behavior?: HpaBehaviorSpec;
}

export interface VpaPolicyConfig {
  updateMode: "Off" | "Initial" | "Auto";
  minAllowedCpu?: string;
  maxAllowedCpu?: string;
  minAllowedMemory?: string;
  maxAllowedMemory?: string;
  controlledResources?: string[];
}

export interface AutoscalingPolicyItem {
  id: string;
  type: AutoscalingType;
  state: string;
  clusterId: string;
  namespace: string;
  workloadKind: string;
  workloadName: string;
  resourceName?: string;
  workloadId: string;
  replicas: number | null;
  readyReplicas: number | null;
  config: HpaPolicyConfig | VpaPolicyConfig;
  createdAt: string;
  updatedAt: string;
}

export interface AutoscalingOverview {
  totalPolicies: number;
  hpaPolicies: number;
  vpaPolicies: number;
  coveredWorkloads: number;
  uncoveredWorkloads: number;
}

export interface AutoscalingPoliciesResponse {
  items: AutoscalingPolicyItem[];
  total: number;
  overview: AutoscalingOverview;
}

export interface ListAutoscalingPoliciesParams {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  type?: AutoscalingType;
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface CreateAutoscalingPolicyPayload {
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
  type: AutoscalingType;
  hpa?: HpaPolicyConfig;
  vpa?: VpaPolicyConfig;
}

export interface UpdateAutoscalingPolicyPayload {
  hpa?: Partial<HpaPolicyConfig>;
  vpa?: Partial<VpaPolicyConfig>;
}

export interface DeleteAutoscalingPolicyResult {
  message: string;
  type: AutoscalingType;
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
  timestamp: string;
}

export interface AutoscalingEventItem {
  type: string;
  reason: string;
  message: string;
  kind: string;
  name: string;
  namespace: string;
  timestamp: string;
}

export interface AutoscalingEventsResponse {
  clusterId: string;
  namespace: string;
  hours: number;
  items: AutoscalingEventItem[];
  total: number;
  timestamp: string;
}

export async function listAutoscalingPolicies(
  params: ListAutoscalingPoliciesParams = {},
  token?: string,
): Promise<AutoscalingPoliciesResponse> {
  return apiRequest<AutoscalingPoliciesResponse>("/api/autoscaling/policies", {
    query: {
      clusterId: params.clusterId,
      namespace: params.namespace,
      kind: params.kind,
      type: params.type,
      keyword: params.keyword,
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    },
    token,
  });
}

export async function createAutoscalingPolicy(
  body: CreateAutoscalingPolicyPayload,
  token?: string,
): Promise<AutoscalingPolicyItem> {
  return apiRequest<AutoscalingPolicyItem, CreateAutoscalingPolicyPayload>("/api/autoscaling/policies", {
    method: "POST",
    body,
    token,
  });
}

export async function updateAutoscalingPolicy(
  type: AutoscalingType,
  identity: { clusterId: string; namespace: string; kind: string; name: string },
  body: UpdateAutoscalingPolicyPayload,
  token?: string,
): Promise<AutoscalingPolicyItem> {
  return apiRequest<AutoscalingPolicyItem, UpdateAutoscalingPolicyPayload>(
    `/api/autoscaling/${type}/${identity.kind}/${identity.name}`,
    {
      method: "PATCH",
      query: {
        clusterId: identity.clusterId,
        namespace: identity.namespace,
      },
      body,
      token,
    },
  );
}

export async function deleteAutoscalingPolicy(
  type: AutoscalingType,
  identity: { clusterId: string; namespace: string; kind: string; name: string },
  token?: string,
): Promise<DeleteAutoscalingPolicyResult> {
  return apiRequest<DeleteAutoscalingPolicyResult>(`/api/autoscaling/${type}/${identity.kind}/${identity.name}`, {
    method: "DELETE",
    query: {
      clusterId: identity.clusterId,
      namespace: identity.namespace,
    },
    token,
  });
}

export async function getAutoscalingEvents(
  identity: { clusterId: string; namespace: string; kind: string; name: string; hours?: number },
  token?: string,
): Promise<AutoscalingEventsResponse> {
  return apiRequest<AutoscalingEventsResponse>("/api/autoscaling/events", {
    method: "GET",
    query: {
      clusterId: identity.clusterId,
      namespace: identity.namespace,
      kind: identity.kind,
      name: identity.name,
      hours: identity.hours ?? 24,
    },
    token,
  });
}
