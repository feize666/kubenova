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
}

export interface ResourceDetailPvSummary {
  name: string;
  phase?: string;
  storageClass?: string;
}

export interface ResourceDetailStorageSummary {
  storageClasses: string[];
  persistentVolumeClaims: ResourceDetailPvcSummary[];
  persistentVolumes: ResourceDetailPvSummary[];
  volumes: ResourceDetailVolumeSummary[];
  mounts: ResourceDetailMountSummary[];
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
  conditions?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
  }>;
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
  associations: ResourceAssociation[];
  network: ResourceDetailNetworkSummary;
  storage: ResourceDetailStorageSummary;
  events: {
    items: Array<Record<string, unknown>>;
  };
  metadata: ResourceDetailMetadata;
  generatedAt: string;
}
