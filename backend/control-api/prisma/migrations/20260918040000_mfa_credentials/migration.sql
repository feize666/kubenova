CREATE TABLE "MfaCredential" (
    "userId" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "lastTotpCounter" BIGINT CHECK ("lastTotpCounter" >= 0),
    "recoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MfaCredential_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "MfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Session" ADD COLUMN "mfaVersion" INTEGER,
    ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3),
    ADD CONSTRAINT "Session_mfa_assurance_check" CHECK (
        ("mfaVersion" IS NULL AND "mfaVerifiedAt" IS NULL) OR
        ("mfaVersion" IS NOT NULL AND "mfaVersion" > 0 AND "mfaVerifiedAt" IS NOT NULL)
    );
