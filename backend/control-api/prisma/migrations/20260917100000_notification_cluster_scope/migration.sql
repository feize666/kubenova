ALTER TABLE "MonitoringNotificationTemplate" ADD COLUMN "clusterId" TEXT;

CREATE INDEX "MonitoringNotificationTemplate_clusterId_idx" ON "MonitoringNotificationTemplate"("clusterId");

ALTER TABLE "MonitoringNotificationTemplate" ADD CONSTRAINT "MonitoringNotificationTemplate_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
