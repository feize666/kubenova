ALTER TABLE "MonitoringAlert" ADD COLUMN "occurrenceKey" TEXT;
CREATE UNIQUE INDEX "MonitoringAlert_occurrenceKey_key" ON "MonitoringAlert"("occurrenceKey");
CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "alertId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "MonitoringAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationDelivery_alertId_templateId_event_key" ON "NotificationDelivery"("alertId", "templateId", "event");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");
