export type ResourceDetailSection =
  | 'overview'
  | 'runtime'
  | 'associations'
  | 'network'
  | 'storage'
  | 'events'
  | 'metadata';

export const RESOURCE_DETAIL_DESCRIPTOR_VERSION = 'v1';

export const RESOURCE_DETAIL_SECTIONS: ResourceDetailSection[] = [
  'overview',
  'runtime',
  'associations',
  'network',
  'storage',
  'events',
  'metadata',
];

export interface ResourceDetailDescriptor {
  resourceKind: string;
  sections: ResourceDetailSection[];
  fieldsBySection: Record<ResourceDetailSection, string[]>;
  version: string;
}

export interface ResourceAssociation {
  id?: string;
  kind: string;
  name: string;
  namespace?: string;
  associationType: string;
}

export interface ResourceDetailNetworkEndpointPort {
  port: number;
  protocol?: string;
  targetPort?: string;
}

export interface ResourceDetailNetworkEndpoint {
  id?: string;
  sourceId?: string;
  kind: 'service-port' | 'ingress-rule' | 'gateway-listener' | 'gateway-route';
  name: string;
  namespace?: string;
  sourceKind?: string;
  sourceName?: string;
  host?: string;
  path?: string;
  ip?: string;
  hostname?: string;
  allowedRoutesFrom?: string;
  ports?: ResourceDetailNetworkEndpointPort[];
}

export interface ResourceDetailNetworkSummary {
  clusterIPs: string[];
  podIPs: string[];
  nodeNames: string[];
  endpoints: ResourceDetailNetworkEndpoint[];
  networkPipelines: ResourceDetailNetworkPipeline[];
  service?: ResourceDetailServiceSummary;
}

export interface ResourceDetailServiceSummary {
  type?: string;
  selector?: string;
  externalIPs?: string[];
  loadBalancerIPs?: string[];
  sessionAffinity?: string;
  externalTrafficPolicy?: string;
  internalTrafficPolicy?: string;
  publishNotReadyAddresses?: boolean;
}

export interface ResourceDetailNetworkPipeline {
  sourceKind: string;
  sourceName: string;
  sourceNamespace?: string;
  sourceId?: string;
  host?: string;
  path?: string;
  port?: number;
  serviceName?: string;
  serviceNamespace?: string;
  serviceId?: string;
  servicePort?: string;
  endpointSourceKind?: string;
  endpointSourceName?: string;
  endpointSourceId?: string;
  backendPodName?: string;
  backendPodNamespace?: string;
  backendPodId?: string;
  ip?: string;
  ready?: boolean;
}

export interface ResourceDetailVolumeSummary {
  name: string;
  type: string;
  source?: string;
}

export interface ResourceDetailMountSummary {
  container: string;
  volume: string;
  mountPath: string;
  readOnly: boolean;
}

export interface ResourceDetailPvcSummary {
  name: string;
  namespace?: string;
  phase?: string;
  storageClass?: string;
  volumeName?: string;
  capacity?: string;
  accessModes?: string[];
  volumeMode?: string;
}

export interface ResourceDetailPvSummary {
  name: string;
  phase?: string;
  storageClass?: string;
  capacity?: string;
  accessModes?: string[];
  volumeMode?: string;
  reclaimPolicy?: string;
  claimRef?: string;
}

export interface ResourceDetailStorageClassSummary {
  name: string;
  provisioner?: string;
  reclaimPolicy?: string;
  bindingMode?: string;
  allowVolumeExpansion?: boolean;
  parameters?: Record<string, string>;
  mountOptions?: string[];
}

export interface ResourceDetailStoragePipeline {
  container: string;
  mountPath: string;
  readOnly: boolean;
  volumeName: string;
  volumeType?: string;
  volumeSource?: string;
  pvcName?: string;
  pvcNamespace?: string;
  pvcPhase?: string;
  pvName?: string;
  pvPhase?: string;
  storageClass?: string;
}

export interface ResourceDetailStorageSummary {
  storageClasses: string[];
  persistentVolumeClaims: ResourceDetailPvcSummary[];
  persistentVolumes: ResourceDetailPvSummary[];
  storageClassDetails: ResourceDetailStorageClassSummary[];
  volumes: ResourceDetailVolumeSummary[];
  mounts: ResourceDetailMountSummary[];
  storagePipelines: ResourceDetailStoragePipeline[];
}

export interface ResourceDetailOwnerReference {
  kind?: string;
  name?: string;
  uid?: string;
  controller?: boolean;
}

export interface ResourceDetailMetadata {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  ownerReferences: ResourceDetailOwnerReference[];
  configUsages: ResourceDetailConfigUsage[];
}

export type ResourceDetailConfigUsageType =
  | 'volume'
  | 'env'
  | 'envFrom'
  | 'projected'
  | 'imagePullSecret'
  | 'token'
  | 'tls'
  | 'unknown';

export interface ResourceDetailConfigUsage {
  referencedKind: string;
  referencedName: string;
  referencedNamespace?: string;
  referencedId?: string;
  consumerKind: string;
  consumerName: string;
  consumerNamespace?: string;
  consumerId?: string;
  usageType: ResourceDetailConfigUsageType;
  container?: string;
  mountPath?: string;
  key?: string;
}

export type ResourceDetailRelationshipGroupKey =
  | 'control'
  | 'network'
  | 'storage'
  | 'config'
  | 'other';

export interface ResourceDetailRelationshipNode {
  kind?: string;
  name?: string;
  namespace?: string;
  id?: string;
  clusterId?: string;
  apiVersion?: string;
  role?: string;
  color?: string;
}

export interface ResourceDetailRelationshipItem {
  key: string;
  title: string;
  subtitle?: string;
  tags?: Array<{ label: string; color?: string }>;
  chain: ResourceDetailRelationshipNode[];
}

export interface ResourceDetailRelationshipGroup {
  key: ResourceDetailRelationshipGroupKey;
  title: string;
  description: string;
  items: ResourceDetailRelationshipItem[];
}

export interface ResourceDetailRuntime {
  phase?: string;
  replicas?: number;
  readyReplicas?: number;
  availableReplicas?: number;
  restartCount?: number;
  image?: string;
  images: string[];
  podIP?: string;
  nodeName?: string;
  selector?: string;
  serviceAccountName?: string;
  restartPolicy?: string;
  dnsPolicy?: string;
  schedulerName?: string;
  priorityClassName?: string;
  nodeSelector?: Record<string, string>;
  tolerations?: Array<Record<string, string>>;
  containerDetails?: ResourceDetailContainerSummary[];
  controllerName?: string;
  gatewayClassName?: string;
  hostnames?: string[];
  parentRefs?: string[];
  backendRefs?: string[];
  ready?: boolean;
  roles?: string[];
  internalIP?: string;
  externalIP?: string;
  osImage?: string;
  kernelVersion?: string;
  containerRuntimeVersion?: string;
  cpuCapacity?: string;
  memoryCapacity?: string;
  taints?: string[];
  unschedulable?: boolean;
  policyTypes?: string[];
  podSelector?: string;
  ingressRules?: ResourceDetailNetworkPolicyRule[];
  egressRules?: ResourceDetailNetworkPolicyRule[];
  conditions?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
  }>;
}

export interface ResourceDetailNetworkPolicyRule {
  peers?: Array<{
    namespaceSelector?: string;
    podSelector?: string;
    ipBlock?: string;
  }>;
  ports?: Array<{
    protocol?: string;
    port?: string;
  }>;
}

export interface ResourceDetailContainerSummary {
  name: string;
  image?: string;
  ports?: Array<{ name?: string; containerPort?: number; protocol?: string }>;
  env?: string[];
  probes?: string[];
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
}

export interface ResourceDetailOverview {
  id: string;
  clusterId: string;
  namespace?: string;
  kind: string;
  name: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceDetailResponse {
  descriptor: ResourceDetailDescriptor;
  overview: ResourceDetailOverview;
  runtime: ResourceDetailRuntime;
  rawSpec?: Record<string, unknown>;
  rawStatus?: Record<string, unknown>;
  associations: ResourceAssociation[];
  network: ResourceDetailNetworkSummary;
  storage: ResourceDetailStorageSummary;
  events: {
    items: Array<Record<string, unknown>>;
  };
  metadata: ResourceDetailMetadata;
  relationships: ResourceDetailRelationshipGroup[];
  generatedAt: string;
}
