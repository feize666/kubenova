import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ClustersService } from '../clusters/clusters.service';
import type {
  HelmChartQuery,
  HelmInstallRequest,
  HelmListQuery,
  HelmReleaseQuery,
  HelmRepositoryCreateRequest,
  HelmRepositoryImportHostRequest,
  HelmRepositoryImportPresetsRequest,
  HelmRepositoryQuery,
  HelmRepositoryUpdateRequest,
  HelmRollbackRequest,
  HelmUninstallRequest,
  HelmUpgradeRequest,
} from './dto/helm.dto';
import {
  type HelmRepositoryAuthType,
  type HelmRepositoryKind,
  type HelmRepositoryRecord,
  type HelmRepositorySource,
  HelmRepositoryStore,
} from './helm-repository.store';

const execFileAsync = promisify(execFile);
const HELM_ALL_RELEASES_CLUSTER_TIMEOUT_MS = 7000;
const HELM_COMMAND_TIMEOUT_MS = 15000;

interface HelmReleaseItem {
  name: string;
  namespace: string;
  clusterId?: string;
  revision?: string;
  updated?: string;
  status?: string;
  chart?: string;
  appVersion?: string;
}

interface HelmListPayload {
  items: HelmReleaseItem[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

interface HelmMutationPayload {
  name: string;
  namespace: string;
  clusterId: string;
  command: string;
  output: unknown;
  timestamp: string;
}

interface HelmRepositoryItem {
  clusterId: string;
  name: string;
  url: string;
  repositoryKind: HelmRepositoryKind;
  authType: HelmRepositoryAuthType;
  source?: HelmRepositorySource;
  username?: string;
  caFile?: string;
  hasCaData?: boolean;
  insecureSkipTlsVerify?: boolean;
  syncStatus: 'saved' | 'validated' | 'syncing' | 'synced' | 'failed';
  chartCount?: number;
  lastSyncAt?: string;
  message?: string;
  diagnostics?: HelmRepositoryItemDiagnostics;
  createdAt: string;
  updatedAt: string;
}

interface HelmRepositoryItemDiagnostics {
  code?: string;
  reason?: string;
  suggestion?: string;
  checkedAt?: string;
}

interface HelmRepositoryListPayload {
  items: HelmRepositoryItem[];
  total: number;
  page: number;
  pageSize: number;
  diagnostics?: HelmRepositoryInventoryDiagnostic[];
  timestamp: string;
}

interface HelmCliRepositoryItem {
  name: string;
  url: string;
  repositoryKind: HelmRepositoryKind;
}

interface HelmRepositoryInventoryDiagnostic {
  source: 'repositories.yaml' | 'helm repo list';
  status: 'success' | 'failed' | 'skipped';
  message: string;
  path?: string;
  command?: string;
  code?: string;
}

interface HelmHostRepositoryInventory {
  items: HelmCliRepositoryItem[];
  diagnostics: HelmRepositoryInventoryDiagnostic[];
}

interface HelmRepositoryInventoryMerge {
  records: HelmRepositoryRecord[];
  diagnostics: HelmRepositoryInventoryDiagnostic[];
}

interface HelmRepositoryMutationPayload {
  item?: HelmRepositoryItem;
  name?: string;
  clusterId: string;
  message: string;
  timestamp: string;
}

interface HelmRepositoryPresetItem {
  name: string;
  url: string;
  description: string;
}

interface HelmRepositoryPresetListPayload {
  items: HelmRepositoryPresetItem[];
  total: number;
  timestamp: string;
}

interface HelmRepositoryPresetImportItem {
  name: string;
  url: string;
  action: 'created' | 'existing';
  syncStatus: 'saved' | 'validated' | 'syncing' | 'synced' | 'failed';
  message: string;
}

interface HelmRepositoryPresetImportPayload {
  clusterId: string;
  sync: boolean;
  imported: HelmRepositoryPresetImportItem[];
  total: number;
  timestamp: string;
}

interface HelmRepositoryHostImportItem {
  name: string;
  url: string;
  action: 'created' | 'updated' | 'existing' | 'failed';
  source: HelmRepositorySource;
  repositoryKind: HelmRepositoryKind;
  syncStatus: HelmRepositoryItem['syncStatus'];
  message?: string;
  diagnostics?: HelmRepositoryItemDiagnostics;
}

interface HelmRepositoryHostImportPayload {
  clusterId: string;
  sync: boolean;
  imported: HelmRepositoryHostImportItem[];
  total: number;
  timestamp: string;
  diagnostics: HelmRepositoryInventoryDiagnostic[];
}

interface HelmChartVersionItem {
  version: string;
  appVersion: string;
  description: string;
}

interface HelmChartItem {
  repository: string;
  name: string;
  fullName: string;
  source: 'repo' | 'hub';
  versions: HelmChartVersionItem[];
}

interface HelmChartListPayload {
  searchMode: 'repo' | 'hub' | 'auto';
  items: HelmChartItem[];
  total: number;
  timestamp: string;
}

interface HelmExecContext {
  clusterId: string;
  kubeconfigPath: string;
  workspaceDir: string;
  helmEnv: NodeJS.ProcessEnv;
  defaultNamespace: string;
}

interface HelmMutationFlagOptions {
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

interface SyncOptions {
  only?: HelmRepositoryRecord[];
  strict?: boolean;
}

type HelmClusterItem = {
  id: string;
  hasKubeconfig: boolean;
};

const HELM_REPOSITORY_PRESETS: HelmRepositoryPresetItem[] = [
  {
    name: 'bitnami',
    url: 'https://charts.bitnami.com/bitnami',
    description: '通用中间件与基础服务',
  },
  {
    name: 'prometheus-community',
    url: 'https://prometheus-community.github.io/helm-charts',
    description: 'Prometheus / Alertmanager / kube-prometheus-stack',
  },
  {
    name: 'grafana',
    url: 'https://grafana.github.io/helm-charts',
    description: 'Grafana / Loki / Tempo / Mimir',
  },
  {
    name: 'ingress-nginx',
    url: 'https://kubernetes.github.io/ingress-nginx',
    description: 'Kubernetes Ingress NGINX Controller',
  },
];

@Injectable()
export class HelmService {
  constructor(
    private readonly clustersService: ClustersService,
    private readonly repositoryStore: HelmRepositoryStore,
  ) {}

  listRepositoryPresets(): HelmRepositoryPresetListPayload {
    return {
      items: HELM_REPOSITORY_PRESETS.map((item) => ({ ...item })),
      total: HELM_REPOSITORY_PRESETS.length,
      timestamp: new Date().toISOString(),
    };
  }

  async importRepositoryPresets(
    body: HelmRepositoryImportPresetsRequest,
  ): Promise<HelmRepositoryPresetImportPayload> {
    const clusterId = this.requireNonEmpty(body.clusterId, 'clusterId');
    await this.ensureClusterExists(clusterId);
    const sync = body.sync !== false;
    const presets = this.resolvePresetSelection(body.names);

    const now = new Date().toISOString();
    const imported: HelmRepositoryPresetImportItem[] = [];
    const recordsToSync: HelmRepositoryRecord[] = [];

    for (const preset of presets) {
      const existing = await this.repositoryStore.findByName(
        clusterId,
        preset.name,
      );
      if (existing) {
        imported.push({
          name: preset.name,
          url: existing.url,
          action: 'existing',
          syncStatus: this.normalizeSyncStatus(existing.syncStatus),
          message: existing.message ?? '仓库已存在',
        });
        if (sync) {
          recordsToSync.push(existing);
        }
        continue;
      }

      const record: HelmRepositoryRecord = {
        clusterId,
        name: preset.name,
        url: preset.url,
        source: 'preset',
        authType: 'none',
        syncStatus: sync ? 'syncing' : 'saved',
        message: sync ? '准备同步模板仓库' : '模板仓库已保存（待同步）',
        createdAt: now,
        updatedAt: now,
      };
      await this.repositoryStore.save(record);
      imported.push({
        name: preset.name,
        url: preset.url,
        action: 'created',
        syncStatus: this.normalizeSyncStatus(record.syncStatus),
        message: record.message ?? '',
      });
      if (sync) {
        recordsToSync.push(record);
      }
    }

    if (sync && recordsToSync.length > 0) {
      await this.withKubeconfig(clusterId, async (ctx) => {
        await this.syncRepositoriesForContext(ctx, {
          only: recordsToSync,
          strict: false,
        });
      });
      for (const item of imported) {
        const latest = await this.repositoryStore.findByName(
          clusterId,
          item.name,
        );
        if (!latest) {
          continue;
        }
        item.syncStatus = this.normalizeSyncStatus(latest.syncStatus);
        item.message = latest.message ?? item.message;
        item.url = latest.url;
      }
    }

    return {
      clusterId,
      sync,
      imported,
      total: imported.length,
      timestamp: new Date().toISOString(),
    };
  }

  async importHostRepositories(
    body: HelmRepositoryImportHostRequest,
  ): Promise<HelmRepositoryHostImportPayload> {
    const clusterId = this.requireNonEmpty(body.clusterId, 'clusterId');
    await this.ensureClusterExists(clusterId);
    const sync = body.sync !== false;
    const overwrite = body.overwrite === true;
    const hostInventory = await this.readHostRepositoryInventory();
    const now = new Date().toISOString();
    const imported: HelmRepositoryHostImportItem[] = [];
    const recordsToSync: HelmRepositoryRecord[] = [];

    for (const item of hostInventory.items) {
      const existing = await this.repositoryStore.findByName(
        clusterId,
        item.name,
      );
      const record: HelmRepositoryRecord = {
        ...(existing ?? {
          clusterId,
          name: item.name,
          createdAt: now,
        }),
        clusterId,
        name: item.name,
        url: overwrite || !existing ? item.url : existing.url,
        repositoryKind:
          overwrite || !existing
            ? item.repositoryKind
            : existing.repositoryKind,
        source: 'host-cli',
        authType: existing?.authType ?? 'none',
        username: existing?.username,
        password: existing?.password,
        caFile: existing?.caFile,
        caData: existing?.caData,
        insecureSkipTlsVerify: existing?.insecureSkipTlsVerify,
        syncStatus: sync ? 'syncing' : (existing?.syncStatus ?? 'saved'),
        message: sync
          ? '准备同步宿主 Helm 仓库'
          : (existing?.message ?? '来源于宿主 Helm 仓库配置'),
        lastSyncAt: existing?.lastSyncAt,
        updatedAt: now,
      };
      await this.repositoryStore.save(record);
      imported.push({
        name: record.name,
        url: record.url,
        action: existing ? (overwrite ? 'updated' : 'existing') : 'created',
        source: 'host-cli',
        repositoryKind: this.resolveRepositoryKind(record),
        syncStatus: this.normalizeSyncStatus(record.syncStatus),
        message: record.message,
      });
      if (sync) {
        recordsToSync.push(record);
      }
    }

    if (sync && recordsToSync.length > 0) {
      await this.withKubeconfig(clusterId, async (ctx) => {
        await this.syncRepositoriesForContext(ctx, {
          only: recordsToSync,
          strict: false,
        });
      });
      for (const item of imported) {
        const latest = await this.repositoryStore.findByName(
          clusterId,
          item.name,
        );
        if (!latest) {
          continue;
        }
        item.syncStatus = this.normalizeSyncStatus(latest.syncStatus);
        item.message = latest.message ?? item.message;
      }
    }

    return {
      clusterId,
      sync,
      imported,
      total: imported.length,
      timestamp: new Date().toISOString(),
      diagnostics: hostInventory.diagnostics,
    };
  }

  async listRepositories(
    query: HelmRepositoryQuery,
  ): Promise<HelmRepositoryListPayload> {
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 20);
    const clusterId = this.normalizeOptional(query.clusterId);

    const inventory = clusterId
      ? await this.mergeRepositoryInventory(clusterId)
      : await this.listAllRepositoryInventory();
    const sorted = this.sortRepositoryRecords(
      inventory.records,
      query.sortBy,
      query.sortOrder,
    );

    const total = sorted.length;
    const start = (page - 1) * pageSize;
    return {
      items: sorted
        .slice(start, start + pageSize)
        .map((item) => this.toRepositoryItem(item)),
      total,
      page,
      pageSize,
      diagnostics: inventory.diagnostics,
      timestamp: new Date().toISOString(),
    };
  }

  async createRepository(
    body: HelmRepositoryCreateRequest,
  ): Promise<HelmRepositoryMutationPayload> {
    const clusterId = this.requireNonEmpty(body.clusterId, 'clusterId');
    const name = this.requireNonEmpty(body.name, 'name');
    const url = this.normalizeRepositoryUrl(body.url, body.repositoryKind);
    await this.ensureClusterExists(clusterId);

    const existing = await this.repositoryStore.findByName(clusterId, name);
    if (existing) {
      throw new BadRequestException({
        code: 'HELM_REPOSITORY_DUPLICATE',
        message: `仓库 ${name} 已存在`,
      });
    }

    const now = new Date().toISOString();
    const repositoryOptions = this.normalizeRepositoryOptions(body, url);
    const record: HelmRepositoryRecord = {
      clusterId,
      name,
      url,
      ...repositoryOptions,
      source: 'manual',
      syncStatus: 'syncing',
      message: '正在验证仓库连通性',
      createdAt: now,
      updatedAt: now,
    };
    await this.repositoryStore.save(record);

    try {
      await this.withKubeconfig(clusterId, async (ctx) => {
        await this.syncRepositoriesForContext(ctx, {
          only: [record],
          strict: false,
        });
      });
    } catch (error) {
      throw this.toRepositorySyncException(error, name);
    }

    const latest = await this.repositoryStore.findByName(clusterId, name);
    const latestStatus = latest
      ? this.normalizeSyncStatus(latest.syncStatus)
      : 'saved';
    return {
      item: latest ? this.toRepositoryItem(latest) : undefined,
      clusterId,
      message:
        latestStatus === 'failed'
          ? '仓库已保存，但同步失败'
          : '仓库已创建并同步成功',
      timestamp: new Date().toISOString(),
    };
  }

  async updateRepository(
    name: string,
    body: HelmRepositoryUpdateRequest,
  ): Promise<HelmRepositoryMutationPayload> {
    const clusterId = this.requireNonEmpty(body.clusterId, 'clusterId');
    const repositoryName = this.requireNonEmpty(name, 'repository name');
    await this.ensureClusterExists(clusterId);

    const existing = await this.repositoryStore.findByName(
      clusterId,
      repositoryName,
    );
    if (!existing) {
      throw new NotFoundException(`仓库 ${repositoryName} 不存在`);
    }

    const nextUrl = body.url
      ? this.normalizeRepositoryUrl(body.url, body.repositoryKind)
      : existing.url;
    const repositoryOptions = this.normalizeRepositoryOptions(
      body,
      nextUrl,
      existing,
    );
    const next: HelmRepositoryRecord = {
      ...existing,
      url: nextUrl,
      ...repositoryOptions,
      source: existing.source ?? 'manual',
      syncStatus: 'syncing',
      message: '正在验证仓库连通性',
      updatedAt: new Date().toISOString(),
    };
    await this.repositoryStore.save(next);

    try {
      await this.withKubeconfig(clusterId, async (ctx) => {
        await this.syncRepositoriesForContext(ctx, {
          only: [next],
          strict: false,
        });
      });
    } catch (error) {
      throw this.toRepositorySyncException(error, repositoryName);
    }

    const latest = await this.repositoryStore.findByName(
      clusterId,
      repositoryName,
    );
    const latestStatus = latest
      ? this.normalizeSyncStatus(latest.syncStatus)
      : 'saved';
    return {
      item: latest ? this.toRepositoryItem(latest) : undefined,
      clusterId,
      message:
        latestStatus === 'failed'
          ? '仓库已更新，但同步失败'
          : '仓库已更新并同步成功',
      timestamp: new Date().toISOString(),
    };
  }

  async deleteRepository(
    name: string,
    query: HelmRepositoryQuery,
  ): Promise<HelmRepositoryMutationPayload> {
    const clusterId = this.requireNonEmpty(query.clusterId, 'clusterId');
    const repositoryName = this.requireNonEmpty(name, 'repository name');
    await this.ensureClusterExists(clusterId);
    const removed = await this.repositoryStore.delete(
      clusterId,
      repositoryName,
    );
    if (!removed) {
      throw new NotFoundException(`仓库 ${repositoryName} 不存在`);
    }
    return {
      name: repositoryName,
      clusterId,
      message: '仓库已删除',
      timestamp: new Date().toISOString(),
    };
  }

  async syncRepository(
    name: string,
    query: HelmRepositoryQuery,
  ): Promise<HelmRepositoryMutationPayload> {
    const clusterId = this.requireNonEmpty(query.clusterId, 'clusterId');
    const repositoryName = this.requireNonEmpty(name, 'repository name');
    await this.ensureClusterExists(clusterId);

    const record = await this.repositoryStore.findByName(
      clusterId,
      repositoryName,
    );
    if (!record) {
      throw new NotFoundException(`仓库 ${repositoryName} 不存在`);
    }

    try {
      await this.withKubeconfig(clusterId, async (ctx) => {
        await this.syncRepositoriesForContext(ctx, {
          only: [record],
          strict: true,
        });
      });
    } catch (error) {
      throw this.toRepositorySyncException(error, repositoryName);
    }

    const latest = await this.repositoryStore.findByName(
      clusterId,
      repositoryName,
    );
    return {
      item: latest ? this.toRepositoryItem(latest) : undefined,
      clusterId,
      message: '仓库同步成功',
      timestamp: new Date().toISOString(),
    };
  }

  async listCharts(query: HelmChartQuery): Promise<HelmChartListPayload> {
    const clusterId = this.requireNonEmpty(query.clusterId, 'clusterId');
    const repository = this.normalizeOptional(query.repository);
    const keyword = this.normalizeOptional(query.keyword)?.toLowerCase();
    const searchMode = this.normalizeChartSearchMode(query.searchMode);

    const items = await this.withKubeconfig(clusterId, async (ctx) => {
      const grouped = new Map<string, HelmChartItem>();

      if (searchMode !== 'hub') {
        const syncTargets = await this.resolveSyncTargets(
          clusterId,
          repository,
        );
        await this.syncRepositoriesForContext(ctx, {
          only: syncTargets,
          strict: Boolean(repository),
        });
        await this.appendRepoCharts(grouped, ctx, repository, keyword);
      }

      if (
        keyword &&
        (searchMode === 'hub' || (searchMode === 'auto' && grouped.size === 0))
      ) {
        await this.appendHubCharts(grouped, ctx, keyword);
      }

      return Array.from(grouped.values());
    });

    return {
      searchMode,
      items,
      total: items.length,
      timestamp: new Date().toISOString(),
    };
  }

  private async appendRepoCharts(
    grouped: Map<string, HelmChartItem>,
    ctx: HelmExecContext,
    repository: string | undefined,
    keyword: string | undefined,
  ): Promise<void> {
    let repoRows: unknown[] = [];
    try {
      const args = ['search', 'repo'];
      if (repository) {
        args.push(repository);
      }
      args.push('--versions', '--output', 'json');
      const output = await this.runHelm(args, ctx);
      const parsed = this.tryParseJson(output.stdout.trim());
      repoRows = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (repository || !this.isNoRepositoryConfiguredError(error)) {
        throw error;
      }
    }

    for (const rawRow of repoRows) {
      const row = this.isRecord(rawRow) ? rawRow : {};
      const fullName = this.asString(row.name);
      if (!fullName) {
        continue;
      }
      const description = this.asString(row.description);
      if (
        keyword &&
        !fullName.toLowerCase().includes(keyword) &&
        !description.toLowerCase().includes(keyword)
      ) {
        continue;
      }
      const segments = fullName.split('/');
      const repositoryName = segments[0] ?? '';
      const chartName = segments.slice(1).join('/') || fullName;
      const existing = grouped.get(fullName);
      const versionItem: HelmChartVersionItem = {
        version: this.asString(row.version),
        appVersion: this.asString(row.app_version),
        description,
      };
      if (!existing) {
        grouped.set(fullName, {
          repository: repositoryName,
          name: chartName,
          fullName,
          source: 'repo',
          versions: [versionItem],
        });
        continue;
      }
      existing.versions.push(versionItem);
    }
  }

  private async appendHubCharts(
    grouped: Map<string, HelmChartItem>,
    ctx: HelmExecContext,
    keyword: string,
  ): Promise<void> {
    try {
      const hubOutput = await this.runHelm(
        ['search', 'hub', keyword, '--output', 'json'],
        ctx,
      );
      const hubParsed = this.tryParseJson(hubOutput.stdout.trim());
      const hubRows = Array.isArray(hubParsed) ? hubParsed : [];
      for (const rawHubRow of hubRows) {
        const row = this.isRecord(rawHubRow) ? rawHubRow : {};
        const fullName =
          this.asString(row.name) ||
          this.asString(this.toRecord(row.chart).name);
        if (!fullName) {
          continue;
        }
        const repoInfo = this.toRecord(row.repository);
        const repoName =
          this.asString(repoInfo.name) ||
          this.asString(row.repo_name) ||
          'artifact-hub';
        const chartVersion =
          this.asString(this.toRecord(row.chart).version) ||
          this.asString(row.version);
        const appVersion =
          this.asString(this.toRecord(row.chart).app_version) ||
          this.asString(row.app_version);
        const description = this.asString(row.description);
        const normalizedName = fullName.includes('/')
          ? fullName.split('/').slice(1).join('/') || fullName
          : fullName;
        const uniqueKey = `${repoName}/${normalizedName}`;
        grouped.set(uniqueKey, {
          repository: repoName,
          name: normalizedName,
          fullName: uniqueKey,
          source: 'hub',
          versions: [
            {
              version: chartVersion,
              appVersion,
              description,
            },
          ],
        });
      }
    } catch {
      // Ignore hub query failures so repo mode remains usable.
    }
  }

  async listReleases(query: HelmListQuery): Promise<HelmListPayload> {
    const clusterId = this.normalizeOptional(query.clusterId);
    const namespace = this.normalizeOptional(query.namespace);
    const keyword = this.normalizeOptional(query.keyword)?.toLowerCase();
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 20);

    const releases = clusterId
      ? await this.withKubeconfig(clusterId, (ctx) =>
          this.fetchReleases(ctx, namespace),
        )
      : await this.listAllReleases(namespace);

    const filtered = keyword
      ? releases.filter((item) => {
          const name = (item.name || '').toLowerCase();
          const chart = (item.chart || '').toLowerCase();
          return name.includes(keyword) || chart.includes(keyword);
        })
      : releases;
    const sorted = this.sortReleaseRecords(
      filtered,
      query.sortBy,
      query.sortOrder,
    );

    const total = sorted.length;
    const start = (page - 1) * pageSize;

    return {
      items: sorted.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      timestamp: new Date().toISOString(),
    };
  }

  async getRelease(name: string, query: HelmReleaseQuery): Promise<unknown> {
    const releaseName = this.requireNonEmpty(name, 'release name');
    const clusterId = this.requireNonEmpty(query.clusterId, 'clusterId');
    const namespace = await this.resolveReleaseNamespace(
      clusterId,
      releaseName,
      query.namespace,
    );

    return this.withKubeconfig(clusterId, async (ctx) => {
      try {
        const output = await this.runHelm(
          ['status', releaseName, '--namespace', namespace, '--output', 'json'],
          ctx,
        );
        return (
          this.tryParseJson(output.stdout.trim()) ?? { raw: output.stdout }
        );
      } catch (error) {
        if (!this.isHelmCliUnavailable(error)) {
          throw error;
        }
        const fallback = await this.findReleaseFromInventory(
          ctx,
          namespace,
          releaseName,
        );
        return this.buildFallbackReleaseStatusPayload(
          fallback,
          namespace,
          this.extractErrorMessage(error),
        );
      }
    });
  }

  async getReleaseValues(
    name: string,
    query: HelmReleaseQuery,
  ): Promise<unknown> {
    const releaseName = this.requireNonEmpty(name, 'release name');
    const clusterId = this.requireNonEmpty(query.clusterId, 'clusterId');
    const namespace = await this.resolveReleaseNamespace(
      clusterId,
      releaseName,
      query.namespace,
    );

    return this.withKubeconfig(clusterId, async (ctx) => {
      try {
        const output = await this.runHelm(
          [
            'get',
            'values',
            releaseName,
            '--namespace',
            namespace,
            '--all',
            '--output',
            'json',
          ],
          ctx,
        );
        return (
          this.tryParseJson(output.stdout.trim()) ?? { raw: output.stdout }
        );
      } catch (error) {
        if (!this.isHelmCliUnavailable(error)) {
          throw error;
        }
        return {
          _fallback: true,
          _reason: this.extractErrorMessage(error),
          _message: 'helm CLI 不可用，当前仅返回降级信息',
          release: {
            name: releaseName,
            namespace,
          },
        };
      }
    });
  }

  async getReleaseManifest(
    name: string,
    query: HelmReleaseQuery,
  ): Promise<{ manifest: string; name: string; namespace: string }> {
    const releaseName = this.requireNonEmpty(name, 'release name');
    const clusterId = this.requireNonEmpty(query.clusterId, 'clusterId');
    const namespace = await this.resolveReleaseNamespace(
      clusterId,
      releaseName,
      query.namespace,
    );

    return this.withKubeconfig(clusterId, async (ctx) => {
      try {
        const output = await this.runHelm(
          ['get', 'manifest', releaseName, '--namespace', namespace],
          ctx,
        );
        return {
          manifest: output.stdout,
          name: releaseName,
          namespace,
        };
      } catch (error) {
        if (!this.isHelmCliUnavailable(error)) {
          throw error;
        }
        return {
          manifest: [
            `# Fallback: helm CLI 不可用`,
            `# release: ${releaseName}`,
            `# namespace: ${namespace}`,
            `# reason: ${this.extractErrorMessage(error)}`,
          ].join('\n'),
          name: releaseName,
          namespace,
        };
      }
    });
  }

  async getReleaseHistory(
    name: string,
    query: HelmReleaseQuery,
  ): Promise<unknown> {
    const releaseName = this.requireNonEmpty(name, 'release name');
    const clusterId = this.requireNonEmpty(query.clusterId, 'clusterId');
    const namespace = await this.resolveReleaseNamespace(
      clusterId,
      releaseName,
      query.namespace,
    );

    return this.withKubeconfig(clusterId, async (ctx) => {
      try {
        const output = await this.runHelm(
          [
            'history',
            releaseName,
            '--namespace',
            namespace,
            '--output',
            'json',
          ],
          ctx,
        );
        return (
          this.tryParseJson(output.stdout.trim()) ?? { raw: output.stdout }
        );
      } catch (error) {
        if (!this.isHelmCliUnavailable(error)) {
          throw error;
        }
        const fallback = await this.findReleaseFromInventory(
          ctx,
          namespace,
          releaseName,
        );
        return [
          {
            revision: fallback?.revision ?? '1',
            status: fallback?.status ?? 'unknown',
            chart: fallback?.chart ?? '',
            app_version: fallback?.appVersion ?? '',
            updated: fallback?.updated ?? new Date().toISOString(),
            description: `Fallback: helm CLI 不可用（${this.extractErrorMessage(
              error,
            )}）`,
          },
        ];
      }
    });
  }

  async installRelease(body: HelmInstallRequest): Promise<HelmMutationPayload> {
    const clusterId = this.requireNonEmpty(body.clusterId, 'clusterId');
    const namespace = this.requireNonEmpty(body.namespace, 'namespace');
    const name = this.requireNonEmpty(body.name, 'name');
    const chart = this.resolveChartReference(
      body.chart,
      body.repositoryName,
      body.chartName,
    );

    return this.withKubeconfig(clusterId, async (ctx) => {
      const syncTargets = await this.resolveSyncTargets(
        clusterId,
        body.repositoryName,
        chart,
      );
      await this.syncRepositoriesForContext(ctx, {
        only: syncTargets,
        strict: Boolean(body.repositoryName),
      });

      const args = [
        'install',
        name,
        chart,
        '--namespace',
        namespace,
        '--output',
        'json',
      ];
      await this.applyCommonMutationFlags(args, ctx.workspaceDir, {
        version: body.version,
        repo: body.repo,
        createNamespace: body.createNamespace,
        values: body.values,
        set: body.set,
        wait: body.wait,
        timeoutSeconds: body.timeoutSeconds,
        atomic: body.atomic,
        dryRun: body.dryRun,
      });

      const output = await this.runHelm(args, ctx);
      return {
        name,
        namespace,
        clusterId,
        command: 'install',
        output: this.tryParseJson(output.stdout.trim()) ?? {
          raw: output.stdout,
        },
        timestamp: new Date().toISOString(),
      };
    });
  }

  async upgradeRelease(
    name: string,
    body: HelmUpgradeRequest,
  ): Promise<HelmMutationPayload> {
    this.requireConfirmFlag(body.confirm, 'upgrade');
    const releaseName = this.requireNonEmpty(name, 'release name');
    const clusterId = this.requireNonEmpty(body.clusterId, 'clusterId');
    const namespace = await this.resolveReleaseNamespace(
      clusterId,
      releaseName,
      body.namespace,
    );
    const chart = this.resolveChartReference(
      body.chart,
      body.repositoryName,
      body.chartName,
    );

    return this.withKubeconfig(clusterId, async (ctx) => {
      const syncTargets = await this.resolveSyncTargets(
        clusterId,
        body.repositoryName,
        chart,
      );
      await this.syncRepositoriesForContext(ctx, {
        only: syncTargets,
        strict: Boolean(body.repositoryName),
      });

      const args = [
        'upgrade',
        releaseName,
        chart,
        '--namespace',
        namespace,
        '--output',
        'json',
      ];
      await this.applyCommonMutationFlags(args, ctx.workspaceDir, {
        version: body.version,
        values: body.values,
        set: body.set,
        wait: body.wait,
        timeoutSeconds: body.timeoutSeconds,
        atomic: body.atomic,
        dryRun: body.dryRun,
      });
      if (body.install) {
        args.push('--install');
      }

      const output = await this.runHelm(args, ctx);
      return {
        name: releaseName,
        namespace,
        clusterId,
        command: 'upgrade',
        output: this.tryParseJson(output.stdout.trim()) ?? {
          raw: output.stdout,
        },
        timestamp: new Date().toISOString(),
      };
    });
  }

  async rollbackRelease(
    name: string,
    body: HelmRollbackRequest,
  ): Promise<HelmMutationPayload> {
    this.requireConfirmFlag(body.confirm, 'rollback');
    const releaseName = this.requireNonEmpty(name, 'release name');
    const clusterId = this.requireNonEmpty(body.clusterId, 'clusterId');
    const namespace = await this.resolveReleaseNamespace(
      clusterId,
      releaseName,
      body.namespace,
    );

    if (!Number.isInteger(body.revision) || (body.revision ?? 0) <= 0) {
      throw new BadRequestException('revision 必须为正整数');
    }

    return this.withKubeconfig(clusterId, async (ctx) => {
      const args = [
        'rollback',
        releaseName,
        String(body.revision),
        '--namespace',
        namespace,
      ];
      if (body.wait) {
        args.push('--wait');
      }
      if (body.cleanupOnFail) {
        args.push('--cleanup-on-fail');
      }
      if (body.dryRun) {
        args.push('--dry-run');
      }
      if (body.timeoutSeconds && body.timeoutSeconds > 0) {
        args.push('--timeout', `${body.timeoutSeconds}s`);
      }

      const output = await this.runHelm(args, ctx);
      return {
        name: releaseName,
        namespace,
        clusterId,
        command: 'rollback',
        output: this.tryParseJson(output.stdout.trim()) ?? {
          raw: output.stdout,
        },
        timestamp: new Date().toISOString(),
      };
    });
  }

  async uninstallRelease(
    name: string,
    body: HelmUninstallRequest,
  ): Promise<HelmMutationPayload> {
    this.requireConfirmFlag(body.confirm, 'uninstall');
    const releaseName = this.requireNonEmpty(name, 'release name');
    const clusterId = this.requireNonEmpty(body.clusterId, 'clusterId');
    const namespace = await this.resolveReleaseNamespace(
      clusterId,
      releaseName,
      body.namespace,
    );

    return this.withKubeconfig(clusterId, async (ctx) => {
      const args = ['uninstall', releaseName, '--namespace', namespace];
      if (body.keepHistory) {
        args.push('--keep-history');
      }
      if (body.wait) {
        args.push('--wait');
      }
      if (body.timeoutSeconds && body.timeoutSeconds > 0) {
        args.push('--timeout', `${body.timeoutSeconds}s`);
      }

      const output = await this.runHelm(args, ctx);
      return {
        name: releaseName,
        namespace,
        clusterId,
        command: 'uninstall',
        output: output.stdout.trim() || output.stderr.trim() || 'ok',
        timestamp: new Date().toISOString(),
      };
    });
  }

  private async fetchReleases(
    ctx: HelmExecContext,
    namespace?: string,
  ): Promise<HelmReleaseItem[]> {
    const errors: unknown[] = [];
    const candidates = namespace
      ? [{ mode: 'namespace' as const, namespace }]
      : [
          { mode: 'all' as const },
          { mode: 'namespace' as const, namespace: ctx.defaultNamespace },
        ];
    const merged = new Map<string, HelmReleaseItem>();

    for (const candidate of candidates) {
      try {
        const args = ['list', '--output', 'json'];
        if (candidate.mode === 'all') {
          args.push('--all-namespaces');
        } else if (candidate.namespace) {
          args.push('--namespace', candidate.namespace);
        }
        const output = await this.runHelm(args, ctx);
        const parsed = this.tryParseJson(output.stdout.trim());
        const rows = Array.isArray(parsed)
          ? parsed
          : this.isRecord(parsed) && Array.isArray(parsed.Releases)
            ? parsed.Releases
            : [];
        for (const row of rows) {
          const release = this.normalizeReleaseItem(row);
          if (!release.name || !release.namespace) {
            continue;
          }
          const key = `${release.namespace}/${release.name}`;
          const current = merged.get(key);
          if (!current) {
            merged.set(key, release);
            continue;
          }
          const nextRevision = this.parseRevision(release.revision);
          const currentRevision = this.parseRevision(current.revision);
          if (nextRevision > currentRevision) {
            merged.set(key, release);
          }
        }
      } catch (error) {
        errors.push(error);
      }
    }

    const storageReleases = await this.fetchStorageBackedReleases(
      ctx,
      namespace,
    ).catch(() => []);
    for (const release of storageReleases) {
      const key = `${release.namespace}/${release.name}`;
      if (!merged.has(key)) {
        merged.set(key, release);
      }
    }

    if (merged.size > 0) {
      return Array.from(merged.values());
    }
    if (errors.length > 0) {
      throw errors[0];
    }
    return [];
  }

  private normalizeReleaseItem(item: unknown): HelmReleaseItem {
    const source = this.isRecord(item) ? item : {};
    return {
      name: this.asString(source.name),
      namespace: this.asString(source.namespace),
      revision: this.asString(source.revision),
      updated: this.asString(source.updated),
      status: this.asString(source.status),
      chart: this.asString(source.chart),
      appVersion: this.asString(source.app_version),
    };
  }

  private async resolveReleaseNamespace(
    clusterId: string,
    releaseName: string,
    namespace?: string,
  ): Promise<string> {
    const normalizedNamespace = this.normalizeOptional(namespace);
    if (normalizedNamespace) {
      return normalizedNamespace;
    }

    const candidates = await this.withKubeconfig(clusterId, (ctx) =>
      this.fetchReleases(ctx),
    );
    const matched = candidates.filter((item) => item.name === releaseName);

    if (matched.length === 1 && matched[0].namespace) {
      return matched[0].namespace;
    }

    if (matched.length === 0) {
      throw new NotFoundException(
        `release ${releaseName} 不存在，请显式传入 namespace`,
      );
    }

    throw new BadRequestException(
      `release ${releaseName} 在多个 namespace 中存在，请显式传入 namespace`,
    );
  }

  private async withKubeconfig<T>(
    clusterId: string,
    runner: (ctx: HelmExecContext) => Promise<T>,
  ): Promise<T> {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new NotFoundException(
        `cluster ${clusterId} 不存在或未配置 kubeconfig`,
      );
    }

    const workspaceDir = await mkdtemp(join(tmpdir(), 'helm-kubeconfig-'));
    const kubeconfigPath = join(workspaceDir, 'config');
    const helmConfigHome = join(workspaceDir, 'helm-config');
    const helmCacheHome = join(workspaceDir, 'helm-cache');
    const helmDataHome = join(workspaceDir, 'helm-data');
    const helmRepoConfig = join(helmConfigHome, 'repositories.yaml');
    const helmRepoCache = join(helmCacheHome, 'repository');

    await writeFile(kubeconfigPath, kubeconfig, 'utf8');
    await Promise.all([
      mkdir(helmConfigHome, { recursive: true }),
      mkdir(helmCacheHome, { recursive: true }),
      mkdir(helmDataHome, { recursive: true }),
      mkdir(helmRepoCache, { recursive: true }),
    ]);

    const helmEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HELM_CONFIG_HOME: helmConfigHome,
      HELM_CACHE_HOME: helmCacheHome,
      HELM_DATA_HOME: helmDataHome,
      HELM_REPOSITORY_CONFIG: helmRepoConfig,
      HELM_REPOSITORY_CACHE: helmRepoCache,
    };
    const defaultNamespace =
      this.parseDefaultNamespaceFromKubeconfig(kubeconfig) ?? 'default';

    try {
      return await runner({
        clusterId,
        kubeconfigPath,
        workspaceDir,
        helmEnv,
        defaultNamespace,
      });
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  }

  private async runHelm(
    args: string[],
    ctx: HelmExecContext,
  ): Promise<{ stdout: string; stderr: string }> {
    const finalArgs = [...args, '--kubeconfig', ctx.kubeconfigPath];

    try {
      const result = await execFileAsync('helm', finalArgs, {
        maxBuffer: 10 * 1024 * 1024,
        env: ctx.helmEnv,
        timeout: HELM_COMMAND_TIMEOUT_MS,
      });
      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };

      if (err.code === 'ENOENT') {
        throw new ServiceUnavailableException({
          code: 'HELM_CLI_NOT_FOUND',
          message: 'helm CLI 不可用，请先在 control-api 运行环境安装 helm',
        });
      }

      if (err.code === 'ETIMEDOUT' || err.killed) {
        throw new BadRequestException({
          code: 'HELM_COMMAND_TIMEOUT',
          message: `helm 命令执行超时: helm ${this.sanitizeHelmArgs(args).join(' ')}`,
          details: {
            timeoutMs: HELM_COMMAND_TIMEOUT_MS,
            stderr: err.stderr?.trim() || undefined,
            stdout: err.stdout?.trim() || undefined,
          },
        });
      }

      throw new BadRequestException({
        code: this.classifyHelmCommandFailure(err.stderr, err.stdout),
        message: `helm 命令执行失败: helm ${this.sanitizeHelmArgs(args).join(' ')}`,
        details: {
          exitCode: typeof err.code === 'number' ? err.code : undefined,
          stderr: err.stderr?.trim() || undefined,
          stdout: err.stdout?.trim() || undefined,
        },
      });
    }
  }

  private async syncRepositoriesForContext(
    ctx: HelmExecContext,
    options?: SyncOptions,
  ): Promise<void> {
    const records =
      options?.only ?? (await this.repositoryStore.list(ctx.clusterId));
    if (records.length === 0) {
      return;
    }

    const failed: Array<{ name: string; code: string; message: string }> = [];
    for (const repository of records) {
      const syncing: HelmRepositoryRecord = {
        ...repository,
        syncStatus: 'syncing',
        message: '正在同步仓库索引',
        updatedAt: new Date().toISOString(),
      };
      await this.repositoryStore.save(syncing);

      try {
        const repositoryKind = this.resolveRepositoryKind(repository);
        await this.validateRepositoryDefinition(repository, ctx);
        await this.repositoryStore.save({
          ...repository,
          syncStatus: 'validated',
          message:
            repositoryKind === 'oci'
              ? 'OCI 仓库定义校验通过，准备验证 registry'
              : '仓库地址校验通过，准备同步 Helm 索引',
          updatedAt: new Date().toISOString(),
        });

        if (repositoryKind === 'oci') {
          await this.syncOciRepository(ctx, repository);
        } else {
          await this.syncHttpRepository(ctx, repository);
        }

        await this.repositoryStore.save({
          ...repository,
          repositoryKind,
          syncStatus: 'synced',
          message:
            repositoryKind === 'oci' ? 'OCI 仓库校验成功' : '仓库同步成功',
          lastSyncAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        failed.push({
          name: repository.name,
          code: this.extractErrorCode(error),
          message: this.extractErrorMessage(error),
        });
        await this.repositoryStore.save({
          ...repository,
          syncStatus: 'failed',
          message: this.extractErrorMessage(error),
          lastSyncAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (options?.strict && failed.length > 0) {
      throw new BadRequestException({
        code: 'HELM_REPOSITORY_SYNC_FAILED',
        message: `Helm 仓库同步失败: ${failed
          .map((item) => item.name)
          .join(', ')}`,
        details: { failed },
      });
    }
  }

  private async mergeRepositoryInventory(
    clusterId: string,
  ): Promise<HelmRepositoryInventoryMerge> {
    const storedRecords = await this.repositoryStore.list(clusterId);
    const hostInventory = await this.readHostRepositoryInventory();
    if (hostInventory.items.length === 0) {
      return {
        records: storedRecords,
        diagnostics: hostInventory.diagnostics,
      };
    }

    const merged = new Map<string, HelmRepositoryRecord>();
    for (const record of storedRecords) {
      merged.set(record.name, record);
    }

    const now = new Date().toISOString();
    for (const item of hostInventory.items) {
      const existing = merged.get(item.name);
      const next: HelmRepositoryRecord = {
        clusterId,
        name: item.name,
        url: item.url,
        repositoryKind: item.repositoryKind,
        source: existing?.source ?? 'host-cli',
        authType: existing?.authType ?? 'none',
        username: existing?.username,
        password: existing?.password,
        caFile: existing?.caFile,
        caData: existing?.caData,
        insecureSkipTlsVerify: existing?.insecureSkipTlsVerify,
        syncStatus: existing?.syncStatus ?? 'synced',
        lastSyncAt: existing?.lastSyncAt ?? now,
        message: existing?.message ?? '来源于宿主 Helm 仓库配置',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      merged.set(item.name, next);
    }

    const mergedRecords = Array.from(merged.values());
    await Promise.all(
      mergedRecords.map((record) => this.repositoryStore.save(record)),
    );
    return {
      records: mergedRecords,
      diagnostics: hostInventory.diagnostics,
    };
  }

  private async listAllRepositoryInventory(): Promise<HelmRepositoryInventoryMerge> {
    const clusters = await this.listHelmClusters();
    if (clusters.length === 0) {
      return { records: [], diagnostics: [] };
    }

    const records: HelmRepositoryRecord[] = [];
    const diagnostics: HelmRepositoryInventoryDiagnostic[] = [];
    for (const cluster of clusters) {
      try {
        const merged = await this.mergeRepositoryInventory(cluster.id);
        records.push(...merged.records);
        diagnostics.push(...merged.diagnostics);
      } catch (error) {
        diagnostics.push({
          source: 'repositories.yaml',
          status: 'failed',
          message: `集群 ${cluster.id} 自动导入宿主 Helm 仓库失败：${this.extractErrorMessage(
            error,
          )}`,
        });
        continue;
      }
    }

    return {
      records: this.sortRepositoryRecords(records),
      diagnostics,
    };
  }

  private async listAllReleases(
    namespace?: string,
  ): Promise<HelmReleaseItem[]> {
    const clusters = await this.listHelmClusters();
    if (clusters.length === 0) {
      return [];
    }

    const merged = new Map<string, HelmReleaseItem>();
    const errors: unknown[] = [];

    await Promise.all(
      clusters.map(async (cluster) => {
        try {
          const releases = await this.withTimeout(
            this.withKubeconfig(cluster.id, (ctx) =>
              this.fetchReleases(ctx, namespace),
            ),
            HELM_ALL_RELEASES_CLUSTER_TIMEOUT_MS,
            `Helm Release 查询超时: clusterId=${cluster.id}`,
          );
          for (const release of releases) {
            if (!release.name || !release.namespace) {
              continue;
            }
            const key = `${release.namespace}/${release.name}/${cluster.id}`;
            const current = merged.get(key);
            if (!current) {
              merged.set(key, { ...release, clusterId: cluster.id });
            }
          }
        } catch (error) {
          errors.push(error);
        }
      }),
    );

    const releases = Array.from(merged.values());
    if (releases.length > 0) {
      return this.sortReleaseRecords(releases);
    }
    if (errors.length > 0) {
      throw errors[0];
    }
    return [];
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async readHostRepositoryInventory(): Promise<HelmHostRepositoryInventory> {
    const fileRecords = await this.readHelmRepositoryConfigInventory();
    if (fileRecords.items.length > 0) {
      return fileRecords;
    }

    const outputs = [
      { args: ['repo', 'list', '--output', 'json'] as const, parseJson: true },
      { args: ['repo', 'list'] as const, parseJson: false },
    ] as const;
    const diagnostics = [...fileRecords.diagnostics];

    for (const outputSpec of outputs) {
      const command = `helm ${outputSpec.args.join(' ')}`;
      try {
        const output = await execFileAsync('helm', [...outputSpec.args], {
          maxBuffer: 2 * 1024 * 1024,
          timeout: HELM_COMMAND_TIMEOUT_MS,
        });
        const text = (output.stdout ?? '').trim();
        if (!text) {
          diagnostics.push({
            source: 'helm repo list',
            status: 'skipped',
            command,
            message: '命令无输出',
          });
          continue;
        }

        const parsed = outputSpec.parseJson
          ? this.tryParseJson(text)
          : undefined;
        const rows = Array.isArray(parsed)
          ? parsed
          : this.isRecord(parsed) && Array.isArray(parsed.repositories)
            ? parsed.repositories
            : this.isRecord(parsed) && Array.isArray(parsed.items)
              ? parsed.items
              : this.parseHelmRepoListText(text);

        if (rows.length > 0) {
          const items = rows
            .map((item) => {
              const row = this.isRecord(item) ? item : {};
              const url = this.asString(row.url).trim();
              return {
                name: this.asString(row.name).trim(),
                url,
                repositoryKind: this.inferRepositoryKind(url),
              };
            })
            .filter(
              (item): item is HelmCliRepositoryItem =>
                Boolean(item.name) && Boolean(item.url),
            );
          diagnostics.push({
            source: 'helm repo list',
            status: 'success',
            command,
            message: `读取到 ${items.length} 个宿主 Helm 仓库`,
          });
          return { items, diagnostics };
        }
      } catch (error) {
        diagnostics.push({
          source: 'helm repo list',
          status: 'failed',
          command,
          code: this.extractProcessErrorCode(error),
          message: this.extractProcessErrorMessage(error),
        });
        continue;
      }
    }

    return { items: [], diagnostics };
  }

  private parseHelmRepoListText(text: string): HelmCliRepositoryItem[] {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= 1) {
      return [];
    }

    return lines
      .slice(1)
      .map((line) => line.split(/\s+/).filter(Boolean))
      .filter((parts) => parts.length >= 2)
      .map((parts) => ({
        name: parts[0] ?? '',
        url: parts[1] ?? '',
        repositoryKind: this.inferRepositoryKind(parts[1] ?? ''),
      }))
      .filter(
        (item): item is HelmCliRepositoryItem =>
          Boolean(item.name) && Boolean(item.url),
      );
  }

  private async readHelmRepositoryConfigInventory(): Promise<HelmHostRepositoryInventory> {
    const candidates = this.getHelmRepositoryConfigCandidates();
    const diagnostics: HelmRepositoryInventoryDiagnostic[] = [];
    for (const helmRepoConfig of candidates) {
      try {
        const raw = await readFile(helmRepoConfig, 'utf8');
        const parsed = this.tryParseYaml(raw);
        const repositories = this.toRecord(parsed).repositories;
        const rows = Array.isArray(repositories)
          ? repositories
          : this.isRecord(repositories) &&
              Array.isArray(repositories.repositories)
            ? repositories.repositories
            : [];

        const records = rows
          .map((item) => {
            const row = this.isRecord(item) ? item : {};
            const url = this.asString(row.url).trim();
            return {
              name: this.asString(row.name).trim(),
              url,
              repositoryKind: this.inferRepositoryKind(url),
            };
          })
          .filter(
            (item): item is HelmCliRepositoryItem =>
              Boolean(item.name) && Boolean(item.url),
          );

        if (records.length > 0) {
          diagnostics.push({
            source: 'repositories.yaml',
            status: 'success',
            path: helmRepoConfig,
            message: `读取到 ${records.length} 个宿主 Helm 仓库`,
          });
          return { items: records, diagnostics };
        }
        diagnostics.push({
          source: 'repositories.yaml',
          status: 'skipped',
          path: helmRepoConfig,
          message: '文件存在但未读取到仓库',
        });
      } catch (error) {
        diagnostics.push({
          source: 'repositories.yaml',
          status: 'failed',
          path: helmRepoConfig,
          code: this.extractProcessErrorCode(error),
          message: this.extractProcessErrorMessage(error),
        });
        continue;
      }
    }

    return { items: [], diagnostics };
  }

  private getHelmRepositoryConfigCandidates(): string[] {
    const candidates = new Set<string>();
    const explicitConfigs = [
      process.env.KUBENOVA_HELM_REPOSITORY_CONFIG,
      process.env.KUBENOVA_HELM_REPOSITORY_CONFIGS,
    ]
      .flatMap((value) => (value ?? '').split(':'))
      .map((value) => value.trim())
      .filter(Boolean);
    for (const configPath of explicitConfigs) {
      candidates.add(configPath);
    }

    const envConfig = process.env.HELM_REPOSITORY_CONFIG?.trim();
    if (envConfig) {
      candidates.add(envConfig);
    }

    const envConfigHome = process.env.HELM_CONFIG_HOME?.trim();
    if (envConfigHome) {
      candidates.add(join(envConfigHome, 'repositories.yaml'));
    }

    const home = process.env.HOME?.trim() || homedir();
    if (home) {
      candidates.add(join(home, '.config', 'helm', 'repositories.yaml'));
      candidates.add(join(home, '.helm', 'repositories.yaml'));
    }
    candidates.add('/root/.config/helm/repositories.yaml');
    candidates.add('/root/.helm/repositories.yaml');
    candidates.add('/etc/kubenova/helm/repositories.yaml');

    return Array.from(candidates);
  }

  private async validateRepositoryDefinition(
    repository: HelmRepositoryRecord,
    ctx: HelmExecContext,
  ): Promise<void> {
    const repositoryKind = this.resolveRepositoryKind(repository);
    if (repositoryKind === 'oci') {
      this.validateOciRepositoryUrl(repository.url);
      await this.ensureOciRepositorySupported(ctx);
      return;
    }

    await this.validateHttpRepositoryUrl(repository);
  }

  private async syncHttpRepository(
    ctx: HelmExecContext,
    repository: HelmRepositoryRecord,
  ): Promise<void> {
    const addArgs = [
      'repo',
      'add',
      repository.name,
      repository.url,
      '--force-update',
    ];
    await this.appendRepositoryAccessFlags(addArgs, ctx, repository, 'http');
    await this.runHelm(addArgs, ctx);
    await this.runHelm(['repo', 'update', repository.name], ctx);
  }

  private async syncOciRepository(
    ctx: HelmExecContext,
    repository: HelmRepositoryRecord,
  ): Promise<void> {
    this.validateOciRepositoryUrl(repository.url);
    await this.ensureOciRepositorySupported(ctx);
    if (repository.authType !== 'basic') {
      return;
    }

    const url = new URL(repository.url);
    const args = ['registry', 'login', url.host];
    await this.appendRepositoryAccessFlags(args, ctx, repository, 'oci');
    await this.runHelm(args, ctx);
  }

  private async validateHttpRepositoryUrl(
    repository: HelmRepositoryRecord,
  ): Promise<void> {
    if (
      repository.caFile ||
      repository.caData ||
      repository.insecureSkipTlsVerify
    ) {
      return;
    }

    const normalized = this.requireNonEmpty(
      repository.url,
      'repository url',
    ).replace(/\/+$/, '');
    const endpoint = normalized.endsWith('index.yaml')
      ? normalized
      : `${normalized}/index.yaml`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/x-yaml, text/yaml, text/plain, */*',
      };
      if (repository.authType === 'basic') {
        const token = Buffer.from(
          `${repository.username ?? ''}:${repository.password ?? ''}`,
          'utf8',
        ).toString('base64');
        headers.Authorization = `Basic ${token}`;
      }
      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        throw new BadRequestException({
          code: 'HELM_REPOSITORY_INDEX_UNAVAILABLE',
          message: `仓库索引不可访问（HTTP ${response.status}）`,
        });
      }
      const content = await response.text();
      const normalizedContent = content.trim().toLowerCase();
      if (
        !normalizedContent.includes('apiversion') ||
        !normalizedContent.includes('entries:')
      ) {
        throw new BadRequestException({
          code: 'HELM_REPOSITORY_INDEX_INVALID',
          message: '仓库 index.yaml 格式无效',
        });
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadRequestException({
          code: 'HELM_REPOSITORY_TIMEOUT',
          message: '仓库校验超时，请检查网络连通性',
        });
      }
      throw new BadRequestException({
        code: 'HELM_REPOSITORY_VALIDATE_FAILED',
        message: `仓库校验失败：${error instanceof Error ? error.message : '未知错误'}`,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private validateOciRepositoryUrl(url: string): void {
    const normalized = this.requireNonEmpty(url, 'repository url');
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new BadRequestException({
        code: 'HELM_REPOSITORY_URL_INVALID',
        message: 'OCI 仓库 URL 格式不合法',
        details: { url: normalized },
      });
    }
    if (parsed.protocol !== 'oci:' || !parsed.host) {
      throw new BadRequestException({
        code: 'HELM_OCI_REPOSITORY_INVALID',
        message: 'OCI 仓库 URL 必须使用 oci://registry/path',
        details: { url: normalized },
      });
    }
  }

  private async ensureOciRepositorySupported(
    ctx: HelmExecContext,
  ): Promise<void> {
    const output = await this.runHelm(
      ['version', '--template', '{{.Version}}'],
      ctx,
    );
    const version = output.stdout.trim().replace(/^v/, '');
    const [majorRaw, minorRaw] = version.split('.');
    const major = Number.parseInt(majorRaw ?? '', 10);
    const minor = Number.parseInt(minorRaw ?? '', 10);
    if (!Number.isInteger(major) || !Number.isInteger(minor)) {
      return;
    }
    if (major < 3 || (major === 3 && minor < 8)) {
      throw new BadRequestException({
        code: 'HELM_OCI_UNSUPPORTED',
        message: `当前 helm ${output.stdout.trim()} 不支持稳定 OCI 仓库，请升级到 Helm 3.8+`,
      });
    }
  }

  private async appendRepositoryAccessFlags(
    args: string[],
    ctx: HelmExecContext,
    repository: HelmRepositoryRecord,
    repositoryKind: HelmRepositoryKind,
  ): Promise<void> {
    if (repository.authType === 'basic') {
      args.push('--username', repository.username ?? '');
      args.push('--password', repository.password ?? '');
    }
    const caFile = await this.resolveRepositoryCaFile(ctx, repository);
    if (caFile) {
      args.push('--ca-file', caFile);
    }
    if (repository.insecureSkipTlsVerify) {
      args.push(
        repositoryKind === 'oci' ? '--insecure' : '--insecure-skip-tls-verify',
      );
    }
  }

  private async resolveRepositoryCaFile(
    ctx: HelmExecContext,
    repository: HelmRepositoryRecord,
  ): Promise<string | undefined> {
    if (repository.caFile) {
      return repository.caFile;
    }
    if (!repository.caData) {
      return undefined;
    }
    const caPath = join(
      ctx.workspaceDir,
      `helm-repository-ca-${repository.name}.pem`,
    );
    await writeFile(caPath, repository.caData, 'utf8');
    return caPath;
  }

  private async applyCommonMutationFlags(
    args: string[],
    workspaceDir: string,
    options: HelmMutationFlagOptions,
  ): Promise<void> {
    if (options.version) {
      args.push('--version', options.version);
    }
    if (options.repo) {
      args.push('--repo', options.repo);
    }
    if (options.createNamespace) {
      args.push('--create-namespace');
    }
    if (options.wait) {
      args.push('--wait');
    }
    if (options.atomic) {
      args.push('--atomic');
    }
    if (options.dryRun) {
      args.push('--dry-run');
    }
    if (options.timeoutSeconds && options.timeoutSeconds > 0) {
      args.push('--timeout', `${options.timeoutSeconds}s`);
    }

    if (options.values && Object.keys(options.values).length > 0) {
      const valuesPath = await this.writeValuesFile(
        workspaceDir,
        options.values,
      );
      args.push('--values', valuesPath);
    }

    if (options.set && Object.keys(options.set).length > 0) {
      for (const [key, value] of Object.entries(options.set)) {
        args.push('--set', `${key}=${String(value)}`);
      }
    }
  }

  private async writeValuesFile(
    workspaceDir: string,
    values: Record<string, unknown>,
  ): Promise<string> {
    const valuesPath = join(workspaceDir, `values-${Date.now()}.yaml`);
    // JSON 是 YAML 的子集，helm --values 可直接读取。
    await writeFile(valuesPath, JSON.stringify(values, null, 2), 'utf8');
    return valuesPath;
  }

  private parseDefaultNamespaceFromKubeconfig(
    kubeconfig: string,
  ): string | undefined {
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromString(kubeconfig);
      const current = kc.getCurrentContext();
      const context = current ? kc.getContextObject(current) : undefined;
      const namespace = context?.namespace?.trim();
      return namespace || undefined;
    } catch {
      return undefined;
    }
  }

  private async fetchStorageBackedReleases(
    ctx: HelmExecContext,
    namespace?: string,
  ): Promise<HelmReleaseItem[]> {
    const kc = new k8s.KubeConfig();
    kc.loadFromFile(ctx.kubeconfigPath);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);
    const labelSelector = 'owner=helm';

    const collect = async (
      targetNamespace?: string,
    ): Promise<HelmReleaseItem[]> => {
      const [secretResp, configMapResp] = targetNamespace
        ? await Promise.all([
            coreApi.listNamespacedSecret({
              namespace: targetNamespace,
              labelSelector,
            }),
            coreApi.listNamespacedConfigMap({
              namespace: targetNamespace,
              labelSelector,
            }),
          ])
        : await Promise.all([
            coreApi.listSecretForAllNamespaces({ labelSelector }),
            coreApi.listConfigMapForAllNamespaces({ labelSelector }),
          ]);

      const merged = new Map<string, HelmReleaseItem>();
      const rows = [
        ...secretResp.items.map((item) =>
          this.toStorageBackedRelease(item, 'secret'),
        ),
        ...configMapResp.items.map((item) =>
          this.toStorageBackedRelease(item, 'configmap'),
        ),
      ].filter((item): item is HelmReleaseItem => Boolean(item));

      for (const release of rows) {
        const key = `${release.namespace}/${release.name}`;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, release);
          continue;
        }
        if (
          this.parseRevision(release.revision) >
          this.parseRevision(existing.revision)
        ) {
          merged.set(key, release);
        }
      }

      return Array.from(merged.values());
    };

    if (namespace) {
      return collect(namespace);
    }

    try {
      return await collect();
    } catch {
      return await collect(ctx.defaultNamespace);
    }
  }

  private toStorageBackedRelease(
    resource: { metadata?: k8s.V1ObjectMeta },
    source: 'secret' | 'configmap',
  ): HelmReleaseItem | undefined {
    const metadata = resource.metadata;
    const labels = metadata?.labels ?? {};
    const parsed = this.parseHelmStorageResourceName(metadata?.name);
    const name = this.asString(labels.name) || parsed?.name || '';
    const namespace = metadata?.namespace?.trim() ?? '';
    const revisionNumber =
      this.parseRevision(this.asString(labels.version)) ||
      parsed?.revision ||
      0;
    if (!name || !namespace || revisionNumber <= 0) {
      return undefined;
    }

    return {
      name,
      namespace,
      revision: String(revisionNumber),
      updated: this.toIsoDate(metadata?.creationTimestamp),
      status: this.asString(labels.status) || 'unknown',
      chart: this.asString(labels.chart),
      appVersion: '',
      // source info is retained in status for visibility.
      ...(source === 'configmap' ? {} : {}),
    };
  }

  private parseHelmStorageResourceName(
    name: string | undefined,
  ): { name: string; revision: number } | undefined {
    const normalized = name?.trim();
    if (!normalized) {
      return undefined;
    }
    const match = normalized.match(/^sh\.helm\.release\.v1\.(.+)\.v(\d+)$/);
    if (!match) {
      return undefined;
    }
    const releaseName = match[1]?.trim();
    const revision = Number.parseInt(match[2] ?? '', 10);
    if (!releaseName || !Number.isInteger(revision) || revision < 1) {
      return undefined;
    }
    return { name: releaseName, revision };
  }

  private toIsoDate(value: string | Date | undefined): string {
    if (!value) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }

  private parseRevision(value: string | undefined): number {
    const normalized = value?.trim();
    if (!normalized) {
      return 0;
    }
    const parsed = Number.parseInt(normalized, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  private async findReleaseFromInventory(
    ctx: HelmExecContext,
    namespace: string,
    releaseName: string,
  ): Promise<HelmReleaseItem | null> {
    const releases: HelmReleaseItem[] = await this.fetchReleases(
      ctx,
      namespace,
    ).catch(() => []);
    return releases.find((item) => item.name === releaseName) ?? null;
  }

  private buildFallbackReleaseStatusPayload(
    release: HelmReleaseItem | null,
    namespace: string,
    reason: string,
  ): Record<string, unknown> {
    const now = new Date().toISOString();
    return {
      name: release?.name ?? '',
      namespace,
      chart: release?.chart ?? '',
      version: release?.revision ?? '1',
      status: release?.status ?? 'unknown',
      info: {
        status: release?.status ?? 'unknown',
        first_deployed: release?.updated ?? now,
        last_deployed: release?.updated ?? now,
        description: `Fallback: helm CLI 不可用（${reason}）`,
      },
      fallback: true,
      fallbackReason: reason,
    };
  }

  private isHelmCliUnavailable(error: unknown): boolean {
    if (!(error instanceof ServiceUnavailableException)) {
      return false;
    }
    const response = error.getResponse();
    if (!this.isRecord(response)) {
      return false;
    }
    return this.asString(response.code) === 'HELM_CLI_NOT_FOUND';
  }

  private isNoRepositoryConfiguredError(error: unknown): boolean {
    const text =
      `${this.extractErrorMessage(error)} ${this.extractErrorDetails(error)}`
        .toLowerCase()
        .trim();
    return (
      text.includes('no repositories configured') ||
      text.includes('no repositories to show') ||
      text.includes('has no repositories')
    );
  }

  private classifyHelmCommandFailure(
    stderr: string | undefined,
    stdout: string | undefined,
  ): string {
    const text = `${stderr ?? ''} ${stdout ?? ''}`.toLowerCase();
    if (
      text.includes('no such host') ||
      text.includes('connection refused') ||
      text.includes('network is unreachable') ||
      text.includes('i/o timeout') ||
      text.includes('timeout')
    ) {
      return 'HELM_COMMAND_TIMEOUT';
    }
    if (
      text.includes('already exists') ||
      text.includes('cannot re-use a name')
    ) {
      return 'HELM_REPOSITORY_DUPLICATE';
    }
    if (
      text.includes('index.yaml') ||
      text.includes('not a valid chart repository') ||
      text.includes('looks like') ||
      text.includes('failed to fetch')
    ) {
      return 'HELM_REPOSITORY_INDEX_INVALID';
    }
    if (
      text.includes('oci') &&
      (text.includes('unsupported') ||
        text.includes('unknown command') ||
        text.includes('experimental'))
    ) {
      return 'HELM_OCI_UNSUPPORTED';
    }
    return 'HELM_COMMAND_FAILED';
  }

  private sanitizeHelmArgs(args: string[]): string[] {
    return args.map((arg, index) => {
      const previous = args[index - 1];
      return previous === '--password' ? '******' : arg;
    });
  }

  private extractErrorDetails(error: unknown): string {
    if (!(error instanceof BadRequestException)) {
      return '';
    }
    const response = error.getResponse();
    if (!this.isRecord(response)) {
      return '';
    }
    const details = this.toRecord(response.details);
    const stderr = this.asString(details.stderr);
    const stdout = this.asString(details.stdout);
    return `${stderr} ${stdout}`.trim();
  }

  private extractProcessErrorCode(error: unknown): string | undefined {
    const processError = error as NodeJS.ErrnoException | undefined;
    const code = processError?.code;
    return typeof code === 'string' ? code : undefined;
  }

  private extractProcessErrorMessage(error: unknown): string {
    const processError = error as
      | (NodeJS.ErrnoException & { stderr?: string; stdout?: string })
      | undefined;
    const stderr = processError?.stderr?.trim();
    if (stderr) {
      return stderr;
    }
    const stdout = processError?.stdout?.trim();
    if (stdout) {
      return stdout;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return '未知错误';
  }

  private requireConfirmFlag(
    confirm: boolean | undefined,
    action: string,
  ): void {
    if (confirm !== true) {
      throw new BadRequestException({
        code: 'HELM_CONFIRM_REQUIRED',
        message: `${action} 是高风险操作，body.confirm 必须显式为 true`,
      });
    }
  }

  private requireNonEmpty(value: string | undefined, field: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException(`${field} 是必填参数`);
    }
    return normalized;
  }

  private normalizeOptional(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  private normalizeChartSearchMode(
    value: string | undefined,
  ): 'repo' | 'hub' | 'auto' {
    const normalized = this.normalizeOptional(value)?.toLowerCase();
    if (
      normalized === 'repo' ||
      normalized === 'hub' ||
      normalized === 'auto'
    ) {
      return normalized;
    }
    return 'auto';
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
  }

  private tryParseJson(content: string): unknown {
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private tryParseYaml(content: string): unknown {
    if (!content) return null;
    try {
      return k8s.loadYaml(content);
    } catch {
      return null;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private toRepositoryItem(source: HelmRepositoryRecord): HelmRepositoryItem {
    const normalizedStatus = this.normalizeSyncStatus(source.syncStatus);
    const diagnostics =
      normalizedStatus === 'failed'
        ? this.buildRepositoryItemDiagnostics(source)
        : undefined;
    return {
      clusterId: source.clusterId,
      name: source.name,
      url: source.url,
      repositoryKind: this.resolveRepositoryKind(source),
      authType: source.authType ?? 'none',
      source: source.source ?? 'manual',
      username: source.authType === 'basic' ? source.username : undefined,
      caFile: source.caFile,
      hasCaData: Boolean(source.caData),
      insecureSkipTlsVerify: source.insecureSkipTlsVerify,
      syncStatus: normalizedStatus,
      chartCount: undefined,
      lastSyncAt: source.lastSyncAt,
      message: source.message,
      diagnostics,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  }

  private buildRepositoryItemDiagnostics(
    source: HelmRepositoryRecord,
  ): HelmRepositoryItemDiagnostics {
    return {
      code: this.inferRepositoryFailureCode(source.message),
      reason: source.message,
      suggestion: this.resolveRepositoryFailureSuggestion(source.message),
      checkedAt: source.lastSyncAt ?? source.updatedAt,
    };
  }

  private normalizeSyncStatus(
    status: HelmRepositoryRecord['syncStatus'],
  ): HelmRepositoryItem['syncStatus'] {
    return status === 'ready' ? 'synced' : status;
  }

  private async ensureClusterExists(clusterId: string): Promise<void> {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new NotFoundException(
        `cluster ${clusterId} 不存在或未配置 kubeconfig`,
      );
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (this.isRecord(response)) {
        if (typeof response.message === 'string') {
          return response.message;
        }
        const responseMessage = response.message;
        if (Array.isArray(responseMessage) && responseMessage.length > 0) {
          const first = responseMessage[0] as unknown;
          if (typeof first === 'string') {
            return first;
          }
        }
      }
    }
    if (error instanceof Error) {
      return error.message;
    }
    return '未知错误';
  }

  private extractErrorCode(error: unknown): string {
    if (
      error instanceof BadRequestException ||
      error instanceof ServiceUnavailableException
    ) {
      const response = error.getResponse();
      if (this.isRecord(response)) {
        const code = this.asString(response.code);
        if (code) {
          return code;
        }
      }
    }
    return 'HELM_COMMAND_FAILED';
  }

  private toRepositorySyncException(
    error: unknown,
    repositoryName: string,
  ): BadRequestException {
    return new BadRequestException({
      code: this.extractErrorCode(error),
      message: `仓库 ${repositoryName} 同步失败`,
      details: {
        reason: this.extractErrorMessage(error),
        failed: this.toRecord(
          this.toRecord(
            error instanceof BadRequestException ? error.getResponse() : {},
          ).details,
        ).failed,
        retryable: true,
        suggestion: this.resolveRepositoryErrorSuggestion(error),
      },
    });
  }

  private resolveRepositoryErrorSuggestion(error: unknown): string {
    const code = this.extractErrorCode(error);
    if (code === 'HELM_CLI_NOT_FOUND') {
      return '请在 control-api 运行环境安装 helm，并确认 PATH 可访问';
    }
    if (code === 'HELM_REPOSITORY_INDEX_INVALID') {
      return '请确认 HTTP/S 仓库根路径存在 index.yaml，或切换为 OCI 仓库类型';
    }
    if (code === 'HELM_REPOSITORY_TIMEOUT' || code === 'HELM_COMMAND_TIMEOUT') {
      return '请检查 control-api 到仓库地址的网络、DNS、代理和防火墙';
    }
    if (code === 'HELM_OCI_UNSUPPORTED') {
      return '请升级 Helm 到 3.8+，或先使用 HTTP/S Chart 仓库';
    }
    if (code === 'HELM_REPOSITORY_DUPLICATE') {
      return '请使用不同仓库名，或编辑已有仓库';
    }
    return '请查看失败详情后重试同步';
  }

  private inferRepositoryFailureCode(message: string | undefined): string {
    const text = (message ?? '').toLowerCase();
    if (text.includes('helm cli 不可用') || text.includes('not found')) {
      return 'HELM_CLI_NOT_FOUND';
    }
    if (text.includes('index.yaml') || text.includes('索引')) {
      return 'HELM_REPOSITORY_INDEX_INVALID';
    }
    if (text.includes('timeout') || text.includes('超时')) {
      return 'HELM_REPOSITORY_TIMEOUT';
    }
    if (text.includes('duplicate') || text.includes('已存在')) {
      return 'HELM_REPOSITORY_DUPLICATE';
    }
    if (text.includes('unsupported') || text.includes('不支持')) {
      return 'HELM_OCI_UNSUPPORTED';
    }
    if (text.includes('oci')) {
      return 'HELM_OCI_REPOSITORY_INVALID';
    }
    return 'HELM_REPOSITORY_SYNC_FAILED';
  }

  private resolveRepositoryFailureSuggestion(
    message: string | undefined,
  ): string {
    const code = this.inferRepositoryFailureCode(message);
    if (code === 'HELM_CLI_NOT_FOUND') {
      return '请在 control-api 运行环境安装 helm，并确认 PATH 可访问';
    }
    if (code === 'HELM_REPOSITORY_INDEX_INVALID') {
      return '请确认 HTTP/S 仓库根路径存在 index.yaml，或切换为 OCI 仓库类型';
    }
    if (code === 'HELM_REPOSITORY_TIMEOUT') {
      return '请检查 control-api 到仓库地址的网络、DNS、代理和防火墙';
    }
    if (code === 'HELM_REPOSITORY_DUPLICATE') {
      return '请使用不同仓库名，或编辑已有仓库';
    }
    if (code === 'HELM_OCI_UNSUPPORTED') {
      return '请升级 Helm 到 3.8+，或先使用 HTTP/S Chart 仓库';
    }
    if (code === 'HELM_OCI_REPOSITORY_INVALID') {
      return '请确认 OCI URL 形如 oci://registry.example.com/path';
    }
    return '请查看失败详情后重试同步';
  }

  private normalizeRepositoryUrl(
    url: string | undefined,
    repositoryKind?: HelmRepositoryKind,
  ): string {
    const normalized = this.requireNonEmpty(url, 'url');
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new BadRequestException({
        code: 'HELM_REPOSITORY_URL_INVALID',
        message: '仓库 URL 格式不合法',
        details: {
          url: normalized,
        },
      });
    }
    const kind = this.normalizeRepositoryKind(repositoryKind, normalized);
    if (kind === 'oci') {
      if (parsed.protocol !== 'oci:' || !parsed.host) {
        throw new BadRequestException({
          code: 'HELM_REPOSITORY_URL_INVALID',
          message: 'OCI 仓库 URL 必须使用 oci://registry/path',
          details: {
            url: normalized,
            protocol: parsed.protocol,
          },
        });
      }
      return normalized;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException({
        code: 'HELM_REPOSITORY_URL_INVALID',
        message: 'HTTP Helm 仓库 URL 仅支持 http/https',
        details: {
          url: normalized,
          protocol: parsed.protocol,
        },
      });
    }
    return normalized;
  }

  private normalizeRepositoryOptions(
    input: HelmRepositoryCreateRequest | HelmRepositoryUpdateRequest,
    url: string,
    existing?: HelmRepositoryRecord,
  ): Pick<
    HelmRepositoryRecord,
    | 'repositoryKind'
    | 'authType'
    | 'username'
    | 'password'
    | 'caFile'
    | 'caData'
    | 'insecureSkipTlsVerify'
  > {
    const repositoryKind = this.normalizeRepositoryKind(
      input.repositoryKind ?? existing?.repositoryKind,
      url,
    );
    const authType = this.normalizeRepositoryAuthType(
      input.authType ?? existing?.authType,
    );
    const username =
      authType === 'basic'
        ? (this.normalizeOptional(input.username) ??
          this.normalizeOptional(existing?.username))
        : undefined;
    const password =
      authType === 'basic'
        ? (this.normalizeOptional(input.password) ??
          this.normalizeOptional(existing?.password))
        : undefined;
    if (authType === 'basic' && (!username || !password)) {
      throw new BadRequestException({
        code: 'HELM_REPOSITORY_AUTH_INVALID',
        message: 'Basic Auth 仓库必须提供 username 和 password',
      });
    }

    return {
      repositoryKind,
      authType,
      username,
      password,
      caFile: this.normalizeOptional(input.caFile) ?? existing?.caFile,
      caData: this.normalizeOptional(input.caData) ?? existing?.caData,
      insecureSkipTlsVerify:
        input.insecureSkipTlsVerify ?? existing?.insecureSkipTlsVerify ?? false,
    };
  }

  private normalizeRepositoryAuthType(
    value: HelmRepositoryAuthType | undefined,
  ): HelmRepositoryAuthType {
    if (!value || value === 'none') {
      return 'none';
    }
    if (value === 'basic') {
      return 'basic';
    }
    throw new BadRequestException({
      code: 'HELM_REPOSITORY_AUTH_INVALID',
      message: 'authType 仅支持 none/basic',
    });
  }

  private normalizeRepositoryKind(
    value: HelmRepositoryKind | undefined,
    url: string,
  ): HelmRepositoryKind {
    if (value === 'http' || value === 'oci') {
      return value;
    }
    return this.inferRepositoryKind(url);
  }

  private resolveRepositoryKind(
    repository: HelmRepositoryRecord,
  ): HelmRepositoryKind {
    return (
      repository.repositoryKind ?? this.inferRepositoryKind(repository.url)
    );
  }

  private inferRepositoryKind(url: string): HelmRepositoryKind {
    return url.trim().toLowerCase().startsWith('oci://') ? 'oci' : 'http';
  }

  private resolveChartReference(
    chart: string | undefined,
    repositoryName: string | undefined,
    chartName: string | undefined,
  ): string {
    const directChart = this.normalizeOptional(chart);
    if (directChart) {
      return directChart;
    }
    const repository = this.normalizeOptional(repositoryName);
    const name = this.normalizeOptional(chartName);
    if (!repository || !name) {
      throw new BadRequestException(
        'chart 或 repositoryName+chartName 至少提供一种',
      );
    }
    return `${repository}/${name}`;
  }

  private async resolveSyncTargets(
    clusterId: string,
    repositoryName?: string,
    chartRef?: string,
  ): Promise<HelmRepositoryRecord[] | undefined> {
    const normalizedRepository = this.normalizeOptional(repositoryName);
    if (normalizedRepository) {
      const matched = await this.repositoryStore.findByName(
        clusterId,
        normalizedRepository,
      );
      if (!matched) {
        throw new NotFoundException(`仓库 ${normalizedRepository} 不存在`);
      }
      return [matched];
    }

    const normalizedChart = this.normalizeOptional(chartRef);
    if (!normalizedChart || !normalizedChart.includes('/')) {
      return undefined;
    }
    const repositoryFromChart = normalizedChart.split('/')[0] ?? '';
    if (!repositoryFromChart) {
      return undefined;
    }
    const matched = await this.repositoryStore.findByName(
      clusterId,
      repositoryFromChart,
    );
    return matched ? [matched] : undefined;
  }

  private async listHelmClusters(): Promise<HelmClusterItem[]> {
    const clusters = await this.clustersService.list({
      state: 'active',
      page: '1',
      pageSize: '5000',
    });
    return clusters.items.filter((item) => item.hasKubeconfig !== false);
  }

  private sortReleaseRecords(
    records: HelmReleaseItem[],
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ): HelmReleaseItem[] {
    const order = sortOrder === 'asc' ? 1 : -1;
    const field = (sortBy ?? '').trim();
    return [...records].sort((left, right) => {
      if (field === 'name') {
        const cmp = (left.name ?? '').localeCompare(right.name ?? '');
        if (cmp !== 0) return cmp * order;
      }
      if (field === 'clusterId') {
        const cmp = (left.clusterId ?? '').localeCompare(right.clusterId ?? '');
        if (cmp !== 0) return cmp * order;
      }
      if (field === 'namespace') {
        const cmp = (left.namespace ?? '').localeCompare(right.namespace ?? '');
        if (cmp !== 0) return cmp * order;
      }
      const shouldSortByUpdated =
        field === 'updatedAt' || field === '' || field === 'createdAt';
      if (shouldSortByUpdated) {
        const leftUpdated = this.toSortableTime(left.updated);
        const rightUpdated = this.toSortableTime(right.updated);
        if (leftUpdated !== rightUpdated) {
          return (leftUpdated - rightUpdated) * order;
        }
      }
      const leftKey = `${left.clusterId ?? ''}/${left.namespace}/${left.name}`;
      const rightKey = `${right.clusterId ?? ''}/${right.namespace}/${right.name}`;
      return leftKey.localeCompare(rightKey);
    });
  }

  private sortRepositoryRecords(
    records: HelmRepositoryRecord[],
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ): HelmRepositoryRecord[] {
    const order = sortOrder === 'asc' ? 1 : -1;
    const field = (sortBy ?? '').trim();
    return [...records].sort((left, right) => {
      if (field === 'name') {
        const cmp = left.name.localeCompare(right.name);
        if (cmp !== 0) return cmp * order;
      }
      if (field === 'clusterId') {
        const cmp = left.clusterId.localeCompare(right.clusterId);
        if (cmp !== 0) return cmp * order;
      }
      const shouldSortByUpdated =
        field === 'updatedAt' || field === '' || field === 'createdAt';
      if (shouldSortByUpdated) {
        const leftTime = this.toSortableTime(left.updatedAt);
        const rightTime = this.toSortableTime(right.updatedAt);
        if (leftTime !== rightTime) {
          return (leftTime - rightTime) * order;
        }
      }
      const leftKey = `${left.clusterId}/${left.name}`;
      const rightKey = `${right.clusterId}/${right.name}`;
      return leftKey.localeCompare(rightKey);
    });
  }

  private toSortableTime(value?: string): number {
    if (!value) {
      return 0;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  private resolvePresetSelection(
    names: string[] | undefined,
  ): HelmRepositoryPresetItem[] {
    if (!names || names.length === 0) {
      return HELM_REPOSITORY_PRESETS;
    }
    const selected = new Set(
      names
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item)),
    );
    if (selected.size === 0) {
      return HELM_REPOSITORY_PRESETS;
    }
    const presets = HELM_REPOSITORY_PRESETS.filter((item) =>
      selected.has(item.name),
    );
    const unknown = Array.from(selected).filter(
      (name) => !presets.some((item) => item.name === name),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(`未知模板仓库: ${unknown.join(', ')}`);
    }
    return presets;
  }
}
