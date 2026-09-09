-- CreateTable
CREATE TABLE "ClusterRoleBinding" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clusterId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'viewer',
  "state" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClusterRoleBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClusterRoleBinding_userId_clusterId_key"
ON "ClusterRoleBinding"("userId", "clusterId");

-- CreateIndex
CREATE INDEX "ClusterRoleBinding_clusterId_state_idx"
ON "ClusterRoleBinding"("clusterId", "state");

-- CreateIndex
CREATE INDEX "ClusterRoleBinding_userId_state_idx"
ON "ClusterRoleBinding"("userId", "state");

-- AddForeignKey
ALTER TABLE "ClusterRoleBinding"
ADD CONSTRAINT "ClusterRoleBinding_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterRoleBinding"
ADD CONSTRAINT "ClusterRoleBinding_clusterId_fkey"
FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
