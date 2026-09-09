-- Keep access-token and refresh-token lifetimes independent.
ALTER TABLE "Session" ADD COLUMN "refreshExpiresAt" TIMESTAMP(3);

-- Preserve existing sessions without extending their original access lifetime
-- indefinitely. Existing sessions receive the configured default seven-day
-- refresh window relative to their original expiry.
UPDATE "Session"
SET "refreshExpiresAt" = "expiresAt" + INTERVAL '7 days'
WHERE "refreshExpiresAt" IS NULL;

ALTER TABLE "Session" ALTER COLUMN "refreshExpiresAt" SET NOT NULL;

CREATE INDEX "Session_refreshExpiresAt_idx" ON "Session"("refreshExpiresAt");
