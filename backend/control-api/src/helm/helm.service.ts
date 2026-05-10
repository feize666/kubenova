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
  HelmRepositoryImportPresetsRequest,
  HelmRepositoryQuery,
  HelmRepositoryUpdateRequest,
  HelmRollbackRequest,
  HelmUninstallRequest,
  HelmUpgradeRequest,
} from './dto/helm.dto';
import {
  type HelmRepositoryRecord,
  HelmRepositoryStore,
} from './helm-repository.store';

const execFileAsync = promisify(execFile);

interface HelmReleaseItem {
  name: string;
  namespace: string;
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
  authType: 'none';
  syncStatus: 'saved' | 'validated' | 'syncing' | 'synced' | 'failed';
  lastSyncAt?: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
}

interface HelmRepositoryListPayload {
  items: HelmRepositoryItem[];
  total: number;
  timestamp: string;
}

interface HelmCliRepositoryItem {
  name: string;
  url: string;
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

  async listRepositoryPresets(): Promise<HelmRepositoryPresetListPayload> {
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

  async listRepositories(
    query: HelmRepositoryQuery,
  ): Promise<HelmRepositoryListPayload> {
    const clusterId = this.requireNonEmpty(query.clusterId, 'clusterId');
    const records = await this.mergeRepositoryInventory(clusterId);
    return {
      items: records.map((item) => this.toRepositoryItem(item)),
      total: records.length,
      timestamp: new Date().toISOString(),
    };
  }

  async createRepository(
    body: HelmRepositoryCreateRequest,
  ): Promise<HelmRepositoryMutationPayload> {
    const clusterId = this.requireNonEmpty(body.clusterId, 'clusterId');
    const name = this.requireNonEmpty(body.name, 'name');
    const url = this.normalizeRepositoryUrl(body.url);
    await this.ensureClusterExists(clusterId);

    const existing = await this.repositoryStore.findByName(clusterId, name);
    if (existing) {
      throw new BadRequestException({
        code: 'HELM_REPOSITORY_DUPLICATE',
        message: `仓库 ${name} 已存在`,
      });
    }

    const now = new Date().toISOString();
    const record: HelmRepositoryRecord = {
      clusterId,
      name,
      url,
      authType: 'none',
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
          strict: true,
        });
      });
    } catch (error) {
      throw this.toRepositorySyncException(error, name);
    }

    const latest = await this.repositoryStore.findByName(clusterId, name);
    return {
      item: latest ? this.toRepositoryItem(latest) : undefined,
      clusterId,
      message: '仓库已创建并同步成功',
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
      ? this.normalizeRepositoryUrl(body.url)
      : existing.url;
    const next: HelmRepositoryRecord = {
      ...existing,
      url: nextUrl,
      authType: 'none',
      username: undefined,
      password: undefined,
      syncStatus: 'syncing',
      message: '正在验证仓库连通性',
      updatedAt: new Date().toISOString(),
    };
    await this.repositoryStore.save(next);

    try {
      await this.withKubeconfig(clusterId, async (ctx) => {
        await this.syncRepositoriesForContext(ctx, {
          only: [next],
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
      message: '仓库已更新并同步成功',
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
    const clusterId = this.requireNonEmpty(query.clusterId, 'clusterId');
    const namespace = this.normalizeOptional(query.namespace);
    const keyword = this.normalizeOptional(query.keyword)?.toLowerCase();
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 20);

    const releases = await this.withKubeconfig(clusterId, (ctx) =>
      this.fetchReleases(ctx, namespace),
    );

    const filtered = keyword
      ? releases.filter((item) => {
          const name = (item.name || '').toLowerCase();
          const chart = (item.chart || '').toLowerCase();
          return name.includes(keyword) || chart.includes(keyword);
        })
      : releases;

    const total = filtered.length;
    const start = (page - 1) * pageSize;

    return {
      items: filtered.slice(start, start + pageSize),
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
      };

      if (err.code === 'ENOENT') {
        throw new ServiceUnavailableException({
          code: 'HELM_CLI_NOT_FOUND',
          message: 'helm CLI 不可用，请先在 control-api 运行环境安装 helm',
        });
      }

      throw new BadRequestException({
        code: 'HELM_COMMAND_FAILED',
        message: `helm 命令执行失败: helm ${args.join(' ')}`,
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

    const failed: string[] = [];
    for (const repository of records) {
      const syncing: HelmRepositoryRecord = {
        ...repository,
        syncStatus: 'syncing',
        message: '正在同步仓库索引',
        updatedAt: new Date().toISOString(),
      };
      await this.repositoryStore.save(syncing);

      try {
        await this.validateRepositoryUrl(repository.url);
        await this.repositoryStore.save({
          ...repository,
          syncStatus: 'validated',
          message: '仓库地址校验通过，准备同步 Helm 索引',
          updatedAt: new Date().toISOString(),
        });

        await this.runHelm(
          ['repo', 'add', repository.name, repository.url, '--force-update'],
          ctx,
        );
        await this.runHelm(['repo', 'update', repository.name], ctx);

        await this.repositoryStore.save({
          ...repository,
          syncStatus: 'synced',
          message: '仓库同步成功',
          lastSyncAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        failed.push(repository.name);
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
        code: 'HELM_REPO_SYNC_FAILED',
        message: `Helm 仓库同步失败: ${failed.join(', ')}`,
      });
    }
  }

  private async mergeRepositoryInventory(
    clusterId: string,
  ): Promise<HelmRepositoryRecord[]> {
    const storedRecords = await this.repositoryStore.list(clusterId);
    const cliRecords = await this.readHostRepositoryInventory();
    if (cliRecords.length === 0) {
      return storedRecords;
    }

    const merged = new Map<string, HelmRepositoryRecord>();
    for (const record of storedRecords) {
      merged.set(record.name, record);
    }

    const now = new Date().toISOString();
    for (const item of cliRecords) {
      const existing = merged.get(item.name);
      const next: HelmRepositoryRecord = {
        clusterId,
        name: item.name,
        url: item.url,
        authType: existing?.authType ?? 'none',
        username: existing?.username,
        password: existing?.password,
        syncStatus: existing?.syncStatus ?? 'synced',
        lastSyncAt: existing?.lastSyncAt ?? now,
        message: existing?.message ?? '来源于 helm repo list',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      merged.set(item.name, next);
    }

    const mergedRecords = Array.from(merged.values());
    await Promise.all(
      mergedRecords.map((record) => this.repositoryStore.save(record)),
    );
    return mergedRecords;
  }

  private async readHostRepositoryInventory(): Promise<
    HelmCliRepositoryItem[]
  > {
    const fileRecords = await this.readHelmRepositoryConfigInventory();
    if (fileRecords.length > 0) {
      return fileRecords;
    }

    const outputs = [
      { args: ['repo', 'list', '--output', 'json'] as const, parseJson: true },
      { args: ['repo', 'list'] as const, parseJson: false },
    ] as const;

    for (const outputSpec of outputs) {
      try {
        const output = await execFileAsync('helm', [...outputSpec.args], {
          maxBuffer: 2 * 1024 * 1024,
        });
        const text = (output.stdout ?? '').trim();
        if (!text) {
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
          return rows
            .map((item) => {
              const row = this.isRecord(item) ? item : {};
              return {
                name: this.asString(row.name).trim(),
                url: this.asString(row.url).trim(),
              };
            })
            .filter(
              (item): item is HelmCliRepositoryItem =>
                Boolean(item.name) && Boolean(item.url),
            );
        }
      } catch {
        continue;
      }
    }

    return [];
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
      }))
      .filter(
        (item): item is HelmCliRepositoryItem =>
          Boolean(item.name) && Boolean(item.url),
      );
  }

  private async readHelmRepositoryConfigInventory(): Promise<
    HelmCliRepositoryItem[]
  > {
    const candidates = this.getHelmRepositoryConfigCandidates();
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
            return {
              name: this.asString(row.name).trim(),
              url: this.asString(row.url).trim(),
            };
          })
          .filter(
            (item): item is HelmCliRepositoryItem =>
              Boolean(item.name) && Boolean(item.url),
          );

        if (records.length > 0) {
          return records;
        }
      } catch {
        continue;
      }
    }

    return [];
  }

  private getHelmRepositoryConfigCandidates(): string[] {
    const candidates = new Set<string>();
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

    return Array.from(candidates);
  }

  private async validateRepositoryUrl(url: string): Promise<void> {
    const normalized = this.requireNonEmpty(url, 'repository url').replace(
      /\/+$/,
      '',
    );
    const endpoint = normalized.endsWith('index.yaml')
      ? normalized
      : `${normalized}/index.yaml`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/x-yaml, text/yaml, text/plain, */*',
        },
      });
      if (!response.ok) {
        throw new BadRequestException({
          code: 'HELM_REPOSITORY_VALIDATE_FAILED',
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
          code: 'HELM_REPOSITORY_VALIDATE_FAILED',
          message: '仓库 index.yaml 格式无效',
        });
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadRequestException({
          code: 'HELM_REPOSITORY_VALIDATE_FAILED',
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
    return {
      clusterId: source.clusterId,
      name: source.name,
      url: source.url,
      authType: 'none',
      syncStatus: normalizedStatus,
      lastSyncAt: source.lastSyncAt,
      message: source.message,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
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

  private toRepositorySyncException(
    error: unknown,
    repositoryName: string,
  ): BadRequestException {
    return new BadRequestException({
      code: 'HELM_REPOSITORY_VALIDATE_FAILED',
      message: `仓库 ${repositoryName} 同步失败`,
      details: {
        reason: this.extractErrorMessage(error),
        retryable: true,
        suggestion: '请检查 URL 连通性和仓库索引，再重试同步',
      },
    });
  }

  private normalizeRepositoryUrl(url: string | undefined): string {
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
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException({
        code: 'HELM_REPOSITORY_URL_INVALID',
        message: '仓库 URL 仅支持 http/https',
        details: {
          url: normalized,
          protocol: parsed.protocol,
        },
      });
    }
    return normalized;
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
