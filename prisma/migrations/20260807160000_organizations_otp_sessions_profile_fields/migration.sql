-- AlterEnum
ALTER TYPE "Role" RENAME VALUE 'ADMIN' TO 'SUPER_ADMIN';

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('UNIVERSITY', 'BANK', 'CONSULTANCY');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StudyLevel" AS ENUM ('UG', 'PG', 'PHD');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationType" "OrganizationType" NOT NULL,
    "registrationNumber" TEXT,
    "licenseReference" TEXT,
    "website" TEXT,
    "country" TEXT,
    "city" TEXT,
    "verificationStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'LOGIN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "organizationName" TEXT,
    "entityId" TEXT,
    "actorUserId" TEXT,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE INDEX "otp_codes_phone_idx" ON "otp_codes"("phone");

-- AlterTable: users
ALTER TABLE "users"
    ALTER COLUMN "email" DROP NOT NULL,
    ALTER COLUMN "passwordHash" DROP NOT NULL,
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "fullName" TEXT,
    ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
    ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
    ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lockedUntil" TIMESTAMP(3),
    ADD COLUMN "lastLoginAt" TIMESTAMP(3),
    ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: student_profiles (rename columns to match the real onboarding form)
ALTER TABLE "student_profiles" RENAME COLUMN "personal" TO "basic";
ALTER TABLE "student_profiles" RENAME COLUMN "studyPreferences" TO "preferences";
ALTER TABLE "student_profiles" RENAME COLUMN "entranceExams" TO "testDetails";
ALTER TABLE "student_profiles" RENAME COLUMN "projects" TO "achievements";

ALTER TABLE "student_profiles"
    ADD COLUMN "studyLevel" "StudyLevel",
    ADD COLUMN "selectedTests" TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN "links" JSONB NOT NULL DEFAULT '{}';
