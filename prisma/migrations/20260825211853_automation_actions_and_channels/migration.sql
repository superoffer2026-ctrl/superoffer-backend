-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "actions" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "automation_deliveries" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "offerId" TEXT NOT NULL,
    "triggerRef" TEXT NOT NULL,
    "actionIndex" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientId" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "providerMessageId" TEXT,
    "provider" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_deliveries_ruleId_createdAt_idx" ON "automation_deliveries"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "automation_deliveries_offerId_idx" ON "automation_deliveries"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "automation_deliveries_offerId_ruleId_triggerRef_actionIndex_key" ON "automation_deliveries"("offerId", "ruleId", "triggerRef", "actionIndex", "channel", "recipientId");

-- AddForeignKey
ALTER TABLE "automation_deliveries" ADD CONSTRAINT "automation_deliveries_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every rule written before this migration said exactly one thing, in the
-- native chat, to the audience on its own row. Read it back as the single
-- action it always was, so nothing changes behaviour on deploy and no rule
-- has to be re-authored by hand.
UPDATE "automation_rules"
SET "actions" = jsonb_build_array(
  jsonb_build_object(
    'type', 'notify',
    'channels', jsonb_build_array('inapp'),
    'audience', "audience",
    'attribution', "attribution",
    'body', "body",
    'markUnread', "markUnread"
  )
)
WHERE "actions" IS NULL OR "actions" = '[]'::jsonb;
