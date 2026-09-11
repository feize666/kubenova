CREATE TABLE "AiProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT,
    "apiKeyLast4" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "configJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiProvider_vendor_enabled_idx" ON "AiProvider"("vendor", "enabled");
CREATE INDEX "AiProvider_isDefault_idx" ON "AiProvider"("isDefault");

CREATE TABLE "AiAgentProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "toolsJson" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiAgentProfile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiAgentProfile_providerId_enabled_idx" ON "AiAgentProfile"("providerId", "enabled");
CREATE INDEX "AiAgentProfile_isDefault_idx" ON "AiAgentProfile"("isDefault");
ALTER TABLE "AiAgentProfile" ADD CONSTRAINT "AiAgentProfile_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiAnalysisRun" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "summaryJson" JSONB,
    "evidenceJson" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiAnalysisRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiAnalysisRun_clusterId_createdAt_idx" ON "AiAnalysisRun"("clusterId", "createdAt");
CREATE INDEX "AiAnalysisRun_status_idx" ON "AiAnalysisRun"("status");
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiActionApproval" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "previewJson" JSONB,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiActionApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiActionApproval_clusterId_status_idx" ON "AiActionApproval"("clusterId", "status");
CREATE INDEX "AiActionApproval_actorUserId_createdAt_idx" ON "AiActionApproval"("actorUserId", "createdAt");
