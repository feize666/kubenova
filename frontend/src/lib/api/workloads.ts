import { apiRequest } from "./client";
import { buildResourceListQuery, type ExtendedListQueryParams } from "./helpers";

export type WorkloadStatus = "Running" | "Pending" | "Degraded" | "Failed";
export type WorkloadState = "active" | "disabled" | "deleted";
export type WorkloadKind = "deployments" | "statefulsets" | "daemonsets" | "jobs" | "cronjobs";

export type WorkloadActionType =
  | "scale"
  | "restart"
  | "rollback"
  | "delete"
  | "suspend"
  | "unsuspend"
  | "policy-disable"
  | "policy-enable";

export interface WorkloadItem {
  id?: string;
  kind: string;
  name: string;
  clusterId: string;
  namespace: string;
  status: WorkloadStatus;
  ready: string;
  replicas: string;
  restarts: number;
  age: string;
  state: WorkloadState;
  version: number;
  suspended: boolean;
  policyEnabled: boolean;
  image?: string;
  spec?: Record<string, unknown>;
  statusJson?: Record<string, unknown>;
  observedState?: WorkloadObservedScaleState | null;
  labels?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  readyReplicas?: number;
  availableReplicas?: number;
}

export interface WorkloadsListResponse {
  kind: string;
  items: WorkloadItem[];
  total: number;
  timestamp: string;
}

export interface WorkloadsListParams extends ExtendedListQueryParams {
  clusterId?: string;
  namespace?: string;
}

export interface WorkloadUpdatePayload {
  namespace?: string;
  status?: WorkloadStatus;
  replicas?: string;
}

export interface WorkloadActionPayload {
  action: WorkloadActionType;
  replicas?: number;
  namespace?: string;
  clusterId?: string;
}

export interface WorkloadIdentityPayload {
  namespace: string;
  clusterId: string;
}

export type WorkloadScaleConvergenceStatus = "accepted" | "converging" | "stable" | "timeout";

export interface WorkloadObservedScaleState {
  status?: WorkloadScaleConvergenceStatus | string;
  desiredReplicas?: number | null;
  observedReplicas?: number | null;
  readyReplicas?: number | null;
  availableReplicas?: number | null;
  observedAt?: string;
  acceptedAt?: string;
  timeoutAt?: string;
}

export interface WorkloadScaleResult {
  desiredReplicas: number;
  observedReplicas: number | null;
  readyReplicas: number | null;
  availableReplicas?: number | null;
  observedAt?: string;
  status?: WorkloadScaleConvergenceStatus | string;
  observedState?: WorkloadObservedScaleState;
}

export interface WorkloadActionResponse {
  id: string;
  action: WorkloadActionType;
  accepted: boolean;
  message: string;
  record: WorkloadListItem;
  scaleResult?: WorkloadScaleResult;
  observedState?: WorkloadObservedScaleState;
  timestamp: string;
}

export interface WorkloadStateResponse {
  item: WorkloadItem;
  action: "enable" | "disable";
  message: string;
  timestamp: string;
}

export interface WorkloadUpdateResponse {
  item: WorkloadItem;
  message: string;
  timestamp: string;
}

export function getWorkloads(kind: WorkloadKind | string, params: WorkloadsListParams = {}, token: string) {
  const query = buildResourceListQuery(params);
  const normalizedKind = normalizeLegacyKind(kind);
  return apiRequest<unknown>("/api/workloads", {
    method: "GET",
    query: {
      ...query,
      kind: normalizedKind,
    },
    token,
  }).then((payload) => toLegacyWorkloadsResponse(kind, payload));
}

function normalizeLegacyKind(kind: string): string {
  const map: Record<string, string> = {
    pod: "Pod",
    pods: "Pod",
    deployment: "Deployment",
    deployments: "Deployment",
    statefulset: "StatefulSet",
    statefulsets: "StatefulSet",
    daemonset: "DaemonSet",
    daemonsets: "DaemonSet",
    replicaset: "ReplicaSet",
    replicasets: "ReplicaSet",
    job: "Job",
    jobs: "Job",
    cronjob: "CronJob",
    cronjobs: "CronJob",
  };
  const key = kind.trim().toLowerCase();
  return map[key] ?? kind;
}

function toLegacyWorkloadsResponse(kind: string, payload: unknown): WorkloadsListResponse {
  const fallback: WorkloadsListResponse = {
    kind,
    items: [],
    total: 0,
    timestamp: new Date().toISOString(),
  };
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const raw = payload as {
    kind?: string;
    items?: Array<Record<string, unknown>>;
    total?: number;
    timestamp?: string;
  };
  if (!Array.isArray(raw.items)) {
    return fallback;
  }

  return {
    kind: raw.kind ?? kind,
    total: typeof raw.total === "number" ? raw.total : raw.items.length,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    items: raw.items.map(mapRecordToWorkloadItem),
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  const record = parseJsonRecord(value);
  if (!record) {
    return undefined;
  }
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  if (!entries.length) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readReplicaNumber(value: unknown, mode: "ready" | "desired"): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  if (text.includes("/")) {
    const [readyRaw, desiredRaw] = text.split("/");
    const ready = Number(readyRaw);
    const desired = Number(desiredRaw);
    const chosen = mode === "ready" ? ready : desired;
    return Number.isFinite(chosen) ? chosen : null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseObservedState(value: unknown): WorkloadObservedScaleState | null | undefined {
  if (value === null) {
    return null;
  }
  const record = parseJsonRecord(value);
  if (!record) {
    return undefined;
  }
  return record as WorkloadObservedScaleState;
}

function mapRecordToWorkloadItem(item: Record<string, unknown>): WorkloadItem {
  const replicasValue = readReplicaNumber(item.replicas, "desired") ?? readReplicaNumber(item.ready, "desired") ?? 0;
  const readyReplicasValue =
    readReplicaNumber(item.readyReplicas, "ready")
    ?? readReplicaNumber(item.ready, "ready")
    ?? replicasValue;
  const replicas = Number.isFinite(replicasValue) ? replicasValue : 0;
  const readyReplicas = Number.isFinite(readyReplicasValue) ? readyReplicasValue : 0;
  const availableReplicas =
    readReplicaNumber(item.availableReplicas, "ready")
    ?? readReplicaNumber(item.available, "ready")
    ?? readyReplicas;
  const state = item.state === "disabled" || item.state === "deleted" ? (item.state as WorkloadState) : "active";
  const spec = parseJsonRecord(item.spec);
  const statusJson = parseJsonRecord(item.statusJson);
  const observedState = parseObservedState(item.observedState);
  const labels = parseStringRecord(item.labels);
  const image = readString(item.image) ?? readString(statusJson?.image);
  const createdAt = readString(item.createdAt);
  const updatedAt = readString(item.updatedAt);
  const versionValue = typeof item.version === "number" && Number.isFinite(item.version) ? item.version : 1;
  return {
    id: typeof item.id === "string" ? item.id : undefined,
    kind: typeof item.kind === "string" ? item.kind : "Deployment",
    name: typeof item.name === "string" ? item.name : "",
    clusterId: typeof item.clusterId === "string" ? item.clusterId : "",
    namespace: typeof item.namespace === "string" ? item.namespace : "",
    status: inferWorkloadStatus(item, state, replicas, readyReplicas),
    ready: `${readyReplicas}/${replicas}`,
    replicas: `${readyReplicas}/${replicas}`,
    restarts: typeof item.restarts === "number" && Number.isFinite(item.restarts) ? item.restarts : 0,
    age: createdAt ?? updatedAt ?? "",
    state,
    version: versionValue,
    suspended: item.suspended === true,
    policyEnabled: item.policyEnabled !== false,
    image,
    spec,
    statusJson,
    observedState,
    labels,
    createdAt,
    updatedAt,
    readyReplicas,
    availableReplicas,
  };
}

function inferWorkloadStatus(
  item: Record<string, unknown>,
  state: WorkloadState,
  replicas: number,
  readyReplicas: number,
): WorkloadStatus {
  if (state === "deleted") {
    return "Failed";
  }
  const rawStatus = item.status;
  if (rawStatus === "Running" || rawStatus === "Pending" || rawStatus === "Degraded" || rawStatus === "Failed") {
    return rawStatus;
  }
  if (replicas === 0) {
    return "Pending";
  }
  if (readyReplicas >= replicas) {
    return "Running";
  }
  if (readyReplicas > 0) {
    return "Degraded";
  }
  return "Pending";
}

export function applyWorkloadAction(
  kind: WorkloadKind | string,
  name: string,
  payload: WorkloadActionPayload,
  token: string,
) {
  const normalizedKind = String(kind).trim().toLowerCase();
  if (payload.action === "scale" && (normalizedKind === "pod" || normalizedKind === "pods")) {
    throw new Error("Pod 资源不支持扩缩容，请对 Deployment/StatefulSet/ReplicaSet 等控制器执行扩缩容");
  }

  const body: {
    action: WorkloadActionType;
    clusterId?: string;
    namespace?: string;
    replicas?: number;
    payload?: WorkloadActionByIdPayload;
  } = {
    action: payload.action,
    clusterId: payload.clusterId,
    namespace: payload.namespace,
  };
  if (payload.action === "scale" && typeof payload.replicas === "number") {
    body.replicas = payload.replicas;
    body.payload = { replicas: payload.replicas };
  }
  return apiRequest<WorkloadActionResponse, typeof body>(`/api/workloads/${kind}/${name}/actions`, {
    method: "POST",
    body,
    token,
  });
}

export function updateWorkload(
  kind: WorkloadKind | string,
  name: string,
  payload: WorkloadUpdatePayload,
  token: string,
) {
  return apiRequest<WorkloadUpdateResponse, WorkloadUpdatePayload>(`/api/workloads/${kind}/${name}`, {
    method: "PATCH",
    body: payload,
    token,
  });
}

// ── 统一 kind 接口（新后端） ──────────────────────────────────────────────────

export type WorkloadKindParam =
  | 'Pod'
  | 'Deployment'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'ReplicaSet'
  | 'Job'
  | 'CronJob';

export interface WorkloadListItem {
  id: string;
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
  replicas: number;
  readyReplicas: number;
  state: WorkloadState;
  spec?: Record<string, unknown>;
  statusJson?: Record<string, unknown>;
  observedState?: WorkloadObservedScaleState | null;
  labels?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkloadListResponse {
  items: WorkloadListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WorkloadListParams {
  clusterId?: string;
  namespace?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export function getWorkloadsByKind(
  kind: WorkloadKindParam,
  params: WorkloadListParams = {},
  token?: string,
) {
  const query: Record<string, string | number> = { kind };
  if (params.clusterId) query.clusterId = params.clusterId;
  if (params.namespace) query.namespace = params.namespace;
  if (params.keyword) query.keyword = params.keyword;
  if (params.page) query.page = params.page;
  if (params.pageSize) query.pageSize = params.pageSize;
  if (params.sortBy) query.sortBy = params.sortBy;
  if (params.sortOrder) query.sortOrder = params.sortOrder;
  return apiRequest<WorkloadListResponse>('/api/workloads', { query, token });
}


export interface WorkloadWorkspacePayload {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  name?: string;
  replicas?: number;
  containerName?: string;
  image?: string;
  command?: string;
  args?: string;
  mountPvc?: boolean;
  pvcMount?: {
    storageSourceType?: "PVC" | "PV" | "SC";
    useExistingPvc?: boolean;
    existingPvcName?: string;
    existingPvName?: string;
    existingStorageClassName?: string;
    newPvcName?: string;
    newPvcCapacity?: string;
    newPvcStorageClass?: string;
    mountPath?: string;
  };
  createService?: boolean;
  service?: {
    name?: string;
    type?: "ClusterIP" | "NodePort" | "LoadBalancer";
    containerPort?: number;
    servicePort?: number;
  };
  createIngress?: boolean;
  networkMode?: "ingress" | "ingressroute";
  ingress?: {
    name?: string;
    host?: string;
    path?: string;
    ingressClassName?: string;
  };
  ingressRoute?: {
    name?: string;
    entryPoints?: string;
    match?: string;
    middlewares?: string;
    tlsSecretName?: string;
    serviceName?: string;
    servicePort?: number;
  };
  scheduling?: AdvancedOptionsModel["scheduling"];
  probes?: AdvancedOptionsModel["probes"];
  initContainers?: Array<{
    name?: string;
    image?: string;
    command?: string;
    args?: string;
  }>;
}

type WorkloadWorkspaceProbePayload = {
  enabled?: boolean;
  type?: "httpGet" | "tcpSocket" | "exec";
  path?: string;
  port?: number;
  scheme?: "HTTP" | "HTTPS";
  command?: string;
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
};

type WorkloadWorkspaceSchedulingPayload = {
  nodeSelector?: string;
  tolerations?: string;
  affinity?: string;
};

export interface AdvancedOptionsModel {
  scheduling?: WorkloadWorkspaceSchedulingPayload;
  probes?: {
    liveness?: WorkloadWorkspaceProbePayload;
    readiness?: WorkloadWorkspaceProbePayload;
    startup?: WorkloadWorkspaceProbePayload;
  };
}

export interface WorkloadWorkspaceValidationIssue {
  step: "basic" | "image" | "storage" | "network" | "init" | "advanced" | "submit";
  section?: "basic" | "image" | "storage" | "network" | "init" | "advanced" | "submit";
  fieldPath?: string;
  field: string;
  message: string;
  code?: string;
}

export interface WorkloadWorkspaceValidateResponse {
  valid: boolean;
  errors: WorkloadWorkspaceValidationIssue[];
  warnings: WorkloadWorkspaceValidationIssue[];
  timestamp: string;
}

export interface WorkloadWorkspaceSubmitResponse {
  workload: WorkloadListItem;
  createdResources: {
    pvc?: unknown;
    service?: unknown;
    ingress?: unknown;
  };
  summary: {
    clusterId: string;
    namespace: string;
    kind: string;
    name: string;
  };
  timestamp: string;
}

export interface WorkloadWorkspaceRenderedManifest {
  kind: string;
  apiVersion: string;
  name: string;
  namespace?: string;
  source: "workload" | "pvc" | "service" | "ingress";
  yaml: string;
}

export interface WorkloadWorkspaceRenderYamlResponse {
  summary: {
    clusterId: string;
    namespace: string;
    kind: string;
    name: string;
    image: string;
    createPvc: boolean;
    createService: boolean;
    createIngress: boolean;
  };
  manifests: WorkloadWorkspaceRenderedManifest[];
  yaml: string;
  timestamp: string;
}

function normalizeWorkspacePayload(
  body: WorkloadWorkspacePayload,
): WorkloadWorkspacePayload {
  const trim = (value: string | undefined): string | undefined => {
    const text = value?.trim();
    return text || undefined;
  };

  return {
    ...body,
    clusterId: trim(body.clusterId),
    namespace: trim(body.namespace),
    kind: trim(body.kind),
    name: trim(body.name),
    containerName: trim(body.containerName),
    image: trim(body.image),
    command: trim(body.command),
    args: trim(body.args),
    pvcMount: body.pvcMount
      ? {
          ...body.pvcMount,
          storageSourceType:
            body.pvcMount.storageSourceType === "PV" ||
            body.pvcMount.storageSourceType === "SC"
              ? body.pvcMount.storageSourceType
              : "PVC",
          existingPvcName: trim(body.pvcMount.existingPvcName),
          existingPvName: trim(body.pvcMount.existingPvName),
          existingStorageClassName: trim(body.pvcMount.existingStorageClassName),
          newPvcName: trim(body.pvcMount.newPvcName),
          newPvcCapacity: trim(body.pvcMount.newPvcCapacity),
          newPvcStorageClass: trim(body.pvcMount.newPvcStorageClass),
          mountPath: trim(body.pvcMount.mountPath),
        }
      : undefined,
    service: body.service
      ? {
          ...body.service,
          name: trim(body.service.name),
        }
      : undefined,
    ingress: body.ingress
      ? {
          ...body.ingress,
          name: trim(body.ingress.name),
          host: trim(body.ingress.host),
          path: trim(body.ingress.path),
          ingressClassName: trim(body.ingress.ingressClassName),
        }
      : undefined,
    networkMode: body.networkMode === "ingressroute" ? "ingressroute" : "ingress",
    ingressRoute: body.ingressRoute
      ? {
          ...body.ingressRoute,
          name: trim(body.ingressRoute.name),
          entryPoints: trim(body.ingressRoute.entryPoints),
          match: trim(body.ingressRoute.match),
          middlewares: trim(body.ingressRoute.middlewares),
          tlsSecretName: trim(body.ingressRoute.tlsSecretName),
          serviceName: trim(body.ingressRoute.serviceName),
        }
      : undefined,
    scheduling: body.scheduling
      ? {
          nodeSelector: trim(body.scheduling.nodeSelector),
          tolerations: trim(body.scheduling.tolerations),
          affinity: trim(body.scheduling.affinity),
        }
      : undefined,
    probes: body.probes
      ? {
          liveness: normalizeProbe(body.probes.liveness, trim),
          readiness: normalizeProbe(body.probes.readiness, trim),
          startup: normalizeProbe(body.probes.startup, trim),
        }
      : undefined,
    initContainers: (body.initContainers ?? []).map((item) => ({
      ...item,
      name: trim(item.name),
      image: trim(item.image),
      command: trim(item.command),
      args: trim(item.args),
    })),
  };
}

function normalizeProbe(
  probe: WorkloadWorkspaceProbePayload | undefined,
  trim: (value: string | undefined) => string | undefined,
): WorkloadWorkspaceProbePayload | undefined {
  if (!probe) {
    return undefined;
  }
  return {
    ...probe,
    type: probe.type === "tcpSocket" || probe.type === "exec" ? probe.type : "httpGet",
    scheme: probe.scheme === "HTTPS" ? "HTTPS" : "HTTP",
    path: trim(probe.path),
    command: trim(probe.command),
    port: typeof probe.port === "number" && Number.isFinite(probe.port) ? probe.port : undefined,
    initialDelaySeconds:
      typeof probe.initialDelaySeconds === "number" && Number.isFinite(probe.initialDelaySeconds)
        ? probe.initialDelaySeconds
        : undefined,
    periodSeconds:
      typeof probe.periodSeconds === "number" && Number.isFinite(probe.periodSeconds)
        ? probe.periodSeconds
        : undefined,
    timeoutSeconds:
      typeof probe.timeoutSeconds === "number" && Number.isFinite(probe.timeoutSeconds)
        ? probe.timeoutSeconds
        : undefined,
    successThreshold:
      typeof probe.successThreshold === "number" && Number.isFinite(probe.successThreshold)
        ? probe.successThreshold
        : undefined,
    failureThreshold:
      typeof probe.failureThreshold === "number" && Number.isFinite(probe.failureThreshold)
        ? probe.failureThreshold
        : undefined,
  };
}

export async function validateWorkloadWorkspace(body: WorkloadWorkspacePayload, token?: string) {
  const payload = await apiRequest<WorkloadWorkspaceValidateResponse, WorkloadWorkspacePayload>(
    '/api/workloads/workspace/validate',
    {
      method: 'POST',
      body: normalizeWorkspacePayload(body),
      token,
    },
  );
  return {
    ...payload,
    errors: normalizeWorkspaceIssues(payload.errors),
    warnings: normalizeWorkspaceIssues(payload.warnings),
  };
}

function normalizeWorkspaceIssues(
  issues: WorkloadWorkspaceValidationIssue[] | undefined,
): WorkloadWorkspaceValidationIssue[] {
  return (issues ?? []).map((issue) => ({
    ...issue,
    step: issue.step ?? issue.section ?? 'submit',
    fieldPath: issue.fieldPath ?? issue.field,
    field: issue.field ?? issue.fieldPath ?? 'submit',
  }));
}

export function submitWorkloadWorkspace(body: WorkloadWorkspacePayload, token?: string) {
  return apiRequest<WorkloadWorkspaceSubmitResponse, WorkloadWorkspacePayload>('/api/workloads/workspace/submit', {
    method: 'POST',
    body: normalizeWorkspacePayload(body),
    token,
  });
}

export function renderWorkloadWorkspaceYaml(body: WorkloadWorkspacePayload, token?: string) {
  return apiRequest<WorkloadWorkspaceRenderYamlResponse, WorkloadWorkspacePayload>('/api/workloads/workspace/render-yaml', {
    method: 'POST',
    body: normalizeWorkspacePayload(body),
    token,
  });
}

export interface WorkloadCreatePayload {
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
  replicas?: number;
  spec?: Record<string, unknown>;
}

export function createWorkload(body: WorkloadCreatePayload, token?: string) {
  return apiRequest<WorkloadListItem, WorkloadCreatePayload>('/api/workloads', {
    method: 'POST',
    body,
    token,
  });
}

export interface WorkloadPatchPayload {
  namespace?: string;
  name?: string;
  replicas?: number;
  spec?: Record<string, unknown>;
  state?: 'active' | 'disabled' | 'deleted';
}

export function patchWorkloadById(id: string, body: WorkloadPatchPayload, token?: string) {
  return apiRequest<WorkloadListItem, WorkloadPatchPayload>(`/api/workloads/${id}`, {
    method: 'PATCH',
    body,
    token,
  });
}

export function deleteWorkload(id: string, token?: string) {
  return apiRequest(`/api/workloads/${id}/actions`, {
    method: 'POST',
    body: { action: 'delete' },
    token,
  });
}

export function applyWorkloadActionById(
  id: string,
  action: 'enable' | 'disable' | 'scale' | 'restart' | 'rollback',
  payload?: WorkloadActionByIdPayload,
  token?: string,
) {
  return apiRequest<WorkloadActionByIdResponse, { action: string; payload?: WorkloadActionByIdPayload }>(`/api/workloads/${id}/actions`, {
    method: 'POST',
    body: { action, payload },
    token,
  });
}

export interface WorkloadActionByIdPayload {
  replicas?: number;
  spec?: Record<string, unknown>;
}

export interface WorkloadActionByIdResponse {
  id: string;
  action: 'enable' | 'disable' | 'scale' | 'restart' | 'rollback';
  accepted: boolean;
  message: string;
  record: WorkloadListItem;
  scaleResult?: WorkloadScaleResult;
  observedState?: WorkloadObservedScaleState;
  timestamp: string;
}

export function disableWorkload(
  kind: WorkloadKind | string,
  name: string,
  token: string,
  payload: WorkloadIdentityPayload & { reason?: string },
) {
  return apiRequest<WorkloadStateResponse, WorkloadIdentityPayload & { reason?: string }>(
    `/api/workloads/${kind}/${name}/disable`,
    {
    method: "POST",
    body: payload,
    token,
  },
  );
}

export function enableWorkload(
  kind: WorkloadKind | string,
  name: string,
  token: string,
  payload: WorkloadIdentityPayload & { reason?: string },
) {
  return apiRequest<WorkloadStateResponse, WorkloadIdentityPayload & { reason?: string }>(
    `/api/workloads/${kind}/${name}/enable`,
    {
    method: "POST",
    body: payload,
    token,
  },
  );
}
