-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterRegistry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiServer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClusterRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeSession" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "pod" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuntimeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "message" TEXT,
    "metadata" JSONB,
    "clusterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkloadRecord" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "replicas" INTEGER,
    "readyReplicas" INTEGER,
    "spec" JSONB,
    "statusJson" JSONB,
    "labels" JSONB,
    "annotations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkloadRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkResource" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "spec" JSONB,
    "statusJson" JSONB,
    "labels" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageResource" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "namespace" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "capacity" TEXT,
    "accessModes" JSONB,
    "storageClass" TEXT,
    "bindingMode" TEXT,
    "spec" JSONB,
    "statusJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigResource" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "dataKeys" JSONB,
    "currentRev" INTEGER NOT NULL DEFAULT 1,
    "labels" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigRevision" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "data" JSONB,
    "changedBy" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NamespaceRecord" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "labels" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NamespaceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringAlert" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT,
    "namespace" TEXT,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT,
    "resourceType" TEXT,
    "resourceName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'firing',
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterCredential" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "credentialType" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "keyRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClusterCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterRegistry_name_key" ON "ClusterRegistry"("name");

-- CreateIndex
CREATE INDEX "RuntimeSession_clusterId_idx" ON "RuntimeSession"("clusterId");

-- CreateIndex
CREATE INDEX "RuntimeSession_userId_idx" ON "RuntimeSession"("userId");

-- CreateIndex
CREATE INDEX "RuntimeSession_expiresAt_idx" ON "RuntimeSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_clusterId_idx" ON "AuditLog"("clusterId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "WorkloadRecord_clusterId_idx" ON "WorkloadRecord"("clusterId");

-- CreateIndex
CREATE INDEX "WorkloadRecord_namespace_idx" ON "WorkloadRecord"("namespace");

-- CreateIndex
CREATE INDEX "WorkloadRecord_kind_idx" ON "WorkloadRecord"("kind");

-- CreateIndex
CREATE INDEX "WorkloadRecord_state_idx" ON "WorkloadRecord"("state");

-- CreateIndex
CREATE UNIQUE INDEX "WorkloadRecord_clusterId_namespace_kind_name_key" ON "WorkloadRecord"("clusterId", "namespace", "kind", "name");

-- CreateIndex
CREATE INDEX "NetworkResource_clusterId_idx" ON "NetworkResource"("clusterId");

-- CreateIndex
CREATE INDEX "NetworkResource_namespace_idx" ON "NetworkResource"("namespace");

-- CreateIndex
CREATE INDEX "NetworkResource_kind_idx" ON "NetworkResource"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkResource_clusterId_namespace_kind_name_key" ON "NetworkResource"("clusterId", "namespace", "kind", "name");

-- CreateIndex
CREATE INDEX "StorageResource_clusterId_idx" ON "StorageResource"("clusterId");

-- CreateIndex
CREATE INDEX "StorageResource_kind_idx" ON "StorageResource"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "StorageResource_clusterId_kind_name_key" ON "StorageResource"("clusterId", "kind", "name");

-- CreateIndex
CREATE INDEX "ConfigResource_clusterId_idx" ON "ConfigResource"("clusterId");

-- CreateIndex
CREATE INDEX "ConfigResource_namespace_idx" ON "ConfigResource"("namespace");

-- CreateIndex
CREATE INDEX "ConfigResource_kind_idx" ON "ConfigResource"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigResource_clusterId_namespace_kind_name_key" ON "ConfigResource"("clusterId", "namespace", "kind", "name");

-- CreateIndex
CREATE INDEX "ConfigRevision_configId_idx" ON "ConfigRevision"("configId");

-- CreateIndex
CREATE INDEX "ConfigRevision_createdAt_idx" ON "ConfigRevision"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigRevision_configId_revision_key" ON "ConfigRevision"("configId", "revision");

-- CreateIndex
CREATE INDEX "NamespaceRecord_clusterId_idx" ON "NamespaceRecord"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "NamespaceRecord_clusterId_name_key" ON "NamespaceRecord"("clusterId", "name");

-- CreateIndex
CREATE INDEX "MonitoringAlert_clusterId_idx" ON "MonitoringAlert"("clusterId");

-- CreateIndex
CREATE INDEX "MonitoringAlert_severity_idx" ON "MonitoringAlert"("severity");

-- CreateIndex
CREATE INDEX "MonitoringAlert_status_idx" ON "MonitoringAlert"("status");

-- CreateIndex
CREATE INDEX "MonitoringAlert_firedAt_idx" ON "MonitoringAlert"("firedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterCredential_clusterId_key" ON "ClusterCredential"("clusterId");

-- CreateIndex
CREATE INDEX "ClusterCredential_clusterId_idx" ON "ClusterCredential"("clusterId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuntimeSession" ADD CONSTRAINT "RuntimeSession_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuntimeSession" ADD CONSTRAINT "RuntimeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkloadRecord" ADD CONSTRAINT "WorkloadRecord_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkResource" ADD CONSTRAINT "NetworkResource_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageResource" ADD CONSTRAINT "StorageResource_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigResource" ADD CONSTRAINT "ConfigResource_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigRevision" ADD CONSTRAINT "ConfigRevision_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ConfigResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NamespaceRecord" ADD CONSTRAINT "NamespaceRecord_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringAlert" ADD CONSTRAINT "MonitoringAlert_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterCredential" ADD CONSTRAINT "ClusterCredential_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
