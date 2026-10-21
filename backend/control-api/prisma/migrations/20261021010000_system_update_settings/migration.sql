CREATE TABLE "SystemUpdateSettings" (
  "id" TEXT NOT NULL,
  "encryptedData" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemUpdateSettings_pkey" PRIMARY KEY ("id")
);
