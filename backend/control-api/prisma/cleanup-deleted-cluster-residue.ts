/**
 * 清理已软删除集群的历史残留数据，避免在监控/筛选/巡检中被命中。
 *
 * 用法:
 *   npx ts-node prisma/cleanup-deleted-cluster-residue.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Scanning deleted clusters (including legacy status=deleted)...');
  const deletedClusters = await prisma.clusterRegistry.findMany({
    where: {
      OR: [{ deletedAt: { not: null } }, { status: 'deleted' }],
    },
    select: { id: true, name: true },
  });

  if (deletedClusters.length === 0) {
    console.log('No deleted clusters found. Nothing to clean.');
    return;
  }

  const clusterIds = deletedClusters.map((item) => item.id);
  console.log(
    `Found ${clusterIds.length} deleted clusters: ${deletedClusters
      .map((item) => `${item.name}(${item.id})`)
      .join(', ')}`,
  );

  const backfilled = await prisma.clusterRegistry.updateMany({
    where: {
      id: { in: clusterIds },
      deletedAt: null,
      status: 'deleted',
    },
    data: { deletedAt: new Date() },
  });

  const [
    workloadUpdated,
    networkUpdated,
    configUpdated,
    storageUpdated,
    namespaceUpdated,
    alertsDeleted,
    sessionsDeleted,
    credentialsDeleted,
    auditUnlinked,
  ] = await prisma.$transaction([
    prisma.workloadRecord.updateMany({
      where: {
        clusterId: { in: clusterIds },
        state: { not: 'deleted' },
      },
      data: { state: 'deleted' },
    }),
    prisma.networkResource.updateMany({
      where: {
        clusterId: { in: clusterIds },
        state: { not: 'deleted' },
      },
      data: { state: 'deleted' },
    }),
    prisma.configResource.updateMany({
      where: {
        clusterId: { in: clusterIds },
        state: { not: 'deleted' },
      },
      data: { state: 'deleted' },
    }),
    prisma.storageResource.updateMany({
      where: {
        clusterId: { in: clusterIds },
        state: { not: 'deleted' },
      },
      data: { state: 'deleted' },
    }),
    prisma.namespaceRecord.updateMany({
      where: {
        clusterId: { in: clusterIds },
        state: { not: 'deleted' },
      },
      data: { state: 'deleted' },
    }),
    prisma.monitoringAlert.deleteMany({
      where: { clusterId: { in: clusterIds } },
    }),
    prisma.runtimeSession.deleteMany({
      where: { clusterId: { in: clusterIds } },
    }),
    prisma.clusterCredential.deleteMany({
      where: { clusterId: { in: clusterIds } },
    }),
    prisma.auditLog.updateMany({
      where: { clusterId: { in: clusterIds } },
      data: { clusterId: null },
    }),
  ]);

  console.log('Cleanup complete:');
  console.log(`  cluster  -> backfill deletedAt: ${backfilled.count}`);
  console.log(`  workload -> deleted: ${workloadUpdated.count}`);
  console.log(`  network  -> deleted: ${networkUpdated.count}`);
  console.log(`  config   -> deleted: ${configUpdated.count}`);
  console.log(`  storage  -> deleted: ${storageUpdated.count}`);
  console.log(`  namespace-> deleted: ${namespaceUpdated.count}`);
  console.log(`  alerts   -> removed: ${alertsDeleted.count}`);
  console.log(`  sessions -> removed: ${sessionsDeleted.count}`);
  console.log(`  cred     -> removed: ${credentialsDeleted.count}`);
  console.log(`  audit    -> unlinked: ${auditUnlinked.count}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Cleanup failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
