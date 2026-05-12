import { apiRequest } from "./client";
import { buildListQuery } from "./query";

export type HelmAction = "install" | "upgrade" | "rollback" | "uninstall";
export type HelmActionType = HelmAction;

export interface HelmListQueryParams {
  clusterId?: string;
  namespace?: string;
  keyword?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface HelmRepositoryListQueryParams {
  clusterId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface HelmRepositoryMutationPayload {
  clusterId: string;
  name: string;
  url: string;
}

export interface HelmRepositoryPresetItem {
  name: string;
  url: string;
  description: string;
}

export interface HelmRepositoryPresetListResponse {
  items: HelmRepositoryPresetItem[];
  total: number;
  timestamp: string;
}

export interface HelmImportRepositoryPresetsPayload {
  clusterId: string;
  names?: string[];
  sync?: boolean;
}

export interface HelmRepositoryPresetImportItem {
  name: string;
  url: string;
  action: "created" | "existing";
  syncStatus: "saved" | "validated" | "syncing" | "synced" | "failed";
  message: string;
}

export interface HelmImportRepositoryPresetsResponse {
  clusterId: string;
  sync: boolean;
  imported: HelmRepositoryPresetImportItem[];
  total: number;
  timestamp: string;
}

export interface HelmChartListQueryParams {
  clusterId: string;
  repository?: string;
  keyword?: string;
  searchMode?: "repo" | "hub" | "auto";
}

export interface HelmReleaseIdentity {
  clusterId: string;
  namespace: string;
  name: string;
}

export interface HelmReleaseItem {
  id: string;
  name: string;
  releaseName: string;
  clusterId: string;
  namespace: string;
  chart: string;
  revision: string;
  status: string;
  updatedAt: string;
  appVersion?: string;
}

export interface HelmRepositoryItem {
  clusterId: string;
  name: string;
  url: string;
  authType: "none";
  syncStatus: "saved" | "validated" | "syncing" | "synced" | "failed";
  lastSyncAt?: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HelmChartVersionItem {
  version: string;
  appVersion: string;
  description: string;
}

export interface HelmChartItem {
  repository: string;
  name: string;
  fullName: string;
  source?: "repo" | "hub";
  versions: HelmChartVersionItem[];
}

export type HelmRelease = HelmReleaseItem;

export interface HelmReleaseHistoryItem {
  revision: string;
  status: string;
  chart: string;
  appVersion: string;
  updatedAt: string;
  description: string;
}

export interface HelmListResponse {
  items: HelmReleaseItem[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

export interface HelmRepositoryListResponse {
  items: HelmRepositoryItem[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

export interface HelmChartListResponse {
  searchMode?: "repo" | "hub" | "auto";
  items: HelmChartItem[];
  total: number;
  timestamp: string;
}

export interface HelmDetailResponse {
  name: string;
  namespace: string;
  status: string;
  chart: string;
  revision: string;
  appVersion: string;
  raw: unknown;
}

export interface HelmValuesResponse {
  values: string;
  raw: unknown;
}

export interface HelmManifestResponse {
  name: string;
  namespace: string;
  manifest: string;
}

export interface HelmHistoryResponse {
  items: HelmReleaseHistoryItem[];
}

export interface HelmActionPayload {
  action?: HelmAction;
  clusterId: string;
  namespace?: string;
  releaseName?: string;
  name?: string;
  chart?: string;
  repositoryName?: string;
  chartName?: string;
  version?: string;
  values?: string | Record<string, unknown>;
  revision?: number;
  keepHistory?: boolean;
}

export interface HelmActionResponse {
  action: HelmAction;
  message: string;
  requestId: string;
  stdout?: string;
  stderr?: string;
  data: unknown;
}

interface BackendHelmListItem {
  name?: string;
  namespace?: string;
  revision?: string;
  updated?: string;
  status?: string;
  chart?: string;
  appVersion?: string;
  clusterId?: string;
}

interface BackendHelmListResponse {
  items?: BackendHelmListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
  timestamp?: string;
}

function normalizeReleaseName(input: Pick<HelmActionPayload, "name" | "releaseName">): string {
  const normalized = input.releaseName?.trim() || input.name?.trim();
  if (!normalized) {
    throw new Error("releaseName 是必填参数");
  }
  return normalized;
}

function normalizeIdentity(
  identityOrCluster: HelmReleaseIdentity | string,
  namespace?: string,
  releaseName?: string,
): HelmReleaseIdentity {
  if (typeof identityOrCluster === "string") {
    const clusterId = identityOrCluster.trim();
    const normalizedNamespace = namespace?.trim();
    const normalizedName = releaseName?.trim();
    if (!clusterId || !normalizedNamespace || !normalizedName) {
      throw new Error("clusterId、namespace、releaseName 都是必填参数");
    }
    return {
      clusterId,
      namespace: normalizedNamespace,
      name: normalizedName,
    };
  }
  return identityOrCluster;
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJsonObjectString(input?: string): Record<string, unknown> | undefined {
  const normalized = input?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("values 必须是 JSON object");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "values 解析失败");
  }
}

function mapListItem(item: BackendHelmListItem, clusterId: string): HelmReleaseItem {
  const name = item.name ?? "";
  const namespace = item.namespace ?? "";
  const revision = item.revision ?? "";
  const resolvedClusterId = item.clusterId ?? clusterId;
  return {
    id: `${resolvedClusterId}/${namespace}/${name}`,
    name,
    releaseName: name,
    clusterId: resolvedClusterId,
    namespace,
    chart: item.chart ?? "",
    revision,
    status: item.status ?? "",
    updatedAt: item.updated ?? "",
    appVersion: item.appVersion ?? "",
  };
}

export async function getHelmReleases(params: HelmListQueryParams = {}, token?: string): Promise<HelmListResponse> {
  const query = buildListQuery({
    clusterId: params.clusterId,
    namespace: params.namespace,
    keyword: params.keyword,
    page: params.page,
    pageSize: params.pageSize,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const payload = await apiRequest<BackendHelmListResponse>("/api/helm/releases", {
    method: "GET",
    query,
    token,
  });
  const items = Array.isArray(payload.items)
    ? payload.items.map((item) => mapListItem(item, params.clusterId ?? item.clusterId ?? ""))
    : [];
  return {
    items,
    total: typeof payload.total === "number" ? payload.total : items.length,
    page: typeof payload.page === "number" ? payload.page : params.page ?? 1,
    pageSize: typeof payload.pageSize === "number" ? payload.pageSize : params.pageSize ?? 10,
    timestamp: typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString(),
  };
}

export async function getHelmRepositories(
  params: HelmRepositoryListQueryParams,
  token?: string,
): Promise<HelmRepositoryListResponse> {
  const payload = await apiRequest<HelmRepositoryListResponse>("/api/helm/repositories", {
    method: "GET",
    query: buildListQuery({
      clusterId: params.clusterId,
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    }),
    token,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    total: typeof payload.total === "number" ? payload.total : 0,
    page: typeof payload.page === "number" ? payload.page : params.page ?? 1,
    pageSize: typeof payload.pageSize === "number" ? payload.pageSize : params.pageSize ?? 20,
    timestamp: typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString(),
  };
}

export async function getHelmRepositoryPresets(
  token?: string,
): Promise<HelmRepositoryPresetListResponse> {
  const payload = await apiRequest<HelmRepositoryPresetListResponse>("/api/helm/repository-presets", {
    method: "GET",
    token,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    total: typeof payload.total === "number" ? payload.total : 0,
    timestamp: typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString(),
  };
}

export async function importHelmRepositoryPresets(
  payload: HelmImportRepositoryPresetsPayload,
  token?: string,
): Promise<HelmImportRepositoryPresetsResponse> {
  return apiRequest<HelmImportRepositoryPresetsResponse, HelmImportRepositoryPresetsPayload>(
    "/api/helm/repositories/import-presets",
    {
      method: "POST",
      body: payload,
      token,
    },
  );
}

export async function createHelmRepository(
  payload: HelmRepositoryMutationPayload,
  token?: string,
): Promise<unknown> {
  return apiRequest<unknown, HelmRepositoryMutationPayload>("/api/helm/repositories", {
    method: "POST",
    body: payload,
    token,
  });
}

export async function updateHelmRepository(
  name: string,
  payload: Omit<HelmRepositoryMutationPayload, "name">,
  token?: string,
): Promise<unknown> {
  return apiRequest<unknown, Omit<HelmRepositoryMutationPayload, "name">>(
    `/api/helm/repositories/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      body: payload,
      token,
    },
  );
}

export async function deleteHelmRepository(
  name: string,
  clusterId: string,
  token?: string,
): Promise<unknown> {
  return apiRequest<unknown>(`/api/helm/repositories/${encodeURIComponent(name)}`, {
    method: "DELETE",
    query: { clusterId },
    token,
  });
}

export async function syncHelmRepository(
  name: string,
  clusterId: string,
  token?: string,
): Promise<unknown> {
  return apiRequest<unknown>(`/api/helm/repositories/${encodeURIComponent(name)}/sync`, {
    method: "POST",
    query: { clusterId },
    token,
  });
}

export async function getHelmCharts(
  params: HelmChartListQueryParams,
  token?: string,
): Promise<HelmChartListResponse> {
  const payload = await apiRequest<HelmChartListResponse>("/api/helm/charts", {
    method: "GET",
    query: {
      clusterId: params.clusterId,
      repository: params.repository,
      keyword: params.keyword,
      searchMode: params.searchMode,
    },
    token,
  });
  return {
    searchMode:
      payload.searchMode === "repo" || payload.searchMode === "hub" || payload.searchMode === "auto"
        ? payload.searchMode
        : params.searchMode ?? "auto",
    items: Array.isArray(payload.items) ? payload.items : [],
    total: typeof payload.total === "number" ? payload.total : 0,
    timestamp: typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString(),
  };
}

export async function getHelmReleaseDetail(identity: HelmReleaseIdentity, token?: string): Promise<HelmDetailResponse>;
export async function getHelmReleaseDetail(clusterId: string, namespace: string, releaseName: string, token?: string): Promise<HelmDetailResponse>;
export async function getHelmReleaseDetail(
  identityOrCluster: HelmReleaseIdentity | string,
  namespaceOrToken?: string,
  releaseNameOrToken?: string,
  tokenArg?: string,
): Promise<HelmDetailResponse> {
  const identity = normalizeIdentity(
    identityOrCluster,
    typeof identityOrCluster === "string" ? namespaceOrToken : undefined,
    typeof identityOrCluster === "string" ? releaseNameOrToken : undefined,
  );
  const token = typeof identityOrCluster === "string" ? tokenArg : namespaceOrToken;
  const payload = await apiRequest<Record<string, unknown>>(`/api/helm/releases/${encodeURIComponent(identity.name)}`, {
    method: "GET",
    query: {
      clusterId: identity.clusterId,
      namespace: identity.namespace,
    },
    token,
  });

  const info = (payload.info && typeof payload.info === "object" ? payload.info : {}) as Record<string, unknown>;
  const chart = (payload.chart && typeof payload.chart === "object" ? payload.chart : {}) as Record<string, unknown>;
  const version = (chart.metadata && typeof chart.metadata === "object" ? chart.metadata : {}) as Record<string, unknown>;

  return {
    name: pickString(payload.name) || identity.name,
    namespace: identity.namespace,
    status: pickString(info.status),
    chart: pickString(version.name) || pickString(payload.chart),
    revision: String((payload.version as number | undefined) ?? ""),
    appVersion: pickString(version.appVersion),
    raw: payload,
  };
}

export async function getHelmReleaseValues(identity: HelmReleaseIdentity, token?: string): Promise<HelmValuesResponse>;
export async function getHelmReleaseValues(clusterId: string, namespace: string, releaseName: string, token?: string): Promise<HelmValuesResponse>;
export async function getHelmReleaseValues(
  identityOrCluster: HelmReleaseIdentity | string,
  namespaceOrToken?: string,
  releaseNameOrToken?: string,
  tokenArg?: string,
): Promise<HelmValuesResponse> {
  const identity = normalizeIdentity(
    identityOrCluster,
    typeof identityOrCluster === "string" ? namespaceOrToken : undefined,
    typeof identityOrCluster === "string" ? releaseNameOrToken : undefined,
  );
  const token = typeof identityOrCluster === "string" ? tokenArg : namespaceOrToken;
  const payload = await apiRequest<unknown>(`/api/helm/releases/${encodeURIComponent(identity.name)}/values`, {
    method: "GET",
    query: {
      clusterId: identity.clusterId,
      namespace: identity.namespace,
    },
    token,
  });

  return {
    values: typeof payload === "string" ? payload : JSON.stringify(payload ?? {}, null, 2),
    raw: payload,
  };
}

export async function getHelmReleaseManifest(identity: HelmReleaseIdentity, token?: string): Promise<HelmManifestResponse>;
export async function getHelmReleaseManifest(clusterId: string, namespace: string, releaseName: string, token?: string): Promise<HelmManifestResponse>;
export async function getHelmReleaseManifest(
  identityOrCluster: HelmReleaseIdentity | string,
  namespaceOrToken?: string,
  releaseNameOrToken?: string,
  tokenArg?: string,
): Promise<HelmManifestResponse> {
  const identity = normalizeIdentity(
    identityOrCluster,
    typeof identityOrCluster === "string" ? namespaceOrToken : undefined,
    typeof identityOrCluster === "string" ? releaseNameOrToken : undefined,
  );
  const token = typeof identityOrCluster === "string" ? tokenArg : namespaceOrToken;
  const payload = await apiRequest<HelmManifestResponse>(`/api/helm/releases/${encodeURIComponent(identity.name)}/manifest`, {
    method: "GET",
    query: {
      clusterId: identity.clusterId,
      namespace: identity.namespace,
    },
    token,
  });
  return {
    name: payload.name ?? identity.name,
    namespace: payload.namespace ?? identity.namespace,
    manifest: payload.manifest ?? "",
  };
}

export async function getHelmReleaseHistory(identity: HelmReleaseIdentity, token?: string): Promise<HelmHistoryResponse>;
export async function getHelmReleaseHistory(clusterId: string, namespace: string, releaseName: string, token?: string): Promise<HelmHistoryResponse>;
export async function getHelmReleaseHistory(
  identityOrCluster: HelmReleaseIdentity | string,
  namespaceOrToken?: string,
  releaseNameOrToken?: string,
  tokenArg?: string,
): Promise<HelmHistoryResponse> {
  const identity = normalizeIdentity(
    identityOrCluster,
    typeof identityOrCluster === "string" ? namespaceOrToken : undefined,
    typeof identityOrCluster === "string" ? releaseNameOrToken : undefined,
  );
  const token = typeof identityOrCluster === "string" ? tokenArg : namespaceOrToken;
  const payload = await apiRequest<unknown>(`/api/helm/releases/${encodeURIComponent(identity.name)}/history`, {
    method: "GET",
    query: {
      clusterId: identity.clusterId,
      namespace: identity.namespace,
    },
    token,
  });

  const list = Array.isArray(payload) ? payload : [];
  return {
    items: list.map((item) => {
      const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        revision: String(row.revision ?? ""),
        status: pickString(row.status),
        chart: pickString(row.chart),
        appVersion: pickString(row.app_version),
        updatedAt: pickString(row.updated),
        description: pickString(row.description),
      };
    }),
  };
}

export async function executeHelmAction(action: HelmAction, payload: HelmActionPayload, token?: string): Promise<HelmActionResponse>;
export async function executeHelmAction(payload: HelmActionPayload, token?: string): Promise<HelmActionResponse>;
export async function executeHelmAction(
  actionOrPayload: HelmAction | HelmActionPayload,
  payloadOrToken?: HelmActionPayload | string,
  tokenArg?: string,
): Promise<HelmActionResponse> {
  const action =
    typeof actionOrPayload === "string"
      ? actionOrPayload
      : actionOrPayload.action;
  const payload =
    typeof actionOrPayload === "string"
      ? (payloadOrToken as HelmActionPayload | undefined)
      : actionOrPayload;
  const token = typeof actionOrPayload === "string" ? tokenArg : (payloadOrToken as string | undefined);

  if (!action || !payload) {
    throw new Error("Helm action 与 payload 都是必填参数");
  }

  const releaseName = normalizeReleaseName(payload);
  const namespace = payload.namespace?.trim();
  const valuesObject =
    typeof payload.values === "string"
      ? parseJsonObjectString(payload.values)
      : payload.values;

  if (action === "install") {
    const body = {
      clusterId: payload.clusterId,
      namespace,
      name: releaseName,
      chart: payload.chart,
      repositoryName: payload.repositoryName,
      chartName: payload.chartName,
      version: payload.version,
      ...(valuesObject ? { values: valuesObject } : {}),
    };
    const resp = await apiRequest<Record<string, unknown>, typeof body>("/api/helm/releases/install", {
      method: "POST",
      body,
      token,
    });
    return {
      action,
      message: "install 已提交",
      requestId: String(resp.timestamp ?? Date.now()),
      stdout: JSON.stringify(resp.output ?? {}, null, 2),
      data: resp,
    };
  }

  if (action === "upgrade") {
    const body = {
      confirm: true,
      clusterId: payload.clusterId,
      namespace,
      chart: payload.chart,
      repositoryName: payload.repositoryName,
      chartName: payload.chartName,
      version: payload.version,
      ...(valuesObject ? { values: valuesObject } : {}),
    };
    const resp = await apiRequest<Record<string, unknown>, typeof body>(`/api/helm/releases/${encodeURIComponent(releaseName)}/upgrade`, {
      method: "POST",
      body,
      token,
    });
    return {
      action,
      message: "upgrade 已提交",
      requestId: String(resp.timestamp ?? Date.now()),
      stdout: JSON.stringify(resp.output ?? {}, null, 2),
      data: resp,
    };
  }

  if (action === "rollback") {
    const body = {
      confirm: true,
      clusterId: payload.clusterId,
      namespace,
      revision: payload.revision,
    };
    const resp = await apiRequest<Record<string, unknown>, typeof body>(`/api/helm/releases/${encodeURIComponent(releaseName)}/rollback`, {
      method: "POST",
      body,
      token,
    });
    return {
      action,
      message: "rollback 已提交",
      requestId: String(resp.timestamp ?? Date.now()),
      stdout: JSON.stringify(resp.output ?? {}, null, 2),
      data: resp,
    };
  }

  const body = {
    confirm: true,
    clusterId: payload.clusterId,
    namespace,
    keepHistory: payload.keepHistory ?? false,
  };
  const resp = await apiRequest<Record<string, unknown>, typeof body>(`/api/helm/releases/${encodeURIComponent(releaseName)}`, {
    method: "DELETE",
    query: {
      clusterId: payload.clusterId,
      namespace,
    },
    body,
    token,
  });
  return {
    action,
    message: "uninstall 已提交",
    requestId: String(resp.timestamp ?? Date.now()),
    stdout: typeof resp.output === "string" ? resp.output : JSON.stringify(resp.output ?? {}, null, 2),
    data: resp,
  };
}
