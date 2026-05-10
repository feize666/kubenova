import type { ResourceState } from './resource-state.contract';

export interface BaseDomainResource {
  id: string;
  name: string;
  state: ResourceState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClusterResource extends BaseDomainResource {
  provider: 'aws' | 'azure' | 'gcp' | 'aliyun' | 'on-prem';
  region: string;
}

export type RegistryConnectorType = 'harbor' | 'oci';
export type RegistryAuthType = 'basic' | 'token';

export interface RegistryConnectorResource extends BaseDomainResource {
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

export interface RegistryCatalogCacheResource {
  id: string;
  connectorId: string;
  repository: string;
  tag?: string;
  digest?: string;
  artifactType?: string;
  pulledAt: string;
}

export interface ApiResourceCapabilityResource {
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

export type ClusterEnvironmentType =
  | 'on-prem'
  | 'private-cloud'
  | 'public-cloud'
  | 'edge';

export interface ClusterProfileResource {
  clusterId: string;
  environmentType: ClusterEnvironmentType;
  provider: string;
  region?: string;
  labels?: Record<string, string>;
  updatedAt: string;
}

export interface NetworkResource extends BaseDomainResource {
  kind: 'service' | 'ingress' | 'network-policy';
  namespace: string;
}

export interface WorkloadResource extends BaseDomainResource {
  kind: 'deployment' | 'statefulset' | 'daemonset' | 'job' | 'cronjob' | 'pod';
  namespace: string;
  replicas?: number;
}

export interface StorageResource extends BaseDomainResource {
  kind: 'pv' | 'pvc' | 'storage-class';
  capacity?: string;
}

export interface UserResource extends BaseDomainResource {
  username: string;
  email: string;
}

export interface RbacResource extends BaseDomainResource {
  subjectType: 'user' | 'group' | 'service-account';
  role: string;
  scope: string;
}

export interface ConfigResource extends BaseDomainResource {
  kind: 'configmap' | 'secret';
  namespace: string;
}

export interface SecurityResource extends BaseDomainResource {
  kind: 'policy' | 'scan' | 'compliance';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface LogResource {
  id: string;
  clusterId: string;
  namespace: string;
  pod: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

export interface MonitoringResource {
  id: string;
  metric: string;
  value: number;
  unit: string;
  timestamp: string;
}

export type HpaMetricTargetType = 'Utilization' | 'AverageValue' | 'Value';
export type HpaMetricSourceType = 'Resource' | 'Pods' | 'External';

export interface HpaResourceMetricSpec {
  sourceType: 'Resource';
  name: 'cpu' | 'memory' | string;
  targetType: HpaMetricTargetType;
  targetValue: string;
}

export interface HpaPodsMetricSpec {
  sourceType: 'Pods';
  metricName: string;
  selector?: Record<string, string>;
  targetType: Exclude<HpaMetricTargetType, 'Utilization'>;
  targetValue: string;
}

export interface HpaExternalMetricSpec {
  sourceType: 'External';
  metricName: string;
  selector?: Record<string, string>;
  targetType: Exclude<HpaMetricTargetType, 'Utilization'>;
  targetValue: string;
}

export type HpaMetricSpec =
  | HpaResourceMetricSpec
  | HpaPodsMetricSpec
  | HpaExternalMetricSpec;

export interface HpaBehaviorPolicySpec {
  type: 'Pods' | 'Percent';
  value: number;
  periodSeconds: number;
}

export interface HpaBehaviorRuleSpec {
  stabilizationWindowSeconds?: number;
  selectPolicy?: 'Max' | 'Min' | 'Disabled';
  policies?: HpaBehaviorPolicySpec[];
}

export interface HpaBehaviorSpec {
  scaleUp?: HpaBehaviorRuleSpec;
  scaleDown?: HpaBehaviorRuleSpec;
}

export interface AiSessionResource extends BaseDomainResource {
  sessionId: string;
  title: string;
}

export interface TerminalSessionResource {
  sessionId: string;
  clusterId: string;
  namespace?: string;
  pod?: string;
  container?: string;
  state: 'pending' | 'connected' | 'disconnected' | 'closed';
  createdAt: string;
}
