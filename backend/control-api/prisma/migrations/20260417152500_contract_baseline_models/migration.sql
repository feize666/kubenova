-- CreateTable
CREATE TABLE "RegistryConnector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "projectScope" TEXT,
    "authType" TEXT NOT NULL,
    "username" TEXT,
    "passwordSecretRef" TEXT,
    "verifyTls" BOOLEAN NOT NULL DEFAULT true,
    "state" TEXT NOT NULL DEFAULT 'active',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistryConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryCatalogCache" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "tag" TEXT,
    "digest" TEXT,
    "artifactType" TEXT,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistryCatalogCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiResourceCapability" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "namespaced" BOOLEAN NOT NULL,
    "verbsJson" JSONB NOT NULL,
    "lastDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiResourceCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterProfile" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "environmentType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "region" TEXT,
    "labelsJson" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistryConnector_name_key" ON "RegistryConnector"("name");

-- CreateIndex
CREATE INDEX "RegistryConnector_type_state_idx" ON "RegistryConnector"("type", "state");

-- CreateIndex
CREATE INDEX "RegistryCatalogCache_connectorId_repository_idx" ON "RegistryCatalogCache"("connectorId", "repository");

-- CreateIndex
CREATE INDEX "RegistryCatalogCache_pulledAt_idx" ON "RegistryCatalogCache"("pulledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiResourceCapability_clusterId_group_version_resource_key" ON "ApiResourceCapability"("clusterId", "group", "version", "resource");

-- CreateIndex
CREATE INDEX "ApiResourceCapability_clusterId_namespaced_idx" ON "ApiResourceCapability"("clusterId", "namespaced");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterProfile_clusterId_key" ON "ClusterProfile"("clusterId");

-- CreateIndex
CREATE INDEX "ClusterProfile_environmentType_provider_idx" ON "ClusterProfile"("environmentType", "provider");

-- AddForeignKey
ALTER TABLE "RegistryCatalogCache" ADD CONSTRAINT "RegistryCatalogCache_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "RegistryConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiResourceCapability" ADD CONSTRAINT "ApiResourceCapability_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterProfile" ADD CONSTRAINT "ClusterProfile_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
