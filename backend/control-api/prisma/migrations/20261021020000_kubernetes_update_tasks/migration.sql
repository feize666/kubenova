CREATE TABLE "KubernetesUpdateTask" (
  "id" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "signature" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "phase" TEXT NOT NULL DEFAULT 'queued',
  "percent" INTEGER DEFAULT 0,
  "message" TEXT,
  "claimedBy" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "KubernetesUpdateTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KubernetesUpdateTask_status_createdAt_idx" ON "KubernetesUpdateTask"("status", "createdAt");
CREATE INDEX "KubernetesUpdateTask_leaseUntil_idx" ON "KubernetesUpdateTask"("leaseUntil");
