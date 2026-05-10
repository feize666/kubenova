import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
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
  SystemUpdateStatusPayload,
} from './dto/system-update.dto';

const execFileAsync = promisify(execFile);
const AUDIT_SCRIPT = join(process.cwd(), 'tools/resource-reality-audit.mjs');
const AUDIT_REPORT_PATH = join(
  process.cwd(),
  '.run/resource-reality-audit.json',
);
const UPDATE_STATE_PATH = join(process.cwd(), '.run/system-update-state.json');

interface RecordOperationInput {
  operationType: SystemUpdateHistoryItem['operationType'];
  result: SystemUpdateHistoryItem['result'];
  operator: string;
  message: string;
  targetVersion?: string;
  durationMs?: number;
}

interface PersistedUpdateState {
  state: {
    runningVersion: string;
    installedVersion: string | null;
    latestVersion: string;
    backupVersion: string | null;
    installStatus: SystemUpdateStatusPayload['installStatus'];
    backupAvailable: boolean;
    releaseMode: 'pointer-swap';
    rollbackSlaTargetMs: number;
    rollbackSlaLastMs: number | null;
    rollbackSlaMet: boolean | null;
    postReleaseAudit: SystemUpdateStatusPayload['postReleaseAudit'];
    lastOperation: SystemUpdateHistoryItem | null;
  };
  history: SystemUpdateHistoryItem[];
}

@Injectable()
export class SystemUpdateService implements OnModuleInit {
  private readonly history: SystemUpdateHistoryItem[] = [];

  private state: {
    runningVersion: string;
    installedVersion: string | null;
    latestVersion: string;
    backupVersion: string | null;
    installStatus: SystemUpdateStatusPayload['installStatus'];
    backupAvailable: boolean;
    releaseMode: 'pointer-swap';
    rollbackSlaTargetMs: number;
    rollbackSlaLastMs: number | null;
    rollbackSlaMet: boolean | null;
    postReleaseAudit: SystemUpdateStatusPayload['postReleaseAudit'];
    lastOperation: SystemUpdateHistoryItem | null;
  } = {
    runningVersion: 'v0.0.0-dev',
    installedVersion: 'v0.0.0-dev',
    latestVersion: 'v0.0.0-dev',
    backupVersion: null,
    installStatus: 'idle',
    backupAvailable: false,
    releaseMode: 'pointer-swap',
    rollbackSlaTargetMs: 3000,
    rollbackSlaLastMs: null,
    rollbackSlaMet: null,
    postReleaseAudit: {
      enabled: true,
      strategy: 'async-after-release',
      status: 'idle',
      lastRunAt: null,
      lastSummary: null,
    },
    lastOperation: null,
  };

  private auditPromise: Promise<void> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();

  async onModuleInit(): Promise<void> {
    await this.loadPersistedState();
  }

  getStatus(): SystemUpdateStatusPayload {
    return {
      runningVersion: this.state.runningVersion,
      installedVersion: this.state.installedVersion,
      latestVersion: this.state.latestVersion,
      backupVersion: this.state.backupVersion,
      installStatus: this.state.installStatus,
      installable: this.isInstallable(),
      backupAvailable: this.state.backupAvailable,
      releaseMode: this.state.releaseMode,
      rollbackSlaTargetMs: this.state.rollbackSlaTargetMs,
      rollbackSlaLastMs: this.state.rollbackSlaLastMs,
      rollbackSlaMet: this.state.rollbackSlaMet,
      postReleaseAudit: { ...this.state.postReleaseAudit },
      lastOperation: this.state.lastOperation
        ? { ...this.state.lastOperation }
        : null,
      lastOperationResult: this.state.lastOperation?.result ?? null,
      timestamp: new Date().toISOString(),
    };
  }

  install(
    body: SystemUpdateInstallRequest,
    operator: string,
  ): SystemUpdateStatusPayload {
    this.requireConfirm(body.confirm, 'install');
    if (!this.isInstallable()) {
      throw new BadRequestException({
        code: ErrorCode.SYSTEM_UPDATE_INSTALL_CONFLICT,
        message: '当前存在进行中的安装/重启/回滚任务，暂不可安装新版本',
      });
    }
    const beginAt = Date.now();

    const targetVersion = this.normalizeVersion(body.targetVersion);
    const activeVersion = this.state.runningVersion;
    this.state.installStatus = 'installing';
    this.state.latestVersion = targetVersion;
    this.state.installedVersion = targetVersion;
    this.state.installStatus =
      targetVersion === activeVersion ? 'installed' : 'installed-not-active';
    this.state.backupAvailable = Boolean(this.state.backupVersion);

    this.recordOperation({
      operationType: 'install',
      targetVersion,
      result: 'success',
      message:
        targetVersion === activeVersion
          ? `安装完成，当前运行版本已是 ${targetVersion}`
          : `安装完成，待重启激活：${activeVersion} -> ${targetVersion}`,
      operator,
      durationMs: Date.now() - beginAt,
    });
    this.enqueuePersist();
    return this.getStatus();
  }

  restart(
    confirm: boolean | undefined,
    operator: string,
    message?: string,
  ): SystemUpdateStatusPayload {
    this.requireConfirm(confirm, 'restart');
    const beginAt = Date.now();
    const previousVersion = this.state.runningVersion;
    const pendingVersion = this.state.installedVersion;

    this.state.installStatus = 'restarting';
    if (pendingVersion && pendingVersion !== previousVersion) {
      this.state.backupVersion = previousVersion;
      this.state.runningVersion = pendingVersion;
      this.state.latestVersion = pendingVersion;
    }
    this.state.installStatus = 'installed';
    this.state.backupAvailable = Boolean(this.state.backupVersion);

    this.recordOperation({
      operationType: 'restart',
      targetVersion: this.state.runningVersion,
      result: 'success',
      message: this.normalizeMessage(
        message,
        pendingVersion && pendingVersion !== previousVersion
          ? `重启完成，已激活版本 ${pendingVersion}`
          : `重启完成，运行版本保持 ${this.state.runningVersion}`,
      ),
      operator,
      durationMs: Date.now() - beginAt,
    });
    this.enqueuePersist();
    if (this.state.postReleaseAudit.enabled) {
      void this.runPostReleaseAudit(this.state.runningVersion, operator);
    }
    return this.getStatus();
  }

  rollback(
    body: SystemUpdateRollbackRequest,
    operator: string,
  ): SystemUpdateStatusPayload {
    this.requireConfirm(body.confirm, 'rollback');
    const beginAt = Date.now();

    if (!this.state.backupAvailable) {
      this.state.installStatus = 'failed';
      this.recordOperation({
        operationType: 'rollback',
        result: 'failed',
        message: '无可用备份，回滚失败',
        operator,
      });
      throw new BadRequestException({
        code: ErrorCode.SYSTEM_UPDATE_BACKUP_MISSING,
        message: '无可用备份，无法执行回滚',
      });
    }

    const targetVersion =
      this.normalizeOptionalVersion(body.targetVersion) ??
      this.state.backupVersion;
    if (!targetVersion) {
      this.state.installStatus = 'failed';
      this.recordOperation({
        operationType: 'rollback',
        result: 'failed',
        message: '无可用备份版本，回滚失败',
        operator,
      });
      throw new BadRequestException({
        code: ErrorCode.SYSTEM_UPDATE_BACKUP_MISSING,
        message: '无可用备份版本，无法执行回滚',
      });
    }

    const previousVersion = this.state.runningVersion;
    this.state.installStatus = 'rollbacking';
    this.state.runningVersion = targetVersion;
    this.state.installedVersion = targetVersion;
    this.state.backupVersion = previousVersion;
    this.state.latestVersion = targetVersion;
    this.state.installStatus = 'installed';
    this.state.backupAvailable = Boolean(this.state.backupVersion);
    const durationMs = Date.now() - beginAt;
    this.state.rollbackSlaLastMs = durationMs;
    this.state.rollbackSlaMet = durationMs <= this.state.rollbackSlaTargetMs;

    this.recordOperation({
      operationType: 'rollback',
      targetVersion,
      result: 'success',
      message: this.normalizeMessage(
        body.message,
        `回滚完成（指针切换）：${previousVersion} -> ${targetVersion}`,
      ),
      operator,
      durationMs,
    });
    this.enqueuePersist();
    return this.getStatus();
  }

  triggerPostReleaseAudit(
    body: SystemUpdatePostReleaseAuditRequest,
    operator: string,
  ): SystemUpdateStatusPayload {
    this.requireConfirm(body.confirm, 'post_release_audit');
    const releaseVersion =
      this.normalizeOptionalVersion(body.releaseVersion) ??
      this.state.runningVersion;
    void this.runPostReleaseAudit(releaseVersion, operator);
    this.enqueuePersist();
    return this.getStatus();
  }

  getHistory(): {
    items: SystemUpdateHistoryItem[];
    total: number;
    timestamp: string;
  } {
    return {
      items: this.history.map((item) => ({ ...item })),
      total: this.history.length,
      timestamp: new Date().toISOString(),
    };
  }

  private requireConfirm(
    confirm: boolean | undefined,
    action: 'install' | 'restart' | 'rollback' | 'post_release_audit',
  ): void {
    if (confirm === true) {
      return;
    }
    throw new BadRequestException({
      code: ErrorCode.SYSTEM_UPDATE_CONFIRM_REQUIRED,
      message: `${action} 是高风险操作，body.confirm 必须显式为 true`,
    });
  }

  private recordOperation(input: RecordOperationInput): void {
    const item: SystemUpdateHistoryItem = {
      operationType: input.operationType,
      ...(input.targetVersion ? { targetVersion: input.targetVersion } : {}),
      result: input.result,
      message: input.message,
      timestamp: new Date().toISOString(),
      operator: input.operator,
      ...(input.durationMs !== undefined
        ? { durationMs: input.durationMs }
        : {}),
    };

    this.history.unshift(item);
    this.state.lastOperation = item;
    if (this.history.length > 200) {
      this.history.length = 200;
    }
    this.enqueuePersist();
  }

  private normalizeVersion(raw: string | undefined): string {
    const value = raw?.trim();
    if (!value) {
      throw new BadRequestException('targetVersion 是必填参数');
    }
    return value;
  }

  private normalizeOptionalVersion(
    raw: string | undefined,
  ): string | undefined {
    const value = raw?.trim();
    return value ? value : undefined;
  }

  private normalizeMessage(raw: string | undefined, fallback: string): string {
    const value = raw?.trim();
    return value ? value : fallback;
  }

  private isInstallable(): boolean {
    return (
      this.state.installStatus !== 'installing' &&
      this.state.installStatus !== 'restarting' &&
      this.state.installStatus !== 'rollbacking'
    );
  }

  private enqueuePersist(): void {
    this.persistQueue = this.persistQueue
      .then(() => this.persistState())
      .catch(() => {
        // 持久化失败不阻塞主流程，状态以内存为准继续运行。
      });
  }

  private async persistState(): Promise<void> {
    const payload: PersistedUpdateState = {
      state: {
        runningVersion: this.state.runningVersion,
        installedVersion: this.state.installedVersion,
        latestVersion: this.state.latestVersion,
        backupVersion: this.state.backupVersion,
        installStatus: this.state.installStatus,
        backupAvailable: this.state.backupAvailable,
        releaseMode: this.state.releaseMode,
        rollbackSlaTargetMs: this.state.rollbackSlaTargetMs,
        rollbackSlaLastMs: this.state.rollbackSlaLastMs,
        rollbackSlaMet: this.state.rollbackSlaMet,
        postReleaseAudit: this.state.postReleaseAudit,
        lastOperation: this.state.lastOperation,
      },
      history: this.history,
    };
    await mkdir(join(process.cwd(), '.run'), { recursive: true });
    await writeFile(
      UPDATE_STATE_PATH,
      JSON.stringify(payload, null, 2),
      'utf8',
    );
  }

  private async loadPersistedState(): Promise<void> {
    try {
      const raw = await readFile(UPDATE_STATE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedUpdateState>;
      const savedState = parsed.state;
      if (savedState) {
        this.state.runningVersion =
          savedState.runningVersion ?? this.state.runningVersion;
        this.state.installedVersion =
          savedState.installedVersion ?? this.state.installedVersion;
        this.state.latestVersion =
          savedState.latestVersion ?? this.state.latestVersion;
        this.state.backupVersion = savedState.backupVersion ?? null;
        this.state.installStatus =
          savedState.installStatus ?? this.state.installStatus;
        this.state.backupAvailable =
          savedState.backupAvailable ?? Boolean(this.state.backupVersion);
        this.state.releaseMode = 'pointer-swap';
        this.state.rollbackSlaTargetMs =
          savedState.rollbackSlaTargetMs ?? this.state.rollbackSlaTargetMs;
        this.state.rollbackSlaLastMs = savedState.rollbackSlaLastMs ?? null;
        this.state.rollbackSlaMet = savedState.rollbackSlaMet ?? null;
        this.state.postReleaseAudit = {
          ...this.state.postReleaseAudit,
          ...(savedState.postReleaseAudit ?? {}),
        };
        this.state.lastOperation = savedState.lastOperation ?? null;
      }

      if (Array.isArray(parsed.history)) {
        this.history.length = 0;
        for (const row of parsed.history.slice(0, 200)) {
          if (
            row &&
            typeof row === 'object' &&
            typeof (row as { operationType?: unknown }).operationType ===
              'string' &&
            typeof (row as { result?: unknown }).result === 'string' &&
            typeof (row as { message?: unknown }).message === 'string' &&
            typeof (row as { timestamp?: unknown }).timestamp === 'string' &&
            typeof (row as { operator?: unknown }).operator === 'string'
          ) {
            this.history.push(row);
          }
        }
      }
    } catch {
      // 首次启动无持久化文件属正常场景。
    }
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
