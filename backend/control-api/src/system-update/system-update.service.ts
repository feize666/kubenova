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
  SystemUpdatePreflightRequest,
  SystemUpdatePreflightPayload,
} from './dto/system-update.dto';
import { detectDeploymentMode } from './deployment-mode';
import { UpdateSettingsService } from './update-settings.service';
import { randomUUID } from 'node:crypto';
import { assertValidPreflight } from './preflight-policy';
import { Optional } from '@nestjs/common';
import { appendAudit } from '../common/governance';
import { executorConfigured, executorRequest } from './executor-request';
import { fetchKubernetesReleaseManifest } from './release-manifest';
import { KubernetesUpdateTasksService, type KubernetesUpdateTaskRecord } from './kubernetes-update-tasks.service';

const execFileAsync = promisify(execFile);
const AUDIT_SCRIPT = join(process.cwd(), 'tools/resource-reality-audit.mjs');
const AUDIT_REPORT_PATH = join(
  process.cwd(),
  '.run/resource-reality-audit.json',
);
const UPDATE_STATE_PATH = join(process.cwd(), '.run/system-update-state.json');
const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
const MANUAL_UPDATE_REASON = '未配置宿主机升级执行器。请重新运行系统安装脚本接入受保护的本机执行器与私有 socket。';
const KUBERNETES_UPDATE_REASON = '当前为 Kubernetes 部署，但专用持久化更新执行器尚未接入；在线更新保持禁用，避免绕过 GitOps 或跳过数据库演练。';
const rollbackImageDigests: Record<string, RegExp> = {
  frontend: /^ghcr\.io\/feize666\/kubenova-frontend@sha256:[a-f0-9]{64}$/i,
  controlApi: /^ghcr\.io\/feize666\/kubenova-control-api@sha256:[a-f0-9]{64}$/i,
  runtimeGateway: /^ghcr\.io\/feize666\/kubenova-runtime-gateway@sha256:[a-f0-9]{64}$/i,
};

type RecordOperationInput = Omit<SystemUpdateHistoryItem, 'timestamp'>;

interface GithubAsset {
  id?: number;
  name?: string;
  size?: number;
  state?: string;
  browser_download_url?: string;
}

interface GithubRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  name?: string;
  body?: string | null;
  assets?: GithubAsset[];
}

interface ExecutorTaskState {
  taskId: string;
  targetVersion: string;
  phase: string;
  percent: number | null;
  message: string | null;
  startedAt: string;
}

interface ExecutorTaskResponse {
  taskId?: string;
  targetVersion?: string;
  action?: 'install' | 'rollback';
  operator?: string;
  startedAt?: string;
  createdAt?: string;
  status?: 'queued' | 'running' | 'succeeded' | 'failed';
  phase?: string;
  percent?: number | null;
  message?: string | null;
}

class GithubHttpError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? 'GitHub token unauthorized'
        : status === 403
          ? 'GitHub access forbidden'
          : status === 429
            ? 'GitHub rate limit exceeded'
            : 'GitHub 请求失败：HTTP ' + status,
    );
  }
}

function isFormalStableRelease(value: unknown): value is GithubRelease {
  if (!value || typeof value !== 'object') return false;
  const release = value as GithubRelease;
  return release.draft === false && release.prerelease === false &&
    typeof release.tag_name === 'string' && /^v?\d+\.\d+(?:\.\d+)?$/.test(release.tag_name) && !!parseVersion(release.tag_name);
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)!, b = parseVersion(right)!;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

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
  constructor(
    @Optional() private readonly updateSettings?: UpdateSettingsService,
    @Optional() private readonly kubernetesTasks?: KubernetesUpdateTasksService,
  ) {}
  private readonly logger = new Logger(SystemUpdateService.name);
  private readonly build = runningBuild();
  private readonly deploymentMode = detectDeploymentMode();
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
    installStatus: 'idle' as SystemUpdateStatusPayload['installStatus'],
    installProgress: null as ExecutorTaskState | null,
    backupVersion: null as string | null,
    rollbackCandidates: [] as Array<{ version: string; backupAvailable: boolean; imageDigests?: Record<string, string> }>,
    preflight: null as SystemUpdateStatusPayload['preflight'],
  };
  private timer?: ReturnType<typeof setInterval>;
  private auditPromise: Promise<void> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private latestReleaseUrl: string | null = null;
  private latestReleasePublishedAt: string | null = null;
  private releaseNotes: string | null = null;
  private lastUpdateCheckAt: string | null = null;
  private updateCheckError: string | null = null;
  private releaseValidationMessage: string | null = null;
  private downloadUrl: string | null = null;
  private checksumUrl: string | null = null;
  private manifestUrl: string | null = null;
  private imageDigests: SystemUpdateRelease['imageDigests'] = null;
  private releaseReady = false;
  private updateCheckPromise: Promise<void> | null = null;
  private releasesPromise: Promise<SystemUpdateReleasesPayload> | null = null;
  private releasesCache: SystemUpdateReleasesPayload | null = null;
  private releasesCacheAt = 0;
  private releasesGeneration = 0;
  private executorTimer?: ReturnType<typeof setInterval>;
  private executorReady = false;
  private executorReason = MANUAL_UPDATE_REASON;
  private executorCheckAt = 0;
  private executorPromise: Promise<void> | null = null;
  private completedExecutorTask: string | null = null;
  private observedKubernetesTask: string | null = null;
  private preflightSettingsFingerprint: string | null = null;

  async onModuleInit(): Promise<void> {
    // Older updater state only changed version strings, not installed files.
    // Do not restore those versions or its unverified install/restart history.
    try {
      const parsed = JSON.parse(await readFile(UPDATE_STATE_PATH, 'utf8')) as {
        history?: SystemUpdateHistoryItem[];
        completedExecutorTask?: string;
        completedKubernetesTask?: string;
      };
      if (typeof parsed.completedExecutorTask === 'string') this.completedExecutorTask = parsed.completedExecutorTask;
      if (typeof parsed.completedKubernetesTask === 'string') this.observedKubernetesTask = parsed.completedKubernetesTask;
      if (Array.isArray(parsed.history))
        this.history.push(
          ...parsed.history
            .filter((row) => row?.operationType === 'post_release_audit' || (this.completedExecutorTask && ['install', 'rollback'].includes(row?.operationType)))
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
    if (this.canUseHostExecutor() && executorConfigured()) {
      await this.refreshExecutor();
      this.executorTimer = setInterval(() => void this.refreshExecutor(), 5_000);
      this.executorTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.executorTimer) clearInterval(this.executorTimer);
  }

  getStatus(): SystemUpdateStatusPayload {
    if (this.canUseHostExecutor() && executorConfigured() && Date.now() - this.executorCheckAt >= 5_000) void this.refreshExecutor();
    if (
      !this.updateCheckPromise &&
      (!this.lastUpdateCheckAt ||
        Date.now() - Date.parse(this.lastUpdateCheckAt) >=
          UPDATE_CHECK_INTERVAL_MS)
    )
      void this.refreshLatestVersion();
    return {
      deploymentMode: this.deploymentMode,
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
      releaseValidationMessage: this.releaseValidationMessage,
      releaseReady: this.releaseReady,
      downloadUrl: this.downloadUrl,
      checksumUrl: this.checksumUrl,
      manifestUrl: this.manifestUrl,
      imageDigests: this.imageDigests,
      installStatus: this.state.installStatus,
      installable: this.canUseHostExecutor() && this.executorReady,
      updateExecutorReady: this.canUseHostExecutor()
        ? this.executorReady
        : this.deploymentMode === 'kubernetes' && Boolean(this.kubernetesTasks),
      installReady: this.canUseHostExecutor()
        ? this.executorReady
        : this.deploymentMode === 'kubernetes' && Boolean(this.kubernetesTasks) && this.state.preflight?.status === 'passed',
      manualUpdateReason: this.deploymentMode === 'kubernetes'
        ? KUBERNETES_UPDATE_REASON
        : !executorConfigured() ? MANUAL_UPDATE_REASON : this.executorReason,
      backupVersion: this.state.backupVersion,
      rollbackCandidates: this.state.rollbackCandidates,
      backupAvailable: Boolean(this.state.backupVersion),
      releaseMode: this.canUseHostExecutor() && executorConfigured() ? 'pointer-swap' : 'manual',
      postReleaseAudit: { ...this.state.postReleaseAudit },
      lastOperation: this.state.lastOperation
        ? { ...this.state.lastOperation }
        : null,
      lastOperationResult: this.state.lastOperation?.result ?? null,
      installProgress: this.state.installProgress
        ? { ...this.state.installProgress }
        : null,
      timestamp: new Date().toISOString(),
      preflight: this.state.preflight ? { ...this.state.preflight, checks: this.state.preflight.checks.map((check) => ({ ...check })) } : null,
    };
  }

  async getStatusForApi(): Promise<SystemUpdateStatusPayload> {
    if (this.deploymentMode === 'kubernetes' && this.kubernetesTasks) {
      this.state.rollbackCandidates = [];
      this.state.backupVersion = null;
      const task = await this.kubernetesTasks.getLatest();
      if (task) {
        const phaseStatus: Record<string, SystemUpdateStatusPayload['installStatus']> = {
          initializing: 'installing', 'backing-up': 'backing-up', 'migration-test': 'verifying',
          updating: 'switching', 'health-check': 'health-check', 'rolling-back': 'rollbacking',
        };
        this.state.installStatus = task.status === 'queued' ? 'queued'
          : task.status === 'running' ? phaseStatus[task.phase] ?? 'installing'
            : task.status === 'succeeded' ? 'installed' : 'failed';
        this.state.installProgress = task.status === 'succeeded' ? null : {
          taskId: task.id, targetVersion: task.payload.targetVersion,
          phase: task.phase, percent: task.percent, message: task.message,
          startedAt: (task.startedAt ?? task.createdAt).toISOString(),
        };
        const previousImages = task.result?.previousImages;
        const previousVersion = task.result?.previousVersion;
        if (task.status === 'succeeded' && task.action !== 'preflight'
          && previousVersion && parseVersion(previousVersion)
          && previousImages && Object.entries(rollbackImageDigests).every(([component, pattern]) =>
            typeof previousImages[component] === 'string' && pattern.test(previousImages[component]),
          )) {
          this.state.backupVersion = previousVersion;
          this.state.rollbackCandidates = [{ version: previousVersion, backupAvailable: Boolean(task.backupLocation), imageDigests: previousImages }];
        }
        if (task.action !== 'preflight' && (task.status === 'succeeded' || task.status === 'failed') && this.observedKubernetesTask !== task.id) {
          this.observedKubernetesTask = task.id;
          const success = task.status === 'succeeded';
          this.recordOperation({ operationType: task.action as 'install' | 'rollback', targetVersion: task.payload.targetVersion,
            result: success ? 'success' : 'failed',
            message: task.message ?? (success ? 'Kubernetes 更新任务已完成' : 'Kubernetes 更新任务失败'),
            operator: task.payload.operator,
          });
          appendAudit({ actor: task.payload.operator, role: 'platform-admin', action: 'update', resourceType: 'system-update',
            resourceId: task.payload.targetVersion, result: success ? 'success' : 'failure', reason: task.message ?? task.payload.action });
        }
      }
      const preflightTask = await this.kubernetesTasks.getLatestPreflight();
      if (preflightTask) {
        const checks = preflightTask.result?.checks ?? preflightTask.payload.preflightChecks ?? [];
        const resultPassed = preflightTask.status === 'succeeded' && checks.length > 0 && checks.every((check) => check.status === 'passed');
        this.state.preflight = {
          id: preflightTask.payload.preflightId,
          taskId: preflightTask.id,
          status: preflightTask.status === 'queued' || preflightTask.status === 'running' ? 'running' : resultPassed ? 'passed' : 'failed',
          targetVersion: preflightTask.payload.targetVersion,
          deploymentMode: 'kubernetes',
          expiresAt: preflightTask.payload.preflightExpiresAt,
          backupTargetId: preflightTask.payload.backupTargetId,
          migrationTargetId: preflightTask.payload.migrationTargetId ?? null,
          imageDigests: preflightTask.payload.images,
          message: preflightTask.message ?? (resultPassed ? 'Kubernetes 临时数据库演练全部通过' : 'Kubernetes 临时数据库演练失败，已阻止更新'),
          checks,
        };
      }
    }
    return this.getStatus();
  }

  async checkForUpdates(): Promise<SystemUpdateStatusPayload> {
    this.invalidateReleasesCache();
    await this.refreshLatestVersion();
    if (this.canUseHostExecutor()) await this.refreshExecutor();
    else this.executorReason = KUBERNETES_UPDATE_REASON;
    return this.getStatus();
  }

  async preflight(body: SystemUpdatePreflightRequest): Promise<SystemUpdateStatusPayload> {
    const targetVersion = body.targetVersion?.trim() || this.state.latestVersion;
    const checks: SystemUpdatePreflightPayload['checks'] = [];
    const add = (name: string, status: 'passed' | 'failed' | 'skipped', message: string) => checks.push({ name, status, message });
    if (this.canUseHostExecutor()) await this.refreshExecutor();
    const executorUnavailableReason = this.deploymentMode === 'kubernetes'
      ? KUBERNETES_UPDATE_REASON
      : executorConfigured() ? this.executorReason : '当前部署未接入受保护的更新执行器';
    add(
      '更新执行器',
      this.canUseHostExecutor() && this.executorReady || this.deploymentMode === 'kubernetes' && Boolean(this.kubernetesTasks) ? 'passed' : 'failed',
      this.canUseHostExecutor() && this.executorReady
        ? this.executorReason
        : this.deploymentMode === 'kubernetes' && this.kubernetesTasks
          ? 'Kubernetes 持久化更新任务队列已接入，可执行受保护的数据库演练'
          : executorUnavailableReason,
    );
    await this.refreshLatestVersion();
    const releases = await this.getReleases();
    const release = releases.items.find((item) => item.tag === targetVersion);
    if (release?.releaseReady) add('正式发布资产', 'passed', `${targetVersion} 的下载包、校验文件和清单完整`);
    else add('正式发布资产', 'failed', release?.validationMessage ?? releases.error ?? '目标版本不是已校验的正式版本');
    let imageDigests: SystemUpdatePreflightPayload['imageDigests'] = null;
    if (this.deploymentMode === 'kubernetes') {
      try {
        if (!release?.releaseReady) throw new Error('目标版本没有完整的正式发布资产');
        imageDigests = await this.fetchKubernetesImageDigests(targetVersion);
        add('Kubernetes 镜像清单', 'passed', '发布清单版本、仓库和三个不可变镜像摘要均已核验');
      } catch (error) {
        add('Kubernetes 镜像清单', 'failed', error instanceof Error ? error.message : 'Kubernetes 镜像清单校验失败');
      }
    }
    const settings = this.updateSettings ? await this.updateSettings.get() : null;
    const executorSettings = this.updateSettings ? await this.updateSettings.getForExecutor() : null;
    const backupTargets: Array<{ id: string; name: string; configured: boolean }> = settings?.backupTargets ?? [];
    const migrationTargets: Array<{ id: string; name: string; configured: boolean }> = settings?.migrationTargets ?? [];
    this.preflightSettingsFingerprint = this.updateSettings ? await this.updateSettings.fingerprint() : null;
    const backupTarget = body.backupTargetId ? backupTargets.find((item) => item.id === body.backupTargetId) : backupTargets[0];
    const migrationTarget = body.migrationTargetId ? migrationTargets.find((item) => item.id === body.migrationTargetId) : migrationTargets[0];
    if (backupTarget?.configured) add('数据库备份目标', 'passed', `已选择 ${backupTarget.name}`);
    else add('数据库备份目标', 'failed', '请先配置并验证一个备份目标');
    if (migrationTarget?.configured) add('迁移测试目标', 'passed', `已选择 ${migrationTarget.name}`);
    else add('迁移测试目标', 'failed', '请先配置并验证一个迁移测试目标');
    if (this.deploymentMode === 'kubernetes') {
      const preflightId = randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      const preliminaryPassed = checks.every((check) => check.status === 'passed') && Boolean(release?.releaseReady && imageDigests && backupTarget && migrationTarget && executorSettings && this.kubernetesTasks);
      if (!preliminaryPassed) {
        add('Kubernetes 数据库演练', 'failed', '发布资产、镜像摘要、备份或迁移配置未就绪，未创建预检任务');
        if (this.kubernetesTasks?.invalidateLatestPreflight)
          await this.kubernetesTasks.invalidateLatestPreflight(checks, '新的 Kubernetes 预检未满足执行条件，之前的预检已失效');
        this.state.preflight = { id: preflightId, taskId: null, status: 'failed', targetVersion, deploymentMode: this.deploymentMode,
          expiresAt: null, backupTargetId: backupTarget?.id ?? null, migrationTargetId: migrationTarget?.id ?? null,
          imageDigests, message: '预检未通过，请修复失败项后重新预检', checks };
        return this.getStatus();
      }
      const task = await this.kubernetesTasks!.submit({
        action: 'preflight', targetVersion, preflightId, preflightExpiresAt: expiresAt,
        backupTargetId: backupTarget!.id, migrationTargetId: migrationTarget!.id,
        settingsFingerprint: this.preflightSettingsFingerprint!, preflightChecks: checks,
        images: imageDigests!, operator: 'system-preflight',
      });
      this.state.preflight = { id: preflightId, taskId: task.id, status: 'running', targetVersion, deploymentMode: this.deploymentMode,
        expiresAt, backupTargetId: backupTarget!.id, migrationTargetId: migrationTarget!.id,
        imageDigests, message: 'Kubernetes 数据库备份、恢复、迁移兼容和临时库清理正在执行', checks };
      return this.getStatus();
    }
    if (this.executorReady && executorSettings && backupTarget && migrationTarget) {
      const privateBackupTarget = executorSettings.backupTargets.find((item) => item.id === backupTarget.id);
      const privateMigrationTarget = executorSettings.migrationTargets.find((item) => item.id === migrationTarget.id);
      try {
        const response = await executorRequest('/v1/system-update/preflight', {
          targetVersion,
          backupTarget: privateBackupTarget,
          migrationTarget: privateMigrationTarget,
          targetRelease: release?.manifestUrl ? { manifestUrl: release.manifestUrl } : null,
        });
        if (!response.ok) throw new Error(`宿主机预检执行器拒绝请求（HTTP ${response.status}）`);
        const result = await response.json() as { status?: string; checks?: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; message: string }> };
        if (!Array.isArray(result.checks) || !['passed', 'failed'].includes(result.status ?? '')) throw new Error('宿主机预检执行器返回无效结果');
        for (const check of result.checks) add(check.name, check.status, check.message);
        if (result.status !== 'passed' && result.checks.every((check) => check.status === 'passed'))
          add('预检执行器结果', 'failed', '宿主机执行器未确认整体验证通过');
      } catch (error) {
        add('备份与磁盘预检', 'failed', error instanceof Error ? error.message : '宿主机备份预检失败');
        add('迁移副本演练', 'failed', '没有获得完整的迁移兼容与测试库清理验证结果');
      }
    } else {
      add('备份与磁盘预检', 'failed', '执行器未就绪或备份目标未配置');
      add('迁移副本演练', 'failed', '执行器未就绪或迁移测试目标未配置');
    }
    const passed = checks.every((check) => check.status === 'passed');
    this.state.preflight = {
      id: randomUUID(), status: passed ? 'passed' : 'failed', targetVersion, deploymentMode: this.deploymentMode,
      expiresAt: passed ? new Date(Date.now() + 30 * 60_000).toISOString() : null,
      backupTargetId: backupTarget?.id ?? null, migrationTargetId: migrationTarget?.id ?? null,
      imageDigests,
      message: passed ? '预检通过；正式执行时仍会再次备份并验证数据库' : '预检未通过，请修复失败项后重新预检', checks,
    };
    return this.getStatus();
  }

  private async fetchKubernetesImageDigests(targetVersion: string): Promise<NonNullable<SystemUpdatePreflightPayload['imageDigests']>> {
    const raw = await this.fetchGithub(`/releases/tags/${encodeURIComponent(targetVersion)}`) as GithubRelease;
    if (!isFormalStableRelease(raw) || raw.tag_name !== targetVersion) throw new Error('GitHub 返回的发布清单与目标版本不匹配');
    const asset = raw.assets?.find((candidate) => candidate.name === 'release-manifest.json' && candidate.state === 'uploaded' && Number(candidate.size) > 0);
    if (!asset || !Number.isSafeInteger(asset.id) || (asset.id ?? 0) <= 0) throw new Error('目标版本缺少可验证的 release-manifest.json 资产编号');
    return fetchKubernetesReleaseManifest({
      repository: this.repository,
      releaseVersion: targetVersion,
      assetId: asset.id!,
      token: process.env.KUBENOVA_UPDATE_GITHUB_TOKEN,
    });
  }

  install(body: SystemUpdateInstallRequest, operator: string): Promise<SystemUpdateStatusPayload> {
    this.requireConfirm(body.confirm, 'install');
    if (this.deploymentMode === 'kubernetes') {
      if (!this.kubernetesTasks) return this.unsupportedDeployment();
      return this.startKubernetesInstall(body, operator);
    }
    if (!this.canUseHostExecutor()) return this.unsupportedDeployment();
    if (!executorConfigured()) return this.unsupportedDeployment();
    return this.startInstall(body, operator);
  }

  async getKubernetesTask(id: string): Promise<KubernetesUpdateTaskRecord | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Kubernetes 更新任务编号无效');
    return this.kubernetesTasks?.get(id) ?? null;
  }

  async getLatestKubernetesTask(): Promise<KubernetesUpdateTaskRecord | null> {
    return this.kubernetesTasks?.getLatest() ?? null;
  }

  private async startKubernetesInstall(body: SystemUpdateInstallRequest, operator: string): Promise<SystemUpdateStatusPayload> {
    if (!this.kubernetesTasks) throw new NotImplementedException(KUBERNETES_UPDATE_REASON);
    const durablePreflight = await this.kubernetesTasks.getLatestPreflight();
    if (durablePreflight?.action === 'preflight') {
      const checks = durablePreflight.result?.checks ?? [];
      if (durablePreflight.status === 'succeeded' && checks.length > 0 && checks.every((check) => check.status === 'passed')) {
        this.preflightSettingsFingerprint = durablePreflight.payload.settingsFingerprint ?? null;
        this.state.preflight = {
          id: durablePreflight.payload.preflightId, taskId: durablePreflight.id, status: 'passed',
          targetVersion: durablePreflight.payload.targetVersion, deploymentMode: 'kubernetes',
          expiresAt: durablePreflight.payload.preflightExpiresAt, backupTargetId: durablePreflight.payload.backupTargetId,
          migrationTargetId: durablePreflight.payload.migrationTargetId ?? null, imageDigests: durablePreflight.payload.images,
          message: durablePreflight.message ?? 'Kubernetes 临时数据库演练全部通过', checks,
        };
      } else {
        this.state.preflight = {
          id: durablePreflight.payload.preflightId, taskId: durablePreflight.id,
          status: durablePreflight.status === 'queued' || durablePreflight.status === 'running' ? 'running' : 'failed',
          targetVersion: durablePreflight.payload.targetVersion, deploymentMode: 'kubernetes',
          expiresAt: durablePreflight.payload.preflightExpiresAt, backupTargetId: durablePreflight.payload.backupTargetId,
          migrationTargetId: durablePreflight.payload.migrationTargetId ?? null, imageDigests: durablePreflight.payload.images,
          message: durablePreflight.message ?? 'Kubernetes 临时数据库演练失败，已阻止更新', checks,
        };
      }
    }
    const preflight = this.state.preflight;
    const targetVersion = body.targetVersion?.trim() || preflight?.targetVersion || '';
    const settingsFingerprint = this.updateSettings ? await this.updateSettings.fingerprint() : undefined;
    try {
      const bound = preflight
        ? { ...preflight, settingsFingerprint: this.preflightSettingsFingerprint ?? undefined }
        : null;
      assertValidPreflight(bound, body.preflightId, targetVersion, Date.now(), settingsFingerprint, body.backupTargetId);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '请先重新运行预检');
    }
    if (!preflight || preflight.deploymentMode !== 'kubernetes' || preflight.status !== 'passed'
      || preflight.checks.some((check) => check.status !== 'passed') || !preflight.imageDigests) {
      throw new BadRequestException('Kubernetes 备份与迁移演练尚未全部通过，已阻止更新');
    }
    if (!this.updateSettings) throw new BadRequestException('更新设置服务未配置，无法验证备份目标');
    const selectedTarget = (await this.updateSettings.getForExecutor()).backupTargets
      .find((target) => target.id === preflight.backupTargetId);
    if (!selectedTarget) throw new BadRequestException('预检绑定的备份目标不存在，请重新运行预检');
    if (targetVersion !== preflight.targetVersion) throw new BadRequestException('目标版本与已通过的预检不一致');
    const task = await this.kubernetesTasks.submit({
      action: 'install', targetVersion,
      preflightId: preflight.id,
      preflightExpiresAt: preflight.expiresAt!,
      backupTargetId: preflight.backupTargetId!,
      settingsFingerprint: this.preflightSettingsFingerprint!,
      previousVersion: this.state.runningVersion,
      images: preflight.imageDigests,
      operator,
    });
    this.state.installStatus = 'queued';
    this.state.installProgress = {
      taskId: task.id, targetVersion, phase: task.phase, percent: task.percent,
      message: task.message, startedAt: task.createdAt.toISOString(),
    };
    this.recordOperation({ operationType: 'install', targetVersion, result: 'queued', message: 'Kubernetes 更新任务已持久化，等待专用执行器处理', operator });
    return this.getStatus();
  }

  private async startInstall(body: SystemUpdateInstallRequest, operator: string): Promise<SystemUpdateStatusPayload> {
    await this.refreshExecutor();
    if (!this.executorReady) throw new BadRequestException(this.executorReason);
    if (this.state.installStatus !== 'idle' && this.state.installStatus !== 'installed' && this.state.installStatus !== 'failed')
      throw new BadRequestException('已有升级任务正在运行，请等待完成');
    await this.refreshLatestVersion();
    if (this.updateCheckError) throw new BadRequestException('无法重新确认正式发布版本，请检查更新成功后重试');
    const targetVersion = body.targetVersion?.trim() || this.state.latestVersion;
    if (!/^v\d+\.\d+(?:\.\d+)?$/.test(targetVersion))
      throw new BadRequestException('目标版本不是稳定版本');
    // A cached catalog is suitable for browsing, never for authorizing a
    // destructive switch: assets may have been removed since it was read.
    this.invalidateReleasesCache();
    const releases = await this.getReleases();
    if (releases.error) throw new BadRequestException('无法确认目标版本资产：' + releases.error);
    const release = releases.items.find((item) => item.tag === targetVersion);
    if (!release?.releaseReady || !release.downloadUrl || !release.checksumUrl)
      throw new BadRequestException('目标版本不是已校验的正式版本');
    if (!isNewerVersion(targetVersion, this.state.runningVersion))
      throw new BadRequestException('目标版本必须高于当前运行版本');
    const settingsFingerprint = this.updateSettings ? await this.updateSettings.fingerprint() : undefined;
    try {
      const boundPreflight = this.state.preflight
        ? { ...this.state.preflight, settingsFingerprint: this.preflightSettingsFingerprint ?? undefined }
        : null;
      assertValidPreflight(boundPreflight, body.preflightId, targetVersion, Date.now(), settingsFingerprint, body.backupTargetId);
    }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '请先重新运行预检'); }
    this.downloadUrl = release.downloadUrl;
    this.checksumUrl = release.checksumUrl;
    this.manifestUrl = release.manifestUrl;
    this.imageDigests = release.imageDigests ?? null;
    const updateSettings = this.updateSettings ? await this.updateSettings.getForExecutor() : null;
    const selectedBackupTarget = updateSettings?.backupTargets.find((item) => item.id === body.backupTargetId);
    if (!selectedBackupTarget) throw new BadRequestException('预检使用的备份目标不存在，请重新运行预检');
    const task = await this.createExecutorTask('install', targetVersion, operator, release, selectedBackupTarget);
    this.state.installStatus = 'queued';
    this.state.installProgress = task;
    this.recordOperation({ operationType: 'install', targetVersion, result: 'queued', message: '升级任务已提交，等待宿主机执行器处理', operator });
    return this.getStatus();
  }
  restart(
    confirm: boolean | undefined,
    _operator: string,
    _message?: string,
  ): never {
    return this.unsupportedDeployment();
  }
  rollback(body: SystemUpdateRollbackRequest, operator: string): Promise<SystemUpdateStatusPayload> {
    this.requireConfirm(body.confirm, 'rollback');
    if (this.deploymentMode === 'kubernetes') {
      if (!this.kubernetesTasks) return Promise.reject(new NotImplementedException(KUBERNETES_UPDATE_REASON));
      return this.startKubernetesRollback(body, operator);
    }
    if (!this.canUseHostExecutor()) return this.unsupportedDeployment();
    if (!executorConfigured()) return this.unsupportedDeployment();
    return this.startRollback(body, operator);
  }

  private async startKubernetesRollback(body: SystemUpdateRollbackRequest, operator: string): Promise<SystemUpdateStatusPayload> {
    if (!this.kubernetesTasks) throw new NotImplementedException(KUBERNETES_UPDATE_REASON);
    if (this.state.installStatus !== 'idle' && this.state.installStatus !== 'installed' && this.state.installStatus !== 'failed')
      throw new BadRequestException('已有升级任务正在运行，请等待完成');
    const latest = await this.kubernetesTasks.getLatest();
    const images = latest?.result?.previousImages;
    const targetVersion = body.targetVersion?.trim() || latest?.result?.previousVersion;
    if (!latest || latest.status !== 'succeeded' || latest.action === 'preflight' || !targetVersion
      || targetVersion !== latest.result?.previousVersion || !images
      || !Object.entries(rollbackImageDigests).every(([component, pattern]) => typeof images[component] === 'string' && pattern.test(images[component])))
      throw new BadRequestException('没有通过校验的 Kubernetes 旧版镜像可回滚；最近一次更新未保存完整的不可变镜像集');
    if (!this.updateSettings) throw new BadRequestException('更新设置服务未配置，无法备份当前数据库');
    const settings = await this.updateSettings.getForExecutor();
    const settingsFingerprint = await this.updateSettings.fingerprint();
    const backupTarget = settings.backupTargets.find((item) => item.id === latest.payload.backupTargetId);
    if (!backupTarget) throw new BadRequestException('回滚任务绑定的数据库备份目标已不存在，请先修复备份设置');
    if (targetVersion !== latest.result.previousVersion) throw new BadRequestException('目标版本与持久化回滚镜像不匹配');
    const task = await this.kubernetesTasks.submit({
      action: 'rollback', targetVersion, previousVersion: this.state.runningVersion,
      rollbackTaskId: latest.id, preflightId: randomUUID(),
      preflightExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      backupTargetId: backupTarget.id, images: images as KubernetesUpdateTaskRecord['payload']['images'], operator,
      settingsFingerprint,
    });
    this.state.installStatus = 'queued';
    this.state.installProgress = { taskId: task.id, targetVersion, phase: task.phase, percent: task.percent,
      message: task.message, startedAt: task.createdAt.toISOString() };
    this.recordOperation({ operationType: 'rollback', targetVersion, result: 'queued',
      message: 'Kubernetes 回滚任务已持久化；执行前将先备份当前数据库并等待三个服务健康', operator });
    return this.getStatus();
  }

  private async startRollback(body: SystemUpdateRollbackRequest, operator: string): Promise<SystemUpdateStatusPayload> {
    await this.refreshExecutor();
    if (!this.executorReady) throw new BadRequestException(this.executorReason);
    if (!this.state.backupVersion && !this.state.rollbackCandidates.length) throw new BadRequestException('没有可用的回滚版本');
    if (this.state.installStatus !== 'idle' && this.state.installStatus !== 'installed' && this.state.installStatus !== 'failed')
      throw new BadRequestException('已有升级任务正在运行，请等待完成');
    const targetVersion = body.targetVersion?.trim() || this.state.backupVersion || this.state.rollbackCandidates[0]?.version;
    if (!targetVersion || !this.state.rollbackCandidates.some((candidate) => candidate.version === targetVersion)) throw new BadRequestException('只能回滚到已验证的回滚版本');
    const task = await this.createExecutorTask('rollback', targetVersion, operator);
    this.state.installStatus = 'rollbacking';
    this.state.installProgress = task;
    this.recordOperation({ operationType: 'rollback', targetVersion, result: 'queued', message: '回滚任务已提交，等待宿主机执行器处理', operator });
    return this.getStatus();
  }
  private unsupportedDeployment(): never {
    throw new NotImplementedException({
      code: 'SYSTEM_UPDATE_DEPLOYMENT_REQUIRED',
      message: this.deploymentMode === 'kubernetes' ? KUBERNETES_UPDATE_REASON : MANUAL_UPDATE_REASON,
    });
  }

  private canUseHostExecutor(): boolean {
    return this.deploymentMode === 'compose' || this.deploymentMode === 'systemd';
  }

  private async createExecutorTask(action: 'install' | 'rollback', targetVersion: string, operator: string, release?: SystemUpdateRelease, backupTarget?: unknown): Promise<ExecutorTaskState> {
    let response: Response;
    try {
      response = await executorRequest('/v1/system-update/tasks', {
          action,
          targetVersion,
          release: action === 'install' ? { downloadUrl: release?.downloadUrl ?? this.downloadUrl, checksumUrl: release?.checksumUrl ?? this.checksumUrl, manifestUrl: release?.manifestUrl ?? this.manifestUrl, imageDigests: release?.imageDigests ?? this.imageDigests } : undefined,
          backupTarget: action === 'install' ? backupTarget : undefined,
          operator,
      });
    } catch {
      throw new BadRequestException('宿主机升级执行器不可达');
    }
    if (!response.ok) throw new BadRequestException('宿主机升级执行器拒绝任务（HTTP ' + response.status + '）');
    let payload: ExecutorTaskResponse;
    try { payload = await response.json() as ExecutorTaskResponse; } catch { throw new BadRequestException('宿主机升级执行器返回无效响应'); }
    if (!payload.taskId) throw new BadRequestException('宿主机升级执行器未返回任务编号');
    return {
      taskId: payload.taskId,
      targetVersion,
      phase: payload.phase ?? 'queued',
      percent: payload.percent ?? 0,
      message: payload.message ?? null,
      startedAt: new Date().toISOString(),
    };
  }

  private async refreshExecutor(): Promise<void> {
    if (!this.canUseHostExecutor() || !executorConfigured()) return;
    if (this.executorPromise) return this.executorPromise;
    this.executorPromise = (async () => {
      try {
        const response = await executorRequest('/v1/system-update/status');
        if (!response.ok) throw new Error('执行器状态查询失败（HTTP ' + response.status + '）');
        const payload = await response.json() as {
          ready?: boolean;
          reason?: string;
          backupVersion?: string | null;
          rollbackCandidates?: Array<{ version: string; backupAvailable: boolean; imageDigests?: Record<string, string> }>;
          latestTask?: ExecutorTaskResponse | null;
        };
        this.executorReady = payload.ready === true;
        this.executorReason = this.executorReady
          ? '宿主机执行器已就绪，升级期间网页可能短暂断连，恢复后会继续显示进度。'
          : payload.reason || '宿主机执行器未就绪';
        this.state.backupVersion = payload.backupVersion && parseVersion(payload.backupVersion) ? payload.backupVersion : null;
        this.state.rollbackCandidates = Array.isArray(payload.rollbackCandidates) ? payload.rollbackCandidates : [];
        const task = payload.latestTask;
        if (!task?.taskId || !task.targetVersion || !parseVersion(task.targetVersion) || !['install', 'rollback'].includes(task.action ?? '')) return;
        const action = task.action!;
        const progress: ExecutorTaskState = {
          taskId: task.taskId, targetVersion: task.targetVersion, phase: task.phase ?? 'queued',
          percent: task.percent ?? null, message: task.message ?? null,
          startedAt: task.startedAt ?? task.createdAt ?? new Date().toISOString(),
        };
        this.state.installProgress = progress;
        if (task.status === 'succeeded' || task.status === 'failed') {
          const success = task.status === 'succeeded';
          this.state.installStatus = !success ? 'failed' : action === 'rollback' ? 'idle'
            : compareVersions(task.targetVersion, this.build.version) === 0 ? 'installed' : 'installed-not-active';
          if (success) this.state.installProgress = null;
          // The running version stays tied to this process's build, not a completed task.
          if (this.completedExecutorTask !== task.taskId) {
            this.completedExecutorTask = task.taskId;
            this.recordOperation({ operationType: action, targetVersion: task.targetVersion,
              result: success ? 'success' : 'failed', message: task.message ?? (success ? '执行器任务已完成' : '执行器任务失败'), operator: task.operator ?? 'system' });
            appendAudit({ actor: task.operator ?? 'system', role: 'platform-admin', action: 'update', resourceType: 'system-update', resourceId: task.targetVersion,
              result: success ? 'success' : 'failure', reason: task.message ?? action });
          }
        } else {
          const phase = task.phase ?? 'queued';
          const allowed = ['queued', 'backing-up', 'downloading', 'verifying', 'switching', 'health-check', 'rollbacking'];
          this.state.installStatus = action === 'rollback' ? 'rollbacking'
            : allowed.includes(phase) ? phase as SystemUpdateStatusPayload['installStatus'] : 'installing';
        }
      } catch {
        this.executorReady = false;
        this.executorReason = '宿主机升级执行器不可达或鉴权失败，请检查 socket 挂载、密钥及服务状态；现有任务未被取消。';
        // A transient transport error is not evidence that a host task failed.
      } finally { this.executorCheckAt = Date.now(); }
    })();
    try { await this.executorPromise; } finally { this.executorPromise = null; }
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
  async getHistoryForApi() {
    const tasks = this.kubernetesTasks ? await this.kubernetesTasks.listRecent(50) : [];
    const durable = tasks.filter((task) => task.action !== 'preflight').map((task): SystemUpdateHistoryItem => ({
      operationType: task.payload.action as 'install' | 'rollback',
      targetVersion: task.payload.targetVersion,
      result: task.status === 'succeeded' ? 'success' : task.status === 'failed' ? 'failed' : task.status === 'running' ? 'running' : 'queued',
      message: task.message ?? (task.status === 'queued' ? 'Kubernetes 更新任务已排队' : task.status === 'running' ? `Kubernetes 更新阶段：${task.phase}` : task.status === 'succeeded' ? 'Kubernetes 更新任务已完成' : 'Kubernetes 更新任务失败'),
      timestamp: (task.completedAt ?? task.startedAt ?? task.createdAt).toISOString(),
      operator: task.payload.operator,
    }));
    const taskKeys = new Set(durable.map((item) => `${item.operationType}:${item.targetVersion}:${item.operator}`));
    const memory = this.history.filter((item) => !taskKeys.has(`${item.operationType}:${item.targetVersion}:${item.operator}`));
    const items = [...durable, ...memory].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)).slice(0, 200);
    return { items, total: items.length, timestamp: new Date().toISOString() };
  }

  async getReleases(): Promise<SystemUpdateReleasesPayload> {
    if (this.releasesCache && Date.now() - this.releasesCacheAt < UPDATE_CHECK_INTERVAL_MS)
      return this.releasesCache;
    if (this.releasesPromise) return this.releasesPromise;
    const generation = this.releasesGeneration;
    const promise = this.fetchReleases();
    this.releasesPromise = promise;
    try {
      const result = await promise;
      if (!result.error && generation === this.releasesGeneration) {
        this.releasesCache = result;
        this.releasesCacheAt = Date.now();
      }
      return result;
    } finally {
      if (this.releasesPromise === promise) this.releasesPromise = null;
    }
  }

  private invalidateReleasesCache(): void {
    this.releasesGeneration += 1;
    this.releasesCache = null;
    this.releasesCacheAt = 0;
    this.releasesPromise = null;
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
          JSON.stringify({ history: this.history, completedExecutorTask: this.completedExecutorTask, completedKubernetesTask: this.observedKubernetesTask }),
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
      const hadTrustedRelease = Boolean(this.latestReleaseUrl && this.state.latestVersion);
      try {
        let release: GithubRelease;
        try {
          release = await this.fetchGithub('/releases/latest') as GithubRelease;
        } catch (error) {
          if (!(error instanceof GithubHttpError) || error.status !== 404) throw error;
          let releases: GithubRelease[];
          try {
            releases = await this.fetchGithub('/releases?per_page=100') as GithubRelease[];
          } catch (listError) {
            if (listError instanceof GithubHttpError && listError.status === 404)
              throw new Error('尚无正式 Release（标签不等于可安装版本）');
            throw listError;
          }
          const stable = releases
            .filter(isFormalStableRelease)
            .sort((left, right) => compareVersions(right.tag_name!, left.tag_name!));
          if (!stable.length) throw new Error('尚无正式 Release（标签不等于可安装版本）');
          release = stable[0];
        }
        if (!isFormalStableRelease(release))
          throw new Error('Release 不是有效的稳定版本');
        const mapped = this.mapRelease(release);
        // A formal Release is still useful information when one of its
        // install assets is missing. Keep it visible and distinguish that
        // validation warning from a GitHub/network failure.
        this.applyRelease(mapped);
      } catch (error) {
        // Keep the last verified release available for inspection during a
        // transient GitHub outage. The UI marks it degraded through the error
        // field and blocks a new install until a fresh check succeeds.
        if (!hadTrustedRelease) {
          this.releaseReady = false;
          this.state.latestVersion = this.state.runningVersion;
          this.latestReleaseUrl = null;
          this.latestReleasePublishedAt = null;
          this.releaseNotes = null;
          this.downloadUrl = null;
          this.checksumUrl = null;
          this.manifestUrl = null;
          this.imageDigests = null;
          this.releaseValidationMessage = null;
        }
        this.updateCheckError = error instanceof Error ? error.message : '更新检测失败，请稍后重试';
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

  private async fetchGithub(path: string): Promise<unknown> {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(this.repository))
      throw new Error('更新仓库配置无效');
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': 'kubenova-update-checker',
    };
    const token = process.env.KUBENOVA_UPDATE_GITHUB_TOKEN?.trim();
    if (token) headers.authorization = 'Bearer ' + token;
    let response: Response;
    try {
      response = await fetch('https://api.github.com/repos/' + this.repository + path, {
        headers,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        throw new Error('GitHub 请求超时');
      throw new Error('GitHub 网络请求失败');
    }
    if (!response.ok) throw new GithubHttpError(response.status);
    try {
      return await response.json();
    } catch {
      throw new Error('GitHub 响应无效');
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
    return !!current && !!latest && latest[0] === 1 && latest[1] === 1 && current[0] === 1 && current[1] === 11;
  }

  private async fetchReleases(): Promise<SystemUpdateReleasesPayload> {
    const timestamp = new Date().toISOString();
    try {
      const raw = await this.fetchGithub('/releases?per_page=100');
      if (!Array.isArray(raw)) throw new Error('GitHub 发布历史响应无效');
      const items = raw
        .filter(isFormalStableRelease)
        .sort((left, right) => compareVersions(right.tag_name!, left.tag_name!))
        .slice(0, 10)
        .map((item) => this.mapRelease(item));
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

  private mapRelease(raw: GithubRelease): SystemUpdateRelease {
    const tag = raw.tag_name;
    const url = this.releaseUrl(tag);
    const assetUrl = (name: string): string | null => {
      const expected = this.assetUrl(tag, name);
      const asset = raw.assets?.find((item) => {
        return item.name === name && item.browser_download_url === expected && item.state === 'uploaded' && Number(item.size) > 0;
      });
      return asset ? expected : null;
    };
    const downloadUrl = assetUrl('kubenova-ubuntu.tar.gz');
    const checksumUrl = assetUrl('kubenova-ubuntu.tar.gz.sha256');
    const manifestUrl = assetUrl('release-manifest.json');
    const validationMessage = downloadUrl && checksumUrl && manifestUrl
      ? null
      : !manifestUrl
        ? '已发现正式版本，但缺少发布清单 release-manifest.json，暂不可在线升级。'
        : '已发现正式版本，但缺少 Linux x64 发布包或 SHA256 校验文件，暂不可在线升级。';
    return {
      tag,
      name: raw.name ?? tag,
      url,
      publishedAt: raw.published_at ?? null,
      notes: raw.body ?? null,
      downloadUrl,
      checksumUrl,
      manifestUrl,
      imageDigests: null,
      validationMessage,
      releaseReady: !!downloadUrl && !!checksumUrl && !!manifestUrl,
    };
  }

  private applyRelease(release: SystemUpdateRelease): void {
    this.state.latestVersion = release.tag;
    this.latestReleaseUrl = release.url;
    this.latestReleasePublishedAt = release.publishedAt;
    this.releaseNotes = release.notes;
    this.downloadUrl = release.downloadUrl;
    this.checksumUrl = release.checksumUrl;
    this.manifestUrl = release.manifestUrl;
    this.imageDigests = release.imageDigests ?? null;
    this.releaseReady = release.releaseReady;
    this.releaseValidationMessage = release.validationMessage ?? null;
    this.updateCheckError = null;
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
