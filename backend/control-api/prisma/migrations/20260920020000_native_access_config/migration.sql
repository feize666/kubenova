CREATE TABLE "NativeAccessConfig" (
  "clusterId" TEXT NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "issuer" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "jwksUri" TEXT NOT NULL,
  "gatewayUrl" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NativeAccessConfig_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
