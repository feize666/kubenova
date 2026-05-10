/**
 * 清空所有业务数据，只保留 admin 用户。
 * 用法: npx ts-node prisma/clear-data.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Clearing all business data (keeping admin user)...');

  await prisma.monitoringAlert.deleteMany({});
  console.log('  ✓ Monitoring alerts cleared');

  await prisma.storageResource.deleteMany({});
  console.log('  ✓ Storage resources cleared');

  await prisma.networkResource.deleteMany({});
  console.log('  ✓ Network resources cleared');

  await prisma.workloadRecord.deleteMany({});
  console.log('  ✓ Workload records cleared');

  await prisma.namespaceRecord.deleteMany({});
  console.log('  ✓ Namespace records cleared');

  await prisma.clusterRegistry.deleteMany({});
  console.log('  ✓ Cluster registry cleared');

  console.log('Done. Database is clean (admin user preserved).');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Clear failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
