export interface HelmListQuery {
  clusterId?: string;
  namespace?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
}

export interface HelmRepositoryQuery {
  clusterId?: string;
}

export interface HelmRepositoryCreateRequest {
  clusterId?: string;
  name?: string;
  url?: string;
}

export interface HelmRepositoryImportPresetsRequest {
  clusterId?: string;
  names?: string[];
  sync?: boolean;
}

export interface HelmRepositoryUpdateRequest {
  clusterId?: string;
  url?: string;
}

export interface HelmChartQuery {
  clusterId?: string;
  repository?: string;
  keyword?: string;
  searchMode?: string;
}

export interface HelmReleaseQuery {
  clusterId?: string;
  namespace?: string;
}

export interface HelmInstallRequest {
  clusterId?: string;
  namespace?: string;
  name?: string;
  chart?: string;
  repositoryName?: string;
  chartName?: string;
  version?: string;
  repo?: string;
  createNamespace?: boolean;
  values?: Record<string, unknown>;
  set?: Record<string, string | number | boolean>;
  wait?: boolean;
  timeoutSeconds?: number;
  atomic?: boolean;
  dryRun?: boolean;
}

export interface HelmUpgradeRequest {
  clusterId?: string;
  namespace?: string;
  chart?: string;
  repositoryName?: string;
  chartName?: string;
  version?: string;
  values?: Record<string, unknown>;
  set?: Record<string, string | number | boolean>;
  install?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
  atomic?: boolean;
  dryRun?: boolean;
  confirm?: boolean;
}

export interface HelmRollbackRequest {
  clusterId?: string;
  namespace?: string;
  revision?: number;
  wait?: boolean;
  timeoutSeconds?: number;
  cleanupOnFail?: boolean;
  dryRun?: boolean;
  confirm?: boolean;
}

export interface HelmUninstallRequest {
  clusterId?: string;
  namespace?: string;
  keepHistory?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
  confirm?: boolean;
}
