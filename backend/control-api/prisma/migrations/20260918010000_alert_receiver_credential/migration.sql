CREATE TABLE "AlertReceiverCredential" (
  "clusterId" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlertReceiverCredential_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
