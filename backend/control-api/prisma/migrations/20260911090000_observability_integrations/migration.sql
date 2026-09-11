-- Persist data-source, alert rule, and notification-template contracts.
CREATE TABLE "MonitoringDataSource" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "secretRef" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonitoringDataSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitoringAlertTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "duration" TEXT NOT NULL DEFAULT '5m',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "labels" JSONB,
    "annotations" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonitoringAlertTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitoringNotificationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "secretRef" TEXT,
    "bodyTemplate" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonitoringNotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonitoringDataSource_clusterId_kind_name_key" ON "MonitoringDataSource"("clusterId", "kind", "name");
CREATE INDEX "MonitoringDataSource_clusterId_kind_idx" ON "MonitoringDataSource"("clusterId", "kind");
CREATE INDEX "MonitoringDataSource_status_idx" ON "MonitoringDataSource"("status");
CREATE INDEX "MonitoringAlertTemplate_severity_enabled_idx" ON "MonitoringAlertTemplate"("severity", "enabled");
CREATE INDEX "MonitoringNotificationTemplate_channel_enabled_idx" ON "MonitoringNotificationTemplate"("channel", "enabled");

ALTER TABLE "MonitoringDataSource" ADD CONSTRAINT "MonitoringDataSource_clusterId_fkey"
  FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
