import { ApiError, apiRequest } from "./client";

export interface ResourceIdentity {
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
}

export interface ResourceYamlResponse extends ResourceIdentity {
  yaml: string;
  resourceVersion?: string;
  updatedAt?: string;
}

export interface ResourceYamlUpdatePayload extends ResourceIdentity {
  yaml: string;
}

export interface ResourceImageUpdatePayload extends ResourceIdentity {
  image: string;
  container?: string;
}

export interface ResourceScalePayload extends ResourceIdentity {
  replicas: number;
}

export type ResourceDetailSection =
  | "overview"
  | "runtime"
  | "associations"
  | "network"
  | "storage"
  | "events"
  | "metadata";

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
  kind: "service-port" | "ingress-rule" | "gateway-listener" | "gateway-route";
  id?: string;
  name: string;
  namespace?: string;
  sourceKind?: string;
  sourceName?: string;
  sourceId?: string;
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

export interface ResourceDetailStoragePipelineSummary {
  container: string;
  mountPath: string;
  readOnly: boolean;
  volumeName?: string;
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
  storagePipelines: ResourceDetailStoragePipelineSummary[];
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
  | "volume"
  | "env"
  | "envFrom"
  | "projected"
  | "imagePullSecret"
  | "token"
  | "tls"
  | "unknown";

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
  | "control"
  | "network"
  | "storage"
  | "config"
  | "other";

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
  conditions?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
  }>;
  policyTypes?: string[];
  podSelector?: string;
  ingressRules?: Array<{
    peers?: Array<{ namespaceSelector?: string; podSelector?: string; ipBlock?: string }>;
    ports?: Array<{ protocol?: string; port?: string }>;
  }>;
  egressRules?: Array<{
    peers?: Array<{ namespaceSelector?: string; podSelector?: string; ipBlock?: string }>;
    ports?: Array<{ protocol?: string; port?: string }>;
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

export interface ResourceDetailEvent {
  id?: string;
  name?: string;
  namespace?: string;
  type?: string;
  reason?: string;
  message?: string;
  action?: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  eventTime?: string;
  source?: string;
  sourceHost?: string;
  reportingComponent?: string;
  reportingInstance?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
    namespace?: string;
    fieldPath?: string;
    uid?: string;
  };
  related?: {
    kind?: string;
    name?: string;
    namespace?: string;
    fieldPath?: string;
    uid?: string;
  };
}

export interface ResourceDetailResponse {
  descriptor: ResourceDetailDescriptor;
  overview: ResourceDetailOverview;
  runtime: ResourceDetailRuntime;
  associations: ResourceAssociation[];
  network: ResourceDetailNetworkSummary;
  storage: ResourceDetailStorageSummary;
  events: {
    items: ResourceDetailEvent[];
  };
  metadata: ResourceDetailMetadata;
  relationships: ResourceDetailRelationshipGroup[];
  generatedAt: string;
}

export interface ResourceDetailRequest {
  kind: string;
  id: string;
}

const YAML_GET_PATHS = [
  "/api/resources/yaml",
  "/api/resources/manifest",
  "/api/runtime/resources/yaml",
] as const;

const YAML_UPDATE_PATHS = [
  { path: "/api/resources/yaml", method: "PUT" as const },
  { path: "/api/resources/yaml", method: "PATCH" as const },
  { path: "/api/resources/manifest", method: "PUT" as const },
  { path: "/api/runtime/resources/yaml", method: "PUT" as const },
] as const;

const IMAGE_UPDATE_PATHS = [
  "/api/resources/image",
  "/api/resources/actions/image",
  "/api/runtime/resources/image",
] as const;

const SCALE_PATHS = [
  "/api/resources/scale",
  "/api/resources/actions/scale",
  "/api/runtime/resources/scale",
] as const;

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

async function tryGetWithFallback<T>(
  paths: readonly string[],
  query: Record<string, string>,
  token?: string,
): Promise<T> {
  let lastError: unknown;
  for (const path of paths) {
    try {
      return await apiRequest<T>(path, { method: "GET", query, token });
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
      lastError = err;
    }
  }
  throw lastError ?? new Error("通用资源接口不可用");
}

async function tryWriteWithFallback<TPayload, TResponse>(
  entries: readonly { path: string; method: "POST" | "PUT" | "PATCH" }[],
  body: TPayload,
  token?: string,
): Promise<TResponse> {
  let lastError: unknown;
  for (const entry of entries) {
    try {
      return await apiRequest<TResponse, TPayload>(entry.path, {
        method: entry.method,
        body,
        token,
      });
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
      lastError = err;
    }
  }
  throw lastError ?? new Error("通用资源接口不可用");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isObject(item)) : [];
}

function normalizeConfigUsageType(value: unknown): ResourceDetailConfigUsageType {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "volume") return "volume";
  if (normalized === "env") return "env";
  if (normalized === "envfrom") return "envFrom";
  if (normalized === "projected") return "projected";
  if (normalized === "imagepullsecret") return "imagePullSecret";
  if (normalized === "token" || normalized === "serviceaccounttoken") return "token";
  if (normalized === "tls") return "tls";
  return "unknown";
}

function normalizeRelationshipGroupKey(
  value: unknown,
): ResourceDetailRelationshipGroupKey {
  if (typeof value !== "string") {
    return "other";
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "control" ||
    normalized === "network" ||
    normalized === "storage" ||
    normalized === "config" ||
    normalized === "other"
  ) {
    return normalized;
  }
  return "other";
}

function normalizeRelationshipGroups(
  value: unknown,
): ResourceDetailRelationshipGroup[] {
  return asObjectArray(value).map((group, groupIndex) => ({
    key: normalizeRelationshipGroupKey(group.key),
    title: toStringValue(group.title),
    description: toStringValue(group.description),
    items: asObjectArray(group.items).map((item, itemIndex) => ({
      key: toStringValue(item.key, `relationship-${groupIndex}-${itemIndex}`),
      title: toStringValue(item.title),
      subtitle: toOptionalString(item.subtitle),
      tags: asObjectArray(item.tags).map((tag) => ({
        label: toStringValue(tag.label),
        color: toOptionalString(tag.color),
      })),
      chain: asObjectArray(item.chain).map((node) => ({
        kind: toOptionalString(node.kind),
        name: toOptionalString(node.name),
        namespace: toOptionalString(node.namespace),
        id: toOptionalString(node.id),
        clusterId: toOptionalString(node.clusterId),
        apiVersion: toOptionalString(node.apiVersion),
        role: toOptionalString(node.role),
        color: toOptionalString(node.color),
      })),
    })),
  }));
}

function normalizeResourceKind(kind: string): string {
  const value = kind.trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (value) {
    case "serviceaccount":
    case "serviceaccounts":
      return "serviceaccount";
    case "secret":
    case "secrets":
      return "secret";
    case "configmap":
    case "configmaps":
      return "configmap";
    case "endpoints":
    case "endpoint":
      return "endpoints";
    case "endpointslice":
    case "endpointslices":
      return "endpointslice";
    case "networkpolicy":
    case "networkpolicies":
      return "network-policy";
    case "gatewayclass":
    case "gatewayclasses":
      return "gatewayclass";
    case "gateway":
    case "gateways":
      return "gateway";
    case "httproute":
    case "httproutes":
      return "httproute";
    case "horizontalpodautoscaler":
    case "horizontalpodautoscalers":
      return "horizontalpodautoscaler";
    case "verticalpodautoscaler":
    case "verticalpodautoscalers":
      return "verticalpodautoscaler";
    default:
      return value;
  }
}

export async function getResourceYaml(identity: ResourceIdentity, token?: string): Promise<ResourceYamlResponse> {
  const payload = await tryGetWithFallback<unknown>(
    YAML_GET_PATHS,
    {
      clusterId: identity.clusterId,
      namespace: identity.namespace,
      kind: identity.kind,
      name: identity.name,
    },
    token,
  );

  if (!payload || typeof payload !== "object") {
    return {
      ...identity,
      yaml: "",
    };
  }

  const data = payload as Partial<ResourceYamlResponse> & { manifest?: string };
  const yaml = typeof data.yaml === "string" ? data.yaml : typeof data.manifest === "string" ? data.manifest : "";

  return {
    clusterId: typeof data.clusterId === "string" ? data.clusterId : identity.clusterId,
    namespace: typeof data.namespace === "string" ? data.namespace : identity.namespace,
    kind: typeof data.kind === "string" ? data.kind : identity.kind,
    name: typeof data.name === "string" ? data.name : identity.name,
    yaml,
    resourceVersion: typeof data.resourceVersion === "string" ? data.resourceVersion : undefined,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
  };
}

export async function updateResourceYaml(payload: ResourceYamlUpdatePayload, token?: string) {
  return tryWriteWithFallback<ResourceYamlUpdatePayload, unknown>(YAML_UPDATE_PATHS, payload, token);
}

export async function updateResourceImage(payload: ResourceImageUpdatePayload, token?: string) {
  return tryWriteWithFallback<ResourceImageUpdatePayload, unknown>(
    IMAGE_UPDATE_PATHS.map((path) => ({ path, method: "POST" as const })),
    payload,
    token,
  );
}

export async function scaleResource(payload: ResourceScalePayload, token?: string) {
  return tryWriteWithFallback<ResourceScalePayload, unknown>(
    SCALE_PATHS.map((path) => ({ path, method: "POST" as const })),
    payload,
    token,
  );
}

export async function getResourceDetail(
  request: ResourceDetailRequest,
  token?: string,
): Promise<ResourceDetailResponse> {
  const kind = encodeURIComponent(normalizeResourceKind(request.kind));
  const id = encodeURIComponent(request.id.trim());
  const path = `/api/resources/${kind}/${id}/detail`;
  const payload = await apiRequest<unknown>(path, { method: "GET", token });

  if (!isObject(payload)) {
    throw new Error("资源详情返回格式无效");
  }

  const payloadData = isObject(payload.data) ? payload.data : payload;
  const descriptorRaw = isObject(payloadData.descriptor) ? payloadData.descriptor : {};
  const overviewRaw = isObject(payloadData.overview) ? payloadData.overview : {};
  const runtimeRaw = isObject(payloadData.runtime) ? payloadData.runtime : {};
  const networkRaw = isObject(payloadData.network) ? payloadData.network : {};
  const storageRaw = isObject(payloadData.storage) ? payloadData.storage : {};
  const metadataRaw = isObject(payloadData.metadata) ? payloadData.metadata : {};
  const eventsRaw = isObject(payloadData.events) ? payloadData.events : {};
  const detailRaw = isObject(payloadData.detail) ? payloadData.detail : {};

  const networkPipelineRaw =
    networkRaw.networkPipelines ??
    networkRaw.networkPipeline ??
    networkRaw.pipelines ??
    payloadData.networkPipelines ??
    payloadData.networkPipeline ??
    payloadData.pipelines ??
    detailRaw.networkPipelines ??
    detailRaw.networkPipeline;

  const configUsageRaw =
    metadataRaw.configUsages ??
    metadataRaw.configUsage ??
    metadataRaw.usages ??
    payloadData.configUsages ??
    payloadData.configUsage ??
    detailRaw.configUsages ??
    detailRaw.configUsage;

  return {
    descriptor: {
      resourceKind: toStringValue(descriptorRaw.resourceKind),
      sections: Array.isArray(descriptorRaw.sections)
        ? descriptorRaw.sections.filter((item): item is ResourceDetailSection => typeof item === "string")
        : [],
      fieldsBySection: isObject(descriptorRaw.fieldsBySection)
        ? (descriptorRaw.fieldsBySection as Record<ResourceDetailSection, string[]>)
        : {
            overview: [],
            runtime: [],
            associations: [],
            network: [],
            storage: [],
            events: [],
            metadata: [],
          },
      version: toStringValue(descriptorRaw.version),
    },
    overview: {
      id: toStringValue(overviewRaw.id),
      clusterId: toStringValue(overviewRaw.clusterId),
      namespace: typeof overviewRaw.namespace === "string" ? overviewRaw.namespace : undefined,
      kind: toStringValue(overviewRaw.kind),
      name: toStringValue(overviewRaw.name),
      state: toStringValue(overviewRaw.state),
      createdAt: toStringValue(overviewRaw.createdAt),
      updatedAt: toStringValue(overviewRaw.updatedAt),
    },
    runtime: {
      phase: typeof runtimeRaw.phase === "string" ? runtimeRaw.phase : undefined,
      replicas: typeof runtimeRaw.replicas === "number" ? runtimeRaw.replicas : undefined,
      readyReplicas:
        typeof runtimeRaw.readyReplicas === "number" ? runtimeRaw.readyReplicas : undefined,
      availableReplicas:
        typeof runtimeRaw.availableReplicas === "number" ? runtimeRaw.availableReplicas : undefined,
      restartCount:
        typeof runtimeRaw.restartCount === "number" ? runtimeRaw.restartCount : undefined,
      image: typeof runtimeRaw.image === "string" ? runtimeRaw.image : undefined,
      images: Array.isArray(runtimeRaw.images)
        ? runtimeRaw.images.filter((item): item is string => typeof item === "string")
        : [],
      podIP: typeof runtimeRaw.podIP === "string" ? runtimeRaw.podIP : undefined,
      nodeName: typeof runtimeRaw.nodeName === "string" ? runtimeRaw.nodeName : undefined,
      selector: typeof runtimeRaw.selector === "string" ? runtimeRaw.selector : undefined,
      serviceAccountName:
        typeof runtimeRaw.serviceAccountName === "string"
          ? runtimeRaw.serviceAccountName
          : undefined,
      restartPolicy:
        typeof runtimeRaw.restartPolicy === "string" ? runtimeRaw.restartPolicy : undefined,
      dnsPolicy: typeof runtimeRaw.dnsPolicy === "string" ? runtimeRaw.dnsPolicy : undefined,
      schedulerName:
        typeof runtimeRaw.schedulerName === "string" ? runtimeRaw.schedulerName : undefined,
      priorityClassName:
        typeof runtimeRaw.priorityClassName === "string"
          ? runtimeRaw.priorityClassName
          : undefined,
      nodeSelector: isObject(runtimeRaw.nodeSelector)
        ? Object.fromEntries(
            Object.entries(runtimeRaw.nodeSelector).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : undefined,
      tolerations: Array.isArray(runtimeRaw.tolerations)
        ? runtimeRaw.tolerations.filter(
            (item): item is Record<string, string> => isObject(item),
          )
        : undefined,
      containerDetails: Array.isArray(runtimeRaw.containerDetails)
        ? runtimeRaw.containerDetails
            .filter((item): item is ResourceDetailContainerSummary => isObject(item))
            .map((item) => ({
              name: toStringValue(item.name),
              image: typeof item.image === "string" ? item.image : undefined,
              ports: Array.isArray(item.ports)
                ? item.ports
                    .filter((port): port is NonNullable<ResourceDetailContainerSummary["ports"]>[number] => isObject(port))
                    .map((port) => ({
                      name: typeof port.name === "string" ? port.name : undefined,
                      containerPort:
                        typeof port.containerPort === "number"
                          ? port.containerPort
                          : undefined,
                      protocol:
                        typeof port.protocol === "string" ? port.protocol : undefined,
                    }))
                : undefined,
              env: Array.isArray(item.env)
                ? item.env.filter((env): env is string => typeof env === "string")
                : undefined,
              probes: Array.isArray(item.probes)
                ? item.probes.filter(
                    (probe): probe is string => typeof probe === "string",
                  )
                : undefined,
              resources: isObject(item.resources)
                ? {
                    requests: isObject(item.resources.requests)
                      ? Object.fromEntries(
                          Object.entries(item.resources.requests).filter(
                            (entry): entry is [string, string] =>
                              typeof entry[1] === "string",
                          ),
                        )
                      : undefined,
                    limits: isObject(item.resources.limits)
                      ? Object.fromEntries(
                          Object.entries(item.resources.limits).filter(
                            (entry): entry is [string, string] =>
                              typeof entry[1] === "string",
                          ),
                        )
                      : undefined,
                  }
                : undefined,
            }))
        : undefined,
      policyTypes: Array.isArray(runtimeRaw.policyTypes)
        ? runtimeRaw.policyTypes.filter((item): item is string => typeof item === "string")
        : undefined,
      podSelector: typeof runtimeRaw.podSelector === "string" ? runtimeRaw.podSelector : undefined,
      ingressRules: Array.isArray(runtimeRaw.ingressRules)
        ? runtimeRaw.ingressRules.filter((item): item is {
            peers?: Array<{ namespaceSelector?: string; podSelector?: string; ipBlock?: string }>;
            ports?: Array<{ protocol?: string; port?: string }>;
          } => isObject(item)).map((item) => ({
            peers: Array.isArray(item.peers)
              ? item.peers.filter((peer): peer is { namespaceSelector?: string; podSelector?: string; ipBlock?: string } => isObject(peer))
              : [],
            ports: Array.isArray(item.ports)
              ? item.ports.filter((port): port is { protocol?: string; port?: string } => isObject(port))
              : [],
          }))
        : undefined,
      egressRules: Array.isArray(runtimeRaw.egressRules)
        ? runtimeRaw.egressRules.filter((item): item is {
            peers?: Array<{ namespaceSelector?: string; podSelector?: string; ipBlock?: string }>;
            ports?: Array<{ protocol?: string; port?: string }>;
          } => isObject(item)).map((item) => ({
            peers: Array.isArray(item.peers)
              ? item.peers.filter((peer): peer is { namespaceSelector?: string; podSelector?: string; ipBlock?: string } => isObject(peer))
              : [],
            ports: Array.isArray(item.ports)
              ? item.ports.filter((port): port is { protocol?: string; port?: string } => isObject(port))
              : [],
          }))
        : undefined,
    },
    associations: Array.isArray(payload.associations)
      ? payload.associations.filter((item): item is ResourceAssociation => isObject(item)).map((item) => ({
          id: typeof item.id === "string" ? item.id : undefined,
          kind: toStringValue(item.kind),
          name: toStringValue(item.name),
          namespace: typeof item.namespace === "string" ? item.namespace : undefined,
          associationType: toStringValue(item.associationType),
        }))
      : [],
    network: {
      clusterIPs: Array.isArray(networkRaw.clusterIPs)
        ? networkRaw.clusterIPs.filter((item): item is string => typeof item === "string")
        : [],
      podIPs: Array.isArray(networkRaw.podIPs)
        ? networkRaw.podIPs.filter((item): item is string => typeof item === "string")
        : [],
      nodeNames: Array.isArray(networkRaw.nodeNames)
        ? networkRaw.nodeNames.filter((item): item is string => typeof item === "string")
        : [],
      endpoints: Array.isArray(networkRaw.endpoints)
        ? networkRaw.endpoints.filter((item): item is ResourceDetailNetworkEndpoint => isObject(item)).map((item) => ({
            kind:
              item.kind === "ingress-rule" ||
              item.kind === "gateway-listener" ||
              item.kind === "gateway-route"
                ? item.kind
                : "service-port",
            id: typeof item.id === "string" ? item.id : undefined,
            name: toStringValue(item.name),
            namespace: typeof item.namespace === "string" ? item.namespace : undefined,
            sourceKind: typeof item.sourceKind === "string" ? item.sourceKind : undefined,
            sourceName: typeof item.sourceName === "string" ? item.sourceName : undefined,
            sourceId: typeof item.sourceId === "string" ? item.sourceId : undefined,
            host: typeof item.host === "string" ? item.host : undefined,
            path: typeof item.path === "string" ? item.path : undefined,
            ip: typeof item.ip === "string" ? item.ip : undefined,
            hostname: typeof item.hostname === "string" ? item.hostname : undefined,
            ports: Array.isArray(item.ports)
              ? item.ports
                  .filter((port): port is ResourceDetailNetworkEndpointPort => isObject(port))
                  .map((port) => ({
                    port: typeof port.port === "number" ? port.port : 0,
                    protocol: typeof port.protocol === "string" ? port.protocol : undefined,
                    targetPort: typeof port.targetPort === "string" ? port.targetPort : undefined,
                  }))
              : [],
          }))
        : [],
      networkPipelines: asObjectArray(networkPipelineRaw).map((item) => ({
        sourceKind:
          toStringValue(item.sourceKind) ||
          toStringValue(item.entryKind) ||
          toStringValue(item.routeKind) ||
          toStringValue(item.fromKind),
        sourceName:
          toStringValue(item.sourceName) ||
          toStringValue(item.entryName) ||
          toStringValue(item.routeName) ||
          toStringValue(item.fromName),
        sourceNamespace:
          toOptionalString(item.sourceNamespace) ??
          toOptionalString(item.entryNamespace) ??
          toOptionalString(item.fromNamespace),
        sourceId: toOptionalString(item.sourceId) ?? toOptionalString(item.entryId) ?? toOptionalString(item.fromId),
        host: toOptionalString(item.host) ?? toOptionalString(item.hostname),
        path: toOptionalString(item.path) ?? toOptionalString(item.match),
        port: toOptionalNumber(item.port) ?? toOptionalNumber(item.listenerPort),
        serviceName:
          toOptionalString(item.serviceName) ??
          toOptionalString(item.backendService) ??
          toOptionalString(item.targetServiceName),
        serviceNamespace:
          toOptionalString(item.serviceNamespace) ??
          toOptionalString(item.backendServiceNamespace) ??
          toOptionalString(item.targetServiceNamespace),
        serviceId: toOptionalString(item.serviceId) ?? toOptionalString(item.backendServiceId),
        servicePort:
          toOptionalString(item.servicePort) ??
          toOptionalString(item.backendServicePort) ??
          toOptionalString(item.targetPort),
        endpointSourceKind:
          toOptionalString(item.endpointSourceKind) ??
          toOptionalString(item.endpointKind) ??
          toOptionalString(item.endpointSource),
        endpointSourceName:
          toOptionalString(item.endpointSourceName) ??
          toOptionalString(item.endpointName),
        endpointSourceId:
          toOptionalString(item.endpointSourceId) ?? toOptionalString(item.endpointId),
        backendPodName:
          toOptionalString(item.backendPodName) ??
          toOptionalString(item.podName) ??
          toOptionalString(item.targetPodName),
        backendPodNamespace:
          toOptionalString(item.backendPodNamespace) ??
          toOptionalString(item.podNamespace) ??
          toOptionalString(item.targetPodNamespace),
        backendPodId: toOptionalString(item.backendPodId) ?? toOptionalString(item.podId),
        ip: toOptionalString(item.ip) ?? toOptionalString(item.podIP) ?? toOptionalString(item.backendIP),
        ready: toOptionalBoolean(item.ready) ?? toOptionalBoolean(item.isReady),
      })),
      service: isObject(networkRaw.service)
        ? {
            type: toOptionalString(networkRaw.service.type),
            selector: toOptionalString(networkRaw.service.selector),
            externalIPs: Array.isArray(networkRaw.service.externalIPs)
              ? networkRaw.service.externalIPs.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
            loadBalancerIPs: Array.isArray(networkRaw.service.loadBalancerIPs)
              ? networkRaw.service.loadBalancerIPs.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
            sessionAffinity: toOptionalString(networkRaw.service.sessionAffinity),
            externalTrafficPolicy: toOptionalString(
              networkRaw.service.externalTrafficPolicy,
            ),
            internalTrafficPolicy: toOptionalString(
              networkRaw.service.internalTrafficPolicy,
            ),
            publishNotReadyAddresses: toOptionalBoolean(
              networkRaw.service.publishNotReadyAddresses,
            ),
          }
        : undefined,
    },
    storage: {
      storageClasses: Array.isArray(storageRaw.storageClasses)
        ? storageRaw.storageClasses.filter((item): item is string => typeof item === "string")
        : [],
      persistentVolumeClaims: Array.isArray(storageRaw.persistentVolumeClaims)
        ? storageRaw.persistentVolumeClaims
            .filter((item): item is ResourceDetailPvcSummary => isObject(item))
            .map((item) => ({
              name: toStringValue(item.name),
              namespace: typeof item.namespace === "string" ? item.namespace : undefined,
              phase: typeof item.phase === "string" ? item.phase : undefined,
              storageClass:
                typeof item.storageClass === "string" ? item.storageClass : undefined,
              volumeName: typeof item.volumeName === "string" ? item.volumeName : undefined,
              capacity: typeof item.capacity === "string" ? item.capacity : undefined,
              accessModes: Array.isArray(item.accessModes)
                ? item.accessModes.filter(
                    (mode): mode is string => typeof mode === "string",
                  )
                : undefined,
              volumeMode:
                typeof item.volumeMode === "string" ? item.volumeMode : undefined,
            }))
        : [],
      persistentVolumes: Array.isArray(storageRaw.persistentVolumes)
        ? storageRaw.persistentVolumes
            .filter((item): item is ResourceDetailPvSummary => isObject(item))
            .map((item) => ({
              name: toStringValue(item.name),
              phase: typeof item.phase === "string" ? item.phase : undefined,
              storageClass:
                typeof item.storageClass === "string" ? item.storageClass : undefined,
              capacity: typeof item.capacity === "string" ? item.capacity : undefined,
              accessModes: Array.isArray(item.accessModes)
                ? item.accessModes.filter(
                    (mode): mode is string => typeof mode === "string",
                  )
                : undefined,
              volumeMode:
                typeof item.volumeMode === "string" ? item.volumeMode : undefined,
              reclaimPolicy:
                typeof item.reclaimPolicy === "string" ? item.reclaimPolicy : undefined,
              claimRef: typeof item.claimRef === "string" ? item.claimRef : undefined,
            }))
        : [],
      storageClassDetails: Array.isArray(storageRaw.storageClassDetails)
        ? storageRaw.storageClassDetails
            .filter((item): item is ResourceDetailStorageClassSummary => isObject(item))
            .map((item) => ({
              name: toStringValue(item.name),
              provisioner:
                typeof item.provisioner === "string" ? item.provisioner : undefined,
              reclaimPolicy:
                typeof item.reclaimPolicy === "string" ? item.reclaimPolicy : undefined,
              bindingMode:
                typeof item.bindingMode === "string" ? item.bindingMode : undefined,
              allowVolumeExpansion:
                typeof item.allowVolumeExpansion === "boolean"
                  ? item.allowVolumeExpansion
                  : undefined,
              parameters: isObject(item.parameters)
                ? Object.fromEntries(
                    Object.entries(item.parameters).filter(
                      (entry): entry is [string, string] =>
                        typeof entry[1] === "string",
                    ),
                  )
                : undefined,
              mountOptions: Array.isArray(item.mountOptions)
                ? item.mountOptions.filter(
                    (option): option is string => typeof option === "string",
                  )
                : undefined,
            }))
        : [],
      volumes: Array.isArray(storageRaw.volumes)
        ? storageRaw.volumes
            .filter((item): item is ResourceDetailVolumeSummary => isObject(item))
            .map((item) => ({
              name: toStringValue(item.name),
              type: toStringValue(item.type),
              source: typeof item.source === "string" ? item.source : undefined,
            }))
        : [],
      mounts: Array.isArray(storageRaw.mounts)
        ? storageRaw.mounts
            .filter((item): item is ResourceDetailMountSummary => isObject(item))
            .map((item) => ({
              container: toStringValue(item.container),
              volume: toStringValue(item.volume),
              mountPath: toStringValue(item.mountPath),
              readOnly: Boolean(item.readOnly),
            }))
        : [],
      storagePipelines: Array.isArray(storageRaw.storagePipelines)
        ? storageRaw.storagePipelines
            .filter((item): item is ResourceDetailStoragePipelineSummary => isObject(item))
            .map((item) => ({
              container: toStringValue(item.container),
              mountPath: toStringValue(item.mountPath),
              readOnly: Boolean(item.readOnly),
              volumeName: typeof item.volumeName === "string" ? item.volumeName : undefined,
              volumeType: typeof item.volumeType === "string" ? item.volumeType : undefined,
              volumeSource: typeof item.volumeSource === "string" ? item.volumeSource : undefined,
              pvcName: typeof item.pvcName === "string" ? item.pvcName : undefined,
              pvcNamespace:
                typeof item.pvcNamespace === "string" ? item.pvcNamespace : undefined,
              pvcPhase: typeof item.pvcPhase === "string" ? item.pvcPhase : undefined,
              pvName: typeof item.pvName === "string" ? item.pvName : undefined,
              pvPhase: typeof item.pvPhase === "string" ? item.pvPhase : undefined,
              storageClass:
                typeof item.storageClass === "string" ? item.storageClass : undefined,
            }))
        : [],
    },
    events: {
      items: Array.isArray(eventsRaw.items)
        ? eventsRaw.items.filter((item): item is Record<string, unknown> => isObject(item))
        : [],
    },
    metadata: {
      labels: isObject(metadataRaw.labels)
        ? Object.fromEntries(
            Object.entries(metadataRaw.labels).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
        : {},
      annotations: isObject(metadataRaw.annotations)
        ? Object.fromEntries(
            Object.entries(metadataRaw.annotations).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
        : {},
      ownerReferences: Array.isArray(metadataRaw.ownerReferences)
        ? metadataRaw.ownerReferences
            .filter((item): item is ResourceDetailOwnerReference => isObject(item))
            .map((item) => ({
              kind: typeof item.kind === "string" ? item.kind : undefined,
              name: typeof item.name === "string" ? item.name : undefined,
              uid: typeof item.uid === "string" ? item.uid : undefined,
              controller:
                typeof item.controller === "boolean" ? item.controller : undefined,
            }))
        : [],
      configUsages: asObjectArray(configUsageRaw).map((item) => {
        const referencedRaw = isObject(item.referenced) ? item.referenced : {};
        const consumerRaw = isObject(item.consumer) ? item.consumer : {};
        return {
          referencedKind:
            toStringValue(item.referencedKind) ||
            toStringValue(item.referenceKind) ||
            toStringValue(referencedRaw.kind),
          referencedName:
            toStringValue(item.referencedName) ||
            toStringValue(item.referenceName) ||
            toStringValue(referencedRaw.name),
          referencedNamespace:
            toOptionalString(item.referencedNamespace) ??
            toOptionalString(item.referenceNamespace) ??
            toOptionalString(referencedRaw.namespace),
          referencedId:
            toOptionalString(item.referencedId) ??
            toOptionalString(item.referenceId) ??
            toOptionalString(referencedRaw.id),
          consumerKind:
            toStringValue(item.consumerKind) ||
            toStringValue(item.workloadKind) ||
            toStringValue(consumerRaw.kind),
          consumerName:
            toStringValue(item.consumerName) ||
            toStringValue(item.workloadName) ||
            toStringValue(consumerRaw.name),
          consumerNamespace:
            toOptionalString(item.consumerNamespace) ??
            toOptionalString(item.workloadNamespace) ??
            toOptionalString(consumerRaw.namespace),
          consumerId:
            toOptionalString(item.consumerId) ??
            toOptionalString(item.workloadId) ??
            toOptionalString(consumerRaw.id),
          usageType: normalizeConfigUsageType(item.usageType ?? item.type ?? item.usage),
          container: toOptionalString(item.container) ?? toOptionalString(item.containerName),
          mountPath: toOptionalString(item.mountPath) ?? toOptionalString(item.path),
          key:
            toOptionalString(item.key) ??
            toOptionalString(item.itemKey) ??
            toOptionalString(item.envKey) ??
            toOptionalString(item.secretKey),
        };
      }),
    },
    relationships: normalizeRelationshipGroups(payloadData.relationships),
    generatedAt: toStringValue(payload.generatedAt, new Date().toISOString()),
  };
}

export interface DiscoveryRefreshResponse {
  clusterId: string;
  registered: number;
  timestamp: string;
}

export interface DiscoveryCatalogItem {
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

export interface DiscoveryCatalogResponse {
  clusterId: string;
  items: DiscoveryCatalogItem[];
  total: number;
  stale: boolean;
  refreshError?: string;
  timestamp: string;
}

export interface DynamicResourceQuery {
  clusterId?: string;
  group?: string;
  version: string;
  resource: string;
  namespace?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface DynamicResourceItem {
  id: string;
  clusterId: string;
  namespace: string;
  name: string;
  kind: string;
  apiVersion: string;
  state: string;
  labels?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface DynamicResourceListResponse {
  clusterId: string;
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespaced: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: DynamicResourceItem[];
  timestamp: string;
}

export interface DynamicResourceIdentity {
  clusterId: string;
  group?: string;
  version: string;
  resource: string;
  namespace?: string;
  name: string;
}

export interface DynamicResourceDetailResponse {
  clusterId: string;
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespace: string;
  name: string;
  yaml: string;
  raw: unknown;
  timestamp: string;
}

export interface DynamicResourceYamlUpdatePayload extends DynamicResourceIdentity {
  yaml: string;
  dryRun?: boolean;
}

export async function refreshResourceDiscovery(
  clusterId: string,
  token?: string,
): Promise<DiscoveryRefreshResponse> {
  return apiRequest<DiscoveryRefreshResponse, { clusterId: string }>(
    "/api/resources/discovery/refresh",
    {
      method: "POST",
      body: { clusterId },
      token,
    },
  );
}

export async function getResourceDiscoveryCatalog(
  clusterId: string,
  token?: string,
  opts?: { refresh?: boolean },
): Promise<DiscoveryCatalogResponse> {
  return apiRequest<DiscoveryCatalogResponse>("/api/resources/discovery/catalog", {
    method: "GET",
    query: {
      clusterId,
      refresh: opts?.refresh ? "true" : undefined,
    },
    token,
  });
}

export async function getDynamicResources(
  query: DynamicResourceQuery,
  token?: string,
): Promise<DynamicResourceListResponse> {
  return apiRequest<DynamicResourceListResponse>("/api/resources/dynamic", {
    method: "GET",
    query: {
      clusterId: query.clusterId,
      group: query.group,
      version: query.version,
      resource: query.resource,
      namespace: query.namespace,
      keyword: query.keyword,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    },
    token,
  });
}

export async function getDynamicResourceDetail(
  identity: DynamicResourceIdentity,
  token?: string,
): Promise<DynamicResourceDetailResponse> {
  return apiRequest<DynamicResourceDetailResponse>("/api/resources/dynamic/detail", {
    method: "GET",
    query: {
      clusterId: identity.clusterId,
      group: identity.group,
      version: identity.version,
      resource: identity.resource,
      namespace: identity.namespace,
      name: identity.name,
    },
    token,
  });
}

export async function updateDynamicResourceYaml(
  payload: DynamicResourceYamlUpdatePayload,
  token?: string,
): Promise<unknown> {
  return apiRequest<unknown, DynamicResourceYamlUpdatePayload>("/api/resources/dynamic/yaml", {
    method: "PUT",
    body: payload,
    token,
  });
}

export async function deleteDynamicResource(
  payload: DynamicResourceIdentity,
  token?: string,
): Promise<unknown> {
  return apiRequest<unknown, DynamicResourceIdentity>("/api/resources/dynamic/delete", {
    method: "POST",
    body: payload,
    token,
  });
}

export interface DynamicResourceCreatePayload extends DynamicResourceIdentity {
  body: Record<string, unknown>;
}

export async function createDynamicResource(
  payload: DynamicResourceCreatePayload,
  token?: string,
): Promise<unknown> {
  return apiRequest<unknown, DynamicResourceCreatePayload>("/api/resources/dynamic/create", {
    method: "POST",
    body: payload,
    token,
  });
}
