-- DropIndex
DROP INDEX "ClusterRegistry_name_key";

-- AlterTable
ALTER TABLE "ClusterRegistry" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ClusterRegistry_name_deletedAt_idx" ON "ClusterRegistry"("name", "deletedAt");
