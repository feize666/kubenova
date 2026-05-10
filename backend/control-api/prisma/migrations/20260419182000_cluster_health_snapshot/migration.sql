-- CreateTable
CREATE TABLE "ClusterHealthSnapshot" (
  "id" TEXT NOT NULL,
  "clusterId" TEXT NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL,
  "latencyMs" INTEGER,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" TEXT,
  "source" TEXT NOT NULL,
  "timeoutMs" INTEGER NOT NULL,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "detailJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClusterHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClusterHealthSnapshot_clusterId_key" ON "ClusterHealthSnapshot"("clusterId");

-- CreateIndex
CREATE INDEX "ClusterHealthSnapshot_status_idx" ON "ClusterHealthSnapshot"("status");

-- CreateIndex
CREATE INDEX "ClusterHealthSnapshot_checkedAt_idx" ON "ClusterHealthSnapshot"("checkedAt");

-- AddForeignKey
ALTER TABLE "ClusterHealthSnapshot" ADD CONSTRAINT "ClusterHealthSnapshot_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
