-- Automated messages posted into an offer thread when something happens.
ALTER TABLE "offer_messages" ADD COLUMN "automatic"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "offer_messages" ADD COLUMN "ruleId"     TEXT;
ALTER TABLE "offer_messages" ADD COLUMN "triggerRef" TEXT;

-- Makes automation idempotent: the same rule reacting to the same thing on the
-- same offer can only ever produce one message. Ordinary messages carry NULLs,
-- which Postgres does not treat as conflicting, so they are unaffected.
CREATE UNIQUE INDEX "offer_messages_offerId_ruleId_triggerRef_key"
  ON "offer_messages"("offerId", "ruleId", "triggerRef");

CREATE TABLE "automation_rules" (
  "id"          TEXT NOT NULL,
  "event"       TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "audience"    TEXT NOT NULL DEFAULT 'both',
  "attribution" TEXT NOT NULL DEFAULT 'system',
  "body"        TEXT NOT NULL,
  "condition"   JSONB,
  "markUnread"  BOOLEAN NOT NULL DEFAULT true,
  "enabled"     BOOLEAN NOT NULL DEFAULT true,
  "order"       INTEGER NOT NULL DEFAULT 1,
  "system"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "automation_rules_event_enabled_idx" ON "automation_rules"("event", "enabled");
