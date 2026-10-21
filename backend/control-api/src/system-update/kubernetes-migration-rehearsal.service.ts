export type KubernetesMigrationRehearsalCheck = {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  message: string;
};

export type KubernetesTemporaryDatabase = {
  name: string;
  connectionString: string;
};

export type KubernetesMigrationRehearsalInput = {
  backupLocation: string;
  targetVersion: string;
  targetImage: string;
  previousImage: string;
};

export type KubernetesMigrationRehearsalAdapters = {
  createTemporaryDatabase: () => Promise<KubernetesTemporaryDatabase>;
  restoreBackup: (database: KubernetesTemporaryDatabase, backupLocation: string) => Promise<void>;
  runTargetMigrations: (database: KubernetesTemporaryDatabase, targetVersion: string, targetImage: string) => Promise<void>;
  checkPreviousVersionCompatibility: (database: KubernetesTemporaryDatabase, previousImage: string) => Promise<void>;
  dropTemporaryDatabase: (database: KubernetesTemporaryDatabase) => Promise<void>;
};

export class KubernetesMigrationRehearsalService {
  constructor(private readonly adapters: KubernetesMigrationRehearsalAdapters) {}

  async run(input: KubernetesMigrationRehearsalInput): Promise<{ status: 'passed' | 'failed'; checks: KubernetesMigrationRehearsalCheck[] }> {
    const checks: KubernetesMigrationRehearsalCheck[] = [];
    let database: KubernetesTemporaryDatabase | null = null;
    let created = false;
    let restored = false;
    let migrated = false;
    let compatible = false;

    try {
      database = await this.adapters.createTemporaryDatabase();
      if (!database?.name || !database.connectionString) throw new Error('temporary database handle is incomplete');
      created = true;
      checks.push({ name: '临时测试库', status: 'passed', message: '已创建隔离的临时 PostgreSQL 数据库' });
    } catch (error) {
      const possibleDatabase = error && typeof error === 'object'
        ? (error as { databaseHandle?: KubernetesTemporaryDatabase }).databaseHandle
        : undefined;
      if (possibleDatabase?.name && possibleDatabase.connectionString) database = possibleDatabase;
      checks.push({ name: '临时测试库', status: 'failed', message: '无法创建隔离的临时 PostgreSQL 数据库' });
    }

    if (database && created) {
      try {
        await this.adapters.restoreBackup(database, input.backupLocation);
        restored = true;
        checks.push({ name: '备份恢复', status: 'passed', message: '已将完整数据库备份恢复到临时测试库' });
      } catch {
        checks.push({ name: '备份恢复', status: 'failed', message: '无法将数据库备份恢复到临时测试库' });
      }
    } else checks.push({ name: '备份恢复', status: 'skipped', message: '临时测试库未成功创建' });

    if (database && restored) {
      try {
        await this.adapters.runTargetMigrations(database, input.targetVersion, input.targetImage);
        migrated = true;
        checks.push({ name: '目标版本迁移', status: 'passed', message: '目标版本镜像已完成数据库迁移' });
      } catch {
        checks.push({ name: '目标版本迁移', status: 'failed', message: '目标版本镜像数据库迁移失败' });
      }
      if (migrated) {
        try {
          await this.adapters.checkPreviousVersionCompatibility(database, input.previousImage);
          compatible = true;
          checks.push({ name: '旧版本兼容', status: 'passed', message: '当前运行版本已通过迁移后兼容性检查' });
        } catch {
          checks.push({ name: '旧版本兼容', status: 'failed', message: '当前运行版本无法通过迁移后兼容性检查' });
        }
      } else checks.push({ name: '旧版本兼容', status: 'skipped', message: '目标版本迁移未通过' });
    } else {
      checks.push({ name: '目标版本迁移', status: 'skipped', message: '备份未成功恢复' });
      checks.push({ name: '旧版本兼容', status: 'skipped', message: '备份未成功恢复' });
    }

    let cleanupPassed = false;
    if (database) {
      try {
        await this.adapters.dropTemporaryDatabase(database);
        cleanupPassed = true;
        checks.push({ name: '临时测试库清理', status: 'passed', message: '临时 PostgreSQL 数据库已删除' });
      } catch {
        checks.push({ name: '临时测试库清理', status: 'failed', message: '临时 PostgreSQL 数据库未能删除，已阻止更新' });
      }
    } else {
      checks.push({ name: '临时测试库清理', status: 'failed', message: '无法确认创建失败时的临时数据库状态，已阻止更新' });
    }

    return {
      status: created && restored && migrated && compatible && cleanupPassed && checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
      checks,
    };
  }
}
