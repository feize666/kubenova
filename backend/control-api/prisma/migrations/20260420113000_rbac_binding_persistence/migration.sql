-- CreateTable
CREATE TABLE "RbacBinding" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "namespace" TEXT NOT NULL DEFAULT '',
  "subject" TEXT NOT NULL,
  "subjectKind" TEXT NOT NULL,
  "subjectNamespace" TEXT NOT NULL DEFAULT '',
  "state" TEXT NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RbacBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RbacBinding_kind_state_updatedAt_idx"
ON "RbacBinding"("kind", "state", "updatedAt");

-- CreateIndex
CREATE INDEX "RbacBinding_name_namespace_subject_idx"
ON "RbacBinding"("name", "namespace", "subject");
