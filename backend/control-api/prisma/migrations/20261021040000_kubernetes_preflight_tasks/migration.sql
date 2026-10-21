ALTER TABLE "KubernetesUpdateTask"
  ADD COLUMN "action" TEXT NOT NULL DEFAULT 'install',
  ADD COLUMN "result" JSONB;

UPDATE "KubernetesUpdateTask"
SET "action" = "payload" ->> 'action'
WHERE "payload" ->> 'action' IN ('install', 'rollback');

CREATE INDEX "KubernetesUpdateTask_action_createdAt_idx"
  ON "KubernetesUpdateTask"("action", "createdAt");
