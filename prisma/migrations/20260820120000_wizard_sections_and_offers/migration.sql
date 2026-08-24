-- CreateEnum
CREATE TYPE "OfferCategory" AS ENUM ('UNIVERSITY', 'BANK', 'SCHOLARSHIP', 'CONSULTANCY');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('SENT', 'VIEWED', 'NEGOTIATING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StudentDecision" AS ENUM ('PENDING', 'SHORTLISTED', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "entranceExams" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "personal" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "projects" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "studyPreferences" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "workExperience" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "category" "OfferCategory" NOT NULL,
    "program" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'SENT',
    "studentDecision" "StudentDecision" NOT NULL DEFAULT 'PENDING',
    "terms" JSONB NOT NULL DEFAULT '{}',
    "conditions" TEXT,
    "nextSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactName" TEXT,
    "contactRole" TEXT,
    "location" TEXT,
    "intake" TEXT,
    "valueLabel" TEXT,
    "value" TEXT,
    "viewedAt" TIMESTAMP(3),
    "savedByStudent" BOOLEAN NOT NULL DEFAULT false,
    "favourite" BOOLEAN NOT NULL DEFAULT false,
    "compared" BOOLEAN NOT NULL DEFAULT false,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_messages" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offers_studentUserId_status_idx" ON "offers"("studentUserId", "status");

-- CreateIndex
CREATE INDEX "offers_organizationId_status_idx" ON "offers"("organizationId", "status");

-- CreateIndex
CREATE INDEX "offer_messages_offerId_idx" ON "offer_messages"("offerId");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_messages" ADD CONSTRAINT "offer_messages_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

