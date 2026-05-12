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

  const descriptorRaw = isObject(payload.descriptor) ? payload.descriptor : {};
  const overviewRaw = isObject(payload.overview) ? payload.overview : {};
  const runtimeRaw = isObject(payload.runtime) ? payload.runtime : {};
  const networkRaw = isObject(payload.network) ? payload.network : {};
  const storageRaw = isObject(payload.storage) ? payload.storage : {};
  const metadataRaw = isObject(payload.metadata) ? payload.metadata : {};
  const eventsRaw = isObject(payload.events) ? payload.events : {};

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
              item.kind === "ingress-rule" ? "ingress-rule" : "service-port",
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
    },
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
