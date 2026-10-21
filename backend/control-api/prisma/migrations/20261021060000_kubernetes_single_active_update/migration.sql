ALTER TABLE "KubernetesUpdateTask"
  ADD COLUMN "activeSlot" TEXT;

WITH active_task AS (
  SELECT "id"
  FROM "KubernetesUpdateTask"
  WHERE "status" IN ('queued', 'running')
  ORDER BY "createdAt" DESC, "id" DESC
  LIMIT 1
)
UPDATE "KubernetesUpdateTask" AS task
SET "activeSlot" = 'system-update'
FROM active_task
WHERE task."id" = active_task."id";

CREATE UNIQUE INDEX "KubernetesUpdateTask_activeSlot_key"
  ON "KubernetesUpdateTask"("activeSlot");
