-- Additive authorization session invalidation counter.
ALTER TABLE "User" ADD COLUMN "authzVersion" INTEGER NOT NULL DEFAULT 1;
