#!/usr/bin/env node
import { hostname } from 'node:os';
import { PrismaService } from '../platform/database/prisma.service';
import { KubernetesUpdateTasksService, type KubernetesUpdateTaskRecord } from './kubernetes-update-tasks.service';
import { createInClusterKubernetesUpdateAdapter, type KubernetesUpdateAdapter } from './kubernetes-update.adapter';
import { KubernetesDatabaseBackupService } from './kubernetes-database-backup.service';
import { UpdateSettingsService } from './update-settings.service';
import { KubernetesMigrationDatabaseService } from './kubernetes-migration-database.service';
import { KubernetesMigrationJobAdapter, createInClusterKubernetesMigrationJobAdapter } from './kubernetes-migration-job.adapter';
import { KubernetesMigrationRehearsalService, type KubernetesMigrationRehearsalCheck } from './kubernetes-migration-rehearsal.service';

const POLL_INTERVAL_MS = 3_000;
const LEASE_RENEW_INTERVAL_MS = 10_000;
const workerId = `kubenova-update-${process.env.POD_NAME?.trim() || hostname()}`.slice(0, 128);
let stopping = false;

export class KubernetesUpdateWorker {
  constructor(
    private readonly tasks: Pick<KubernetesUpdateTasksService, 'claimNext' | 'heartbeat' | 'finish' | 'recordBackup'>,
    private readonly adapter: Pick<KubernetesUpdateAdapter, 'apply'>,
    private readonly backups: Pick<KubernetesDatabaseBackupService, 'createBackup'> & Partial<Pick<KubernetesDatabaseBackupService, 'withBackupFile'>>,
    private readonly getBackupSettings: () => Promise<{
      backupTargets: Array<{ id: string; name: string; type: 'local' | 's3'; location: string; secret?: Record<string, string> }>;
      migrationTargets?: Array<{ id: string; name: string; type: 'local' | 'external'; connection?: string }>;
      fingerprint?: string;
    }>,
    private readonly databaseUrl: string,
    private readonly id: string,
    private readonly migrationDatabase?: Pick<KubernetesMigrationDatabaseService, 'createTemporaryDatabase' | 'restoreBackup' | 'dropTemporaryDatabase'>,
    private readonly migrationJobs?: Pick<KubernetesMigrationJobAdapter, 'runTargetMigrations' | 'checkPreviousVersionCompatibility'>,
  ) {}

  async runOnce(): Promise<boolean> {
    const task = await this.tasks.claimNext(this.id);
    if (!task) return false;
    await this.runTask(task);
    return true;
  }

  private async runTask(task: KubernetesUpdateTaskRecord): Promise<void> {
    let phase = 'initializing';
    let percent = 5;
    let message = `正在执行 ${task.payload.action} ${task.payload.targetVersion}`;
    let leaseError: unknown = null;
    let renewal: Promise<void> | null = null;
    const timer = setInterval(() => {
      if (renewal || leaseError) return;
      renewal = this.tasks.heartbeat(task.id, this.id, phase, percent, message)
        .catch((error) => { leaseError = error; })
        .finally(() => { renewal = null; });
    }, LEASE_RENEW_INTERVAL_MS);
    timer.unref?.();
    const assertLease = () => {
      if (leaseError) throw new Error(`Kubernetes update worker lease renewal failed: ${leaseError instanceof Error ? leaseError.message : 'unknown error'}`);
    };
    const verifyLease = async () => {
      await renewal;
      assertLease();
    };
    const reportProgress = async (nextPhase: string, nextPercent: number, nextMessage: string) => {
      assertLease();
      phase = nextPhase;
      percent = nextPercent;
      message = nextMessage;
      await this.tasks.heartbeat(task.id, this.id, phase, percent, message);
      assertLease();
    };
    try {
      await reportProgress('updating', 5, `正在执行 ${task.payload.action} ${task.payload.targetVersion}`);
      await reportProgress('backing-up', 8, '正在备份 PostgreSQL');
      const settings = await this.getBackupSettings();
      if (task.payload.settingsFingerprint && settings.fingerprint !== task.payload.settingsFingerprint)
        throw new Error('更新设置在任务排队后已变化，任务已阻止执行');
      const target = settings.backupTargets.find((candidate) => candidate.id === task.payload.backupTargetId);
      if (!target) throw new Error('绑定的 Kubernetes 数据库备份目标不存在');
      const backup = await this.backups.createBackup({ databaseUrl: this.databaseUrl, target, taskId: task.id });
      await verifyLease();
      await this.tasks.recordBackup(task.id, this.id, backup.location, backup.bytes);
      await reportProgress('updating', 25, `数据库备份完成（${backup.bytes} 字节）`);
      if (task.payload.action === 'preflight') {
        const migrationTarget = settings.migrationTargets?.find((candidate) => candidate.id === task.payload.migrationTargetId);
        const migrationConnection = migrationTarget?.connection || (migrationTarget?.type === 'local' ? this.databaseUrl : '');
        if (!migrationConnection || !this.migrationDatabase || !this.migrationJobs || !this.backups.withBackupFile)
          throw new Error('Kubernetes temporary-database migration rehearsal is not fully configured');
        await reportProgress('migration-test', 35, '正在恢复临时数据库并运行目标版本迁移');
        const rehearsalChecks: KubernetesMigrationRehearsalCheck[] = [...(task.payload.preflightChecks ?? [])];
        const rehearsal = await this.backups.withBackupFile({ location: backup.location, target }, async (backupFile) => {
          const service = new KubernetesMigrationRehearsalService({
            createTemporaryDatabase: () => this.migrationDatabase!.createTemporaryDatabase(migrationConnection),
            restoreBackup: (database) => this.migrationDatabase!.restoreBackup(database, backupFile),
            runTargetMigrations: (_database, _version, image) => this.migrationJobs!.runTargetMigrations(image, _database.connectionString!),
            checkPreviousVersionCompatibility: (_database) => this.migrationJobs!.checkPreviousVersionCompatibility(_database.connectionString),
            dropTemporaryDatabase: (database) => this.migrationDatabase!.dropTemporaryDatabase(database),
          });
          return service.run({ backupLocation: backupFile, targetVersion: task.payload.targetVersion,
            targetImage: task.payload.images.controlApi, previousImage: task.payload.images.controlApi });
        });
        rehearsalChecks.push({ name: '数据库备份', status: 'passed', message: `已创建备份（${backup.bytes} 字节）` }, ...rehearsal.checks);
        await verifyLease();
        if (rehearsal.status !== 'passed') {
          await this.tasks.finish(task.id, this.id, 'failed', 'failed', null, 'Kubernetes 临时数据库迁移兼容演练未全部通过，已阻止更新', { checks: rehearsalChecks });
          return;
        }
        await this.tasks.finish(task.id, this.id, 'succeeded', 'completed', 100, 'Kubernetes 备份恢复、目标迁移、旧版本兼容和临时库清理均已通过', { checks: rehearsalChecks });
        return;
      }
      const applied = await this.adapter.apply(task.payload.images, (phase, percent, message) => reportProgress(phase, percent, message));
      await verifyLease();
      const rollbackState = applied?.previousImages && task.payload.previousVersion
        ? { previousImages: applied.previousImages, previousVersion: task.payload.previousVersion }
        : undefined;
      await this.tasks.finish(task.id, this.id, 'succeeded', 'completed', 100, `${task.payload.targetVersion} 已完成滚动更新`, rollbackState);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kubernetes 更新任务失败';
      const phase = /rollback was incomplete/i.test(message) ? 'rollback-incomplete' : 'failed';
      const failureResult = task.payload.action === 'preflight'
        ? { checks: [
          ...(task.payload.preflightChecks ?? []),
          { name: phase === 'rollback-incomplete' ? '恢复状态' : 'Kubernetes 数据库演练', status: 'failed' as const, message },
        ] }
        : undefined;
      await this.tasks.finish(task.id, this.id, 'failed', phase, null, message, failureResult).catch((finishError) => {
        process.stderr.write(`Unable to record Kubernetes update failure: ${finishError instanceof Error ? finishError.message : 'unknown error'}\n`);
      });
    } finally {
      clearInterval(timer);
      await renewal;
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const database = new PrismaService();
  try {
    const tasks = new KubernetesUpdateTasksService(database);
    const settings = new UpdateSettingsService(database);
    const adapter = await createInClusterKubernetesUpdateAdapter();
      const migrationJobs = await createInClusterKubernetesMigrationJobAdapter();
    const backupRoot = process.env.KUBENOVA_K8S_UPDATE_BACKUP_ROOT?.trim() || '/var/lib/kubenova/update-backups';
    const backups = new KubernetesDatabaseBackupService(undefined, backupRoot);
    const migrationDatabase = new KubernetesMigrationDatabaseService();
    const worker = new KubernetesUpdateWorker(tasks, adapter, backups, async () => ({ ...(await settings.getForExecutor()), fingerprint: await settings.fingerprint() }), process.env.DATABASE_URL ?? '', workerId, migrationDatabase, migrationJobs);
    process.stdout.write(`Kubernetes update worker ${workerId} started\n`);
    while (!stopping) {
      try {
        if (!await worker.runOnce()) await wait(POLL_INTERVAL_MS);
      } catch (error) {
        process.stderr.write(`Kubernetes update worker poll failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
        await wait(POLL_INTERVAL_MS);
      }
    }
  } finally {
    await database.$disconnect();
  }
}

process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });

if (require.main === module) {
  void run().catch((error) => {
    process.stderr.write(`Kubernetes update worker failed to start: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
