-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "coApplicant" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "credit_consents" (
    "id" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "grantedIp" TEXT,

    CONSTRAINT "credit_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_checks" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "enquiry" TEXT NOT NULL,
    "band" TEXT,
    "outcome" TEXT NOT NULL,
    "providerRef" TEXT,
    "provider" TEXT NOT NULL,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staleAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bureau_pull_audits" (
    "id" TEXT NOT NULL,
    "studentUserId" TEXT,
    "organizationId" TEXT,
    "actorUserId" TEXT,
    "consentId" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bureau_pull_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_bureau_credentials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "certFingerprint" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_bureau_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_consents_studentUserId_idx" ON "credit_consents"("studentUserId");

-- CreateIndex
CREATE INDEX "credit_consents_organizationId_expiresAt_idx" ON "credit_consents"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "credit_checks_studentUserId_pulledAt_idx" ON "credit_checks"("studentUserId", "pulledAt");

-- CreateIndex
CREATE INDEX "credit_checks_organizationId_idx" ON "credit_checks"("organizationId");

-- CreateIndex
CREATE INDEX "bureau_pull_audits_organizationId_at_idx" ON "bureau_pull_audits"("organizationId", "at");

-- CreateIndex
CREATE INDEX "bureau_pull_audits_studentUserId_at_idx" ON "bureau_pull_audits"("studentUserId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "organization_bureau_credentials_organizationId_key" ON "organization_bureau_credentials"("organizationId");

-- AddForeignKey
ALTER TABLE "credit_consents" ADD CONSTRAINT "credit_consents_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_checks" ADD CONSTRAINT "credit_checks_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "credit_consents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_bureau_credentials" ADD CONSTRAINT "organization_bureau_credentials_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
