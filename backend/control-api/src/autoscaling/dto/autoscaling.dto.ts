import type {
  HpaBehaviorSpec,
  HpaMetricSpec,
} from '../../common/contracts/domain-models.contract';

export type AutoscalingType = 'HPA' | 'VPA';
export type PolicyState = 'enabled' | 'disabled';

interface WorkloadIdentity {
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
}

export interface AutoscalingListQuery {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  type?: AutoscalingType;
  state?: PolicyState;
  keyword?: string;
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface HpaPolicyConfig {
  minReplicas: number;
  maxReplicas: number;
  targetCpuUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: number;
  metrics?: HpaMetricSpec[];
  behavior?: HpaBehaviorSpec;
}

export interface VpaPolicyConfig {
  updateMode: 'Off' | 'Initial' | 'Auto';
  minAllowedCpu?: string;
  maxAllowedCpu?: string;
  minAllowedMemory?: string;
  maxAllowedMemory?: string;
  controlledResources?: string[];
}

export interface CreateAutoscalingPolicyRequest extends WorkloadIdentity {
  type: AutoscalingType;
  enabled?: boolean;
  hpa?: HpaPolicyConfig;
  vpa?: VpaPolicyConfig;
}

export interface UpdateAutoscalingPolicyRequest {
  enabled?: boolean;
  hpa?: Partial<HpaPolicyConfig>;
  vpa?: Partial<VpaPolicyConfig>;
}

export interface DeleteAutoscalingPolicyRequest {
  clusterId?: string;
  namespace?: string;
}

export interface AutoscalingPolicyItem {
  id: string;
  type: AutoscalingType;
  state: PolicyState;
  clusterId: string;
  namespace: string;
  /** 目标工作负载 kind。 */
  workloadKind: string;
  /** 目标工作负载 name。 */
  workloadName: string;
  /** HPA/VPA 真实资源名。 */
  resourceName: string;
  /** 目标工作负载身份，便于兼容旧语义。 */
  workloadId: string;
  replicas: number | null;
  readyReplicas: number | null;
  config: HpaPolicyConfig | VpaPolicyConfig;
  createdAt: string;
  updatedAt: string;
}

export interface AutoscalingOverview {
  totalPolicies: number;
  enabledPolicies: number;
  hpaPolicies: number;
  vpaPolicies: number;
  coveredWorkloads: number;
  uncoveredWorkloads: number;
}
