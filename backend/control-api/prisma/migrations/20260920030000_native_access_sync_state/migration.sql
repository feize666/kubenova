ALTER TABLE "NativeAccessConfig"
  ADD COLUMN "syncState" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "syncRevision" INTEGER,
  ADD COLUMN "syncMessage" TEXT,
  ADD COLUMN "syncedAt" TIMESTAMP(3);
