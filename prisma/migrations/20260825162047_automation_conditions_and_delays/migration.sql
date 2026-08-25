-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "delayMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "guard" JSONB;

-- CreateTable
CREATE TABLE "scheduled_automations" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "triggerRef" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "extra" JSONB,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_automations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_automations_status_dueAt_idx" ON "scheduled_automations"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_automations_ruleId_offerId_triggerRef_key" ON "scheduled_automations"("ruleId", "offerId", "triggerRef");

-- AddForeignKey
ALTER TABLE "scheduled_automations" ADD CONSTRAINT "scheduled_automations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_automations" ADD CONSTRAINT "scheduled_automations_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
