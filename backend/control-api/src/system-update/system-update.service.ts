import {
  BadRequestException,
  Injectable,
  Logger,
  NotImplementedException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ErrorCode } from '../common/errors/error-codes';
import type {
  SystemUpdateHistoryItem,
  SystemUpdateInstallRequest,
  SystemUpdatePostReleaseAuditRequest,
  SystemUpdateRollbackRequest,
  SystemUpdateRelease,
  SystemUpdateReleasesPayload,
  SystemUpdateStatusPayload,
} from './dto/system-update.dto';

const execFileAsync = promisify(execFile);
const AUDIT_SCRIPT = join(process.cwd(), 'tools/resource-reality-audit.mjs');
const AUDIT_REPORT_PATH = join(
  process.cwd(),
  '.run/resource-reality-audit.json',
);
const UPDATE_STATE_PATH = join(process.cwd(), '.run/system-update-state.json');
const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
const MANUAL_UPDATE_REASON =
  '此部署未接入宿主机升级执行器。请下载并校验 Release，或通过部署脚本更新同版本镜像；网页不会模拟安装、重启或回滚成功。';

type RecordOperationInput = Omit<SystemUpdateHistoryItem, 'timestamp'>;

// Running identity comes from the artifact, never from mutable updater state.
function runningBuild(): { version: string; buildType: 'release' | 'source' } {
  let version = process.env.KUBENOVA_VERSION;
  let buildType: 'release' | 'source' =
    process.env.KUBENOVA_BUILD_TYPE === 'release' ? 'release' : 'source';
  for (const file of ['../metadata.json', 'package.json']) {
    try {
      const metadata = JSON.parse(
        readFileSync(join(process.cwd(), file), 'utf8'),
      ) as { version?: string; name?: string };
      if (file === 'package.json' && metadata.name !== 'control-api') continue;
      if (file === '../metadata.json' && metadata.name !== 'kubenova') continue;
      if (!version && typeof metadata.version === 'string')
        version = metadata.version;
      if (file === '../metadata.json') buildType = 'release';
    } catch {
      /* Source checkouts have no release metadata. */
    }
  }
  return {
    version:
      version && parseVersion(version)
        ? version.startsWith('v')
          ? version
          : 'v' + version
        : 'v0.0.0-dev',
    buildType,
  };
}

@Injectable()
export class SystemUpdateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemUpdateService.name);
  private readonly build = runningBuild();
  private readonly repository =
    process.env.KUBENOVA_UPDATE_REPOSITORY ?? 'feize666/kubenova';
  private readonly history: SystemUpdateHistoryItem[] = [];
  private state = {
    runningVersion: this.build.version,
    latestVersion: this.build.version,
    postReleaseAudit: {
      enabled: existsSync(AUDIT_SCRIPT),
      strategy: 'async-after-release' as const,
      status: 'idle' as SystemUpdateStatusPayload['postReleaseAudit']['status'],
      lastRunAt: null as string | null,
      lastSummary: null as string | null,
    },
    lastOperation: null as SystemUpdateHistoryItem | null,
  };
  private timer?: ReturnType<typeof setInterval>;
  private auditPromise: Promise<void> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private latestReleaseUrl: string | null = null;
  private latestReleasePublishedAt: string | null = null;
  private releaseNotes: string | null = null;
  private lastUpdateCheckAt: string | null = null;
  private updateCheckError: string | null = null;
  private downloadUrl: string | null = null;
  private checksumUrl: string | null = null;
  private releaseReady = false;
  private updateCheckPromise: Promise<void> | null = null;
  private releasesPromise: Promise<SystemUpdateReleasesPayload> | null = null;
  private releasesCache: SystemUpdateReleasesPayload | null = null;
  private releasesCacheAt = 0;

  async onModuleInit(): Promise<void> {
    // Older updater state only changed version strings, not installed files.
    // Do not restore those versions or its unverified install/restart history.
    try {
      const parsed = JSON.parse(await readFile(UPDATE_STATE_PATH, 'utf8')) as {
        history?: SystemUpdateHistoryItem[];
      };
      if (Array.isArray(parsed.history))
        this.history.push(
          ...parsed.history
            .filter((row) => row?.operationType === 'post_release_audit')
            .slice(0, 200),
        );
    } catch {
      /* History is optional. */
    }
    void this.refreshLatestVersion();
    this.timer = setInterval(
      () => void this.refreshLatestVersion(),
      UPDATE_CHECK_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  getStatus(): SystemUpdateStatusPayload {
    if (
      !this.updateCheckPromise &&
      (!this.lastUpdateCheckAt ||
        Date.now() - Date.parse(this.lastUpdateCheckAt) >=
          UPDATE_CHECK_INTERVAL_MS)
    )
      void this.refreshLatestVersion();
    return {
      runningVersion: this.state.runningVersion,
      installedVersion: this.state.runningVersion,
      buildType: this.build.buildType,
      latestVersion: this.state.latestVersion,
      checkState: this.getCheckState(),
      releaseNotes: this.releaseNotes,
      migrationRequired: this.isMigrationRequired(),
      updateAvailable:
        this.releaseReady &&
        isNewerVersion(this.state.latestVersion, this.state.runningVersion),
      latestReleaseUrl: this.latestReleaseUrl,
      latestReleasePublishedAt: this.latestReleasePublishedAt,
      lastUpdateCheckAt: this.lastUpdateCheckAt,
      updateCheckError: this.updateCheckError,
      releaseReady: this.releaseReady,
      downloadUrl: this.downloadUrl,
      checksumUrl: this.checksumUrl,
      installStatus: 'idle',
      installable: false,
      manualUpdateReason: MANUAL_UPDATE_REASON,
      backupVersion: null,
      backupAvailable: false,
      releaseMode: 'manual',
      postReleaseAudit: { ...this.state.postReleaseAudit },
      lastOperation: this.state.lastOperation
        ? { ...this.state.lastOperation }
        : null,
      lastOperationResult: this.state.lastOperation?.result ?? null,
      timestamp: new Date().toISOString(),
    };
  }

  async checkForUpdates(): Promise<SystemUpdateStatusPayload> {
    await this.refreshLatestVersion();
    return this.getStatus();
  }

  install(body: SystemUpdateInstallRequest, _operator: string): never {
    return this.unsupportedDeployment();
  }
  restart(
    confirm: boolean | undefined,
    _operator: string,
    _message?: string,
  ): never {
    return this.unsupportedDeployment();
  }
  rollback(body: SystemUpdateRollbackRequest, _operator: string): never {
    return this.unsupportedDeployment();
  }
  private unsupportedDeployment(): never {
    throw new NotImplementedException({
      code: 'SYSTEM_UPDATE_DEPLOYMENT_REQUIRED',
      message: MANUAL_UPDATE_REASON,
    });
  }

  triggerPostReleaseAudit(
    body: SystemUpdatePostReleaseAuditRequest,
    operator: string,
  ): SystemUpdateStatusPayload {
    this.requireConfirm(body.confirm, 'post_release_audit');
    if (!this.state.postReleaseAudit.enabled)
      throw new BadRequestException('此部署未安装发布后审计脚本');
    void this.runPostReleaseAudit(this.state.runningVersion, operator);
    return this.getStatus();
  }
  getHistory() {
    return {
      items: this.history.map((item) => ({ ...item })),
      total: this.history.length,
      timestamp: new Date().toISOString(),
    };
  }

  async getReleases(): Promise<SystemUpdateReleasesPayload> {
    if (this.releasesCache && Date.now() - this.releasesCacheAt < UPDATE_CHECK_INTERVAL_MS)
      return this.releasesCache;
    if (this.releasesPromise) return this.releasesPromise;
    this.releasesPromise = this.fetchReleases();
    try {
      const result = await this.releasesPromise;
      if (!result.error) {
        this.releasesCache = result;
        this.releasesCacheAt = Date.now();
      }
      return result;
    } finally {
      this.releasesPromise = null;
    }
  }

  private requireConfirm(confirm: boolean | undefined, action: string): void {
    if (confirm !== true)
      throw new BadRequestException({
        code: ErrorCode.SYSTEM_UPDATE_CONFIRM_REQUIRED,
        message: action + ' 是高风险操作，body.confirm 必须显式为 true',
      });
  }
  private recordOperation(input: RecordOperationInput): void {
    const item = { ...input, timestamp: new Date().toISOString() };
    this.history.unshift(item);
    this.history.length = Math.min(this.history.length, 200);
    this.state.lastOperation = item;
    this.enqueuePersist();
  }
  private enqueuePersist(): void {
    this.persistQueue = this.persistQueue
      .then(async () => {
        await mkdir(join(process.cwd(), '.run'), { recursive: true });
        await writeFile(
          UPDATE_STATE_PATH,
          JSON.stringify({ history: this.history }),
          { mode: 0o600 },
        );
      })
      .catch(() => {
        this.logger.error('Cannot persist update audit history');
      });
  }

  private async refreshLatestVersion(): Promise<void> {
    if (this.updateCheckPromise) return this.updateCheckPromise;
    this.updateCheckPromise = (async () => {
      this.updateCheckError = null;
      this.releaseReady = false;
      this.releaseNotes = null;
      try {
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(this.repository))
          throw new Error('更新仓库配置无效');
        const response = await fetch(
          'https://api.github.com/repos/' +
            this.repository +
            '/releases/latest',
          {
            headers: {
              accept: 'application/vnd.github+json',
              'user-agent': 'kubenova-update-checker',
            },
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? '尚无正式 Release（标签不等于可安装版本）'
              : 'GitHub 版本检测失败：HTTP ' + response.status,
          );
        const release = (await response.json()) as {
          tag_name?: string;
          draft?: boolean;
          prerelease?: boolean;
          published_at?: string;
          name?: string;
          body?: string | null;
          assets?: Array<{
            name?: string;
            size?: number;
            state?: string;
            browser_download_url?: string;
          }>;
        };
        const tag = release.tag_name;
        if (
          typeof tag !== 'string' ||
          !/^v?\d+\.\d+(?:\.\d+)?$/.test(tag) ||
          !parseVersion(tag) ||
          release.draft !== false ||
          release.prerelease !== false
        )
          throw new Error('Release 不是有效的稳定版本');
        const assetUrl = (name: string): string | null => {
          const expected =
            'https://github.com/' +
            this.repository +
            '/releases/download/' +
            tag +
            '/' +
            name;
          const asset = release.assets?.find(
            (item) =>
              item.name === name &&
              item.browser_download_url === expected &&
              item.state === 'uploaded' &&
              (item.size ?? 0) > 0,
          );
          return asset ? expected : null;
        };
        const download = assetUrl('kubenova-ubuntu.tar.gz');
        const checksum = assetUrl('kubenova-ubuntu.tar.gz.sha256');
        if (!download || !checksum)
          throw new Error(
            'Release 缺少 Linux x64 发布包或 SHA256 校验文件，暂不可更新',
          );
        this.state.latestVersion = tag;
        this.latestReleaseUrl =
          'https://github.com/' + this.repository + '/releases/tag/' + tag;
        this.latestReleasePublishedAt = release.published_at ?? null;
        this.releaseNotes = typeof release.body === 'string' ? release.body : null;
        this.downloadUrl = download;
        this.checksumUrl = checksum;
        this.releaseReady = true;
        this.updateCheckError = null;
      } catch (error) {
        this.releaseReady = false;
        this.state.latestVersion = this.state.runningVersion;
        this.latestReleaseUrl = null;
        this.latestReleasePublishedAt = null;
        this.downloadUrl = null;
        this.checksumUrl = null;
        this.updateCheckError =
          error instanceof Error ? error.message : '更新检测失败，请稍后重试';
      } finally {
        this.lastUpdateCheckAt = new Date().toISOString();
      }
    })();
    try {
      await this.updateCheckPromise;
    } finally {
      this.updateCheckPromise = null;
    }
  }

  private getCheckState(): SystemUpdateStatusPayload['checkState'] {
    if (this.updateCheckPromise) return 'checking';
    if (this.updateCheckError) return 'error';
    if (this.isMigrationRequired()) return 'migration-required';
    if (isNewerVersion(this.state.latestVersion, this.state.runningVersion)) return 'available';
    if (isNewerVersion(this.state.runningVersion, this.state.latestVersion)) return 'ahead';
    return 'current';
  }

  private isMigrationRequired(): boolean {
    const current = parseVersion(this.state.runningVersion);
    const latest = parseVersion(this.state.latestVersion);
    return !!current && !!latest && latest[0] === 1 && latest[1] === 1 && current[0] === 1 && (current[1] === 11 || (current[1] >= 2 && current[1] <= 10));
  }

  private async fetchReleases(): Promise<SystemUpdateReleasesPayload> {
    const timestamp = new Date().toISOString();
    try {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(this.repository))
        throw new Error('更新仓库配置无效');
      const response = await fetch(
        'https://api.github.com/repos/' + this.repository + '/releases?per_page=10',
        {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'kubenova-update-checker',
          },
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('GitHub 发布历史获取失败：HTTP ' + response.status);
      const raw = (await response.json()) as unknown;
      if (!Array.isArray(raw)) throw new Error('GitHub 发布历史响应无效');
      const items = raw
        .filter((item) => item && typeof item === 'object' && (item as { draft?: boolean }).draft === false && (item as { prerelease?: boolean }).prerelease === false)
        .slice(0, 10)
        .map((item) => this.mapRelease(item as Record<string, unknown>));
      return { items, total: items.length, timestamp };
    } catch (error) {
      return {
        items: [],
        total: 0,
        timestamp,
        error: error instanceof Error ? error.message : '发布历史获取失败，请稍后重试',
      };
    }
  }

  private mapRelease(raw: Record<string, unknown>): SystemUpdateRelease {
    const tag = typeof raw.tag_name === 'string' ? raw.tag_name : '';
    const url = this.releaseUrl(tag);
    const assets = Array.isArray(raw.assets) ? raw.assets : [];
    const assetUrl = (name: string): string | null => {
      const expected = this.assetUrl(tag, name);
      const asset = assets.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const item = entry as Record<string, unknown>;
        return item.name === name && item.browser_download_url === expected && item.state === 'uploaded' && Number(item.size) > 0;
      });
      return asset ? expected : null;
    };
    const downloadUrl = /^v?\d+\.\d+(?:\.\d+)?$/.test(tag) ? assetUrl('kubenova-ubuntu.tar.gz') : null;
    const checksumUrl = /^v?\d+\.\d+(?:\.\d+)?$/.test(tag) ? assetUrl('kubenova-ubuntu.tar.gz.sha256') : null;
    return {
      tag,
      name: typeof raw.name === 'string' ? raw.name : tag,
      url,
      publishedAt: typeof raw.published_at === 'string' ? raw.published_at : null,
      notes: typeof raw.body === 'string' ? raw.body : null,
      downloadUrl,
      checksumUrl,
      releaseReady: !!downloadUrl && !!checksumUrl,
    };
  }

  private releaseUrl(tag: string): string {
    return 'https://github.com/' + this.repository + '/releases/tag/' + encodeURIComponent(tag);
  }

  private assetUrl(tag: string, name: string): string {
    return 'https://github.com/' + this.repository + '/releases/download/' + encodeURIComponent(tag) + '/' + encodeURIComponent(name);
  }

  private async runPostReleaseAudit(
    releaseVersion: string,
    operator: string,
  ): Promise<void> {
    if (this.auditPromise) {
      this.recordOperation({
        operationType: 'post_release_audit',
        targetVersion: releaseVersion,
        result: 'success',
        message: `审计任务已在运行，忽略重复触发（${releaseVersion}）`,
        operator,
      });
      this.enqueuePersist();
      return;
    }

    this.state.postReleaseAudit.status = 'running';
    this.state.postReleaseAudit.lastRunAt = new Date().toISOString();
    this.recordOperation({
      operationType: 'post_release_audit',
      targetVersion: releaseVersion,
      result: 'success',
      message: `已触发发布后审计任务（${releaseVersion}）`,
      operator,
    });
    this.enqueuePersist();

    this.auditPromise = (async () => {
      try {
        await execFileAsync('node', [AUDIT_SCRIPT], { timeout: 5 * 60 * 1000 });
        const raw = await readFile(AUDIT_REPORT_PATH, 'utf8');
        const parsed = JSON.parse(raw) as {
          summary?: { pass?: number; fail?: number };
        };
        const pass = parsed.summary?.pass ?? 0;
        const fail = parsed.summary?.fail ?? 0;
        this.state.postReleaseAudit.status = fail > 0 ? 'failed' : 'passed';
        this.state.postReleaseAudit.lastSummary = `pass=${pass}, fail=${fail}`;
        this.recordOperation({
          operationType: 'post_release_audit',
          targetVersion: releaseVersion,
          result: fail > 0 ? 'failed' : 'success',
          message: `发布后审计完成：pass=${pass}, fail=${fail}`,
          operator,
        });
        this.enqueuePersist();
      } catch (error) {
        this.state.postReleaseAudit.status = 'failed';
        this.state.postReleaseAudit.lastSummary = 'audit execution failed';
        this.recordOperation({
          operationType: 'post_release_audit',
          targetVersion: releaseVersion,
          result: 'failed',
          message:
            error instanceof Error ? error.message : '发布后审计执行失败',
          operator,
        });
        this.enqueuePersist();
      } finally {
        this.auditPromise = null;
        this.enqueuePersist();
      }
    })();

    await this.auditPromise;
  }
}

function parseVersion(value: string): number[] | null {
  const match =
    /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value,
    );
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function isNewerVersion(candidate: string, current: string): boolean {
  const left = parseVersion(candidate),
    right = parseVersion(current);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i];
  return current.includes('-') && !candidate.includes('-');
}
