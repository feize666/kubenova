import type { ListQueryParams, PaginationMeta, ResourceState } from "./common";

export interface BaseResource {
  id: string;
  name: string;
  state?: ResourceState;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClusterModel extends BaseResource {
  environment: string;
  status: string;
  cpuUsage: number;
  memoryUsage: number;
  storageUsage: number;
  provider: string;
  kubernetesVersion: string;
  /** 生命周期状态：active / disabled / deleted */
  state?: ResourceState;
  /** 节点数量，sync 后才有值 */
  nodeCount?: number | null;
  /** 是否已配置 kubeconfig，true 表示已接入真实集群 */
  hasKubeconfig?: boolean;
}

export type ClusterEnvironmentType =
  | "on-prem"
  | "private-cloud"
  | "public-cloud"
  | "edge";

export interface ClusterProfileModel {
  clusterId: string;
  environmentType: ClusterEnvironmentType;
  provider: string;
  region?: string;
  labels?: Record<string, string>;
  updatedAt: string;
}

export interface ClusterDetailNodeModel {
  name: string;
  role: string;
  ready: boolean;
  kubeletVersion?: string;
}

export interface ClusterDetailModel {
  id: string;
  name: string;
  displayName: string;
  runtimeStatus: "running" | "offline" | "checking" | "disabled" | "offline-mode";
  lastSyncTime: string | null;
  nodeSummary: {
    total: number;
    ready: number;
    notReady: number;
    items: ClusterDetailNodeModel[];
  };
  platform: {
    cniPlugin: string | null;
    criRuntime: string | null;
    kubernetesVersion: string | null;
  };
  metadata: {
    environment: string;
    provider: string;
    region: string | null;
    environmentType: ClusterEnvironmentType | null;
  };
}

export type RegistryConnectorType = "harbor" | "oci";
export type RegistryAuthType = "basic" | "token";

export interface RegistryConnectorModel extends BaseResource {
  type: RegistryConnectorType;
  endpoint: string;
  projectScope?: string;
  authType: RegistryAuthType;
  username?: string;
  passwordSecretRef?: string;
  verifyTls: boolean;
  lastCheckedAt?: string;
  lastError?: string;
}

export interface ApiResourceCapabilityModel {
  id: string;
  clusterId: string;
  group: string;
  version: string;
  kind: string;
  resource: string;
  namespaced: boolean;
  verbs: string[];
  lastDiscoveredAt: string;
}

export type HpaMetricTargetType = "Utilization" | "AverageValue" | "Value";
export type HpaMetricSourceType = "Resource" | "Pods" | "External";

export interface HpaResourceMetricSpec {
  sourceType: "Resource";
  name: "cpu" | "memory" | string;
  targetType: HpaMetricTargetType;
  targetValue: string;
}

export interface HpaPodsMetricSpec {
  sourceType: "Pods";
  metricName: string;
  selector?: Record<string, string>;
  targetType: Exclude<HpaMetricTargetType, "Utilization">;
  targetValue: string;
}

export interface HpaExternalMetricSpec {
  sourceType: "External";
  metricName: string;
  selector?: Record<string, string>;
  targetType: Exclude<HpaMetricTargetType, "Utilization">;
  targetValue: string;
}

export type HpaMetricSpec =
  | HpaResourceMetricSpec
  | HpaPodsMetricSpec
  | HpaExternalMetricSpec;

export interface HpaBehaviorPolicySpec {
  type: "Pods" | "Percent";
  value: number;
  periodSeconds: number;
}

export interface HpaBehaviorRuleSpec {
  stabilizationWindowSeconds?: number;
  selectPolicy?: "Max" | "Min" | "Disabled";
  policies?: HpaBehaviorPolicySpec[];
}

export interface HpaBehaviorSpec {
  scaleUp?: HpaBehaviorRuleSpec;
  scaleDown?: HpaBehaviorRuleSpec;
}

export interface ClusterQueryParams extends ListQueryParams {
  environment?: string;
  status?: string;
  provider?: string;
  state?: ResourceState;
  selectableOnly?: boolean;
}

export interface ClusterListModel {
  items: ClusterModel[];
  page: number;
  pageSize: number;
  total: number;
  timestamp: string;
}

export interface ListModel<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}
