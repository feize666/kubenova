ALTER TABLE "Session" ADD COLUMN "authzVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "IdentityGroup" (
  "id" TEXT PRIMARY KEY, "externalId" TEXT, "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "IdentityGroup_externalId_name_key" ON "IdentityGroup"("externalId", "name");
CREATE INDEX "IdentityGroup_active_idx" ON "IdentityGroup"("active");

CREATE TABLE "GroupMembership" (
  "id" TEXT PRIMARY KEY, "groupId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'active', "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "IdentityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GroupMembership_groupId_userId_key" ON "GroupMembership"("groupId", "userId");
CREATE INDEX "GroupMembership_userId_state_expiresAt_idx" ON "GroupMembership"("userId", "state", "expiresAt");

CREATE TABLE "AccessGrant" (
  "id" TEXT PRIMARY KEY, "userId" TEXT, "groupId" TEXT, "clusterId" TEXT NOT NULL,
  "role" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'active',
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1, "createdByUserId" TEXT NOT NULL, "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccessGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "IdentityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccessGrant_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccessGrant_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AccessGrant_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AccessGrant_exactly_one_principal" CHECK (("userId" IS NULL) <> ("groupId" IS NULL))
);
CREATE INDEX "AccessGrant_userId_state_expiresAt_idx" ON "AccessGrant"("userId", "state", "expiresAt");
CREATE INDEX "AccessGrant_groupId_state_expiresAt_idx" ON "AccessGrant"("groupId", "state", "expiresAt");
CREATE INDEX "AccessGrant_clusterId_state_expiresAt_idx" ON "AccessGrant"("clusterId", "state", "expiresAt");

CREATE TABLE "GrantNamespace" (
  "id" TEXT PRIMARY KEY, "grantId" TEXT NOT NULL, "namespaceName" TEXT NOT NULL, "namespaceUid" TEXT NOT NULL,
  CONSTRAINT "GrantNamespace_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "AccessGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GrantNamespace_grantId_namespaceUid_key" ON "GrantNamespace"("grantId", "namespaceUid");
CREATE INDEX "GrantNamespace_namespaceUid_idx" ON "GrantNamespace"("namespaceUid");

CREATE TABLE "GrantCapability" (
  "id" TEXT PRIMARY KEY, "grantId" TEXT NOT NULL, "capability" TEXT NOT NULL,
  CONSTRAINT "GrantCapability_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "AccessGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GrantCapability_grantId_capability_key" ON "GrantCapability"("grantId", "capability");

CREATE TABLE "AuthorizationChange" (
  "id" TEXT PRIMARY KEY, "actorUserId" TEXT NOT NULL, "affectedUserId" TEXT, "grantId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1, "reason" TEXT NOT NULL, "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthorizationChange_affectedUserId_fkey" FOREIGN KEY ("affectedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AuthorizationChange_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "AccessGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AuthorizationChange_affectedUserId_committedAt_idx" ON "AuthorizationChange"("affectedUserId", "committedAt");
CREATE INDEX "AuthorizationChange_grantId_committedAt_idx" ON "AuthorizationChange"("grantId", "committedAt");
