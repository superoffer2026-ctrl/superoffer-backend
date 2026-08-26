-- A queued row now names the one action it is waiting to run.
--
-- A rule can hold several scheduled action sets at different times — a nudge
-- after a day, a last call after a week — so the queue has to say which of
-- them a row is, or the worker would run the whole rule again.
ALTER TABLE "scheduled_automations"
  ADD COLUMN "actionIndex" INTEGER NOT NULL DEFAULT 0;

-- Everything queued before this was the whole rule, which is action zero.
DROP INDEX IF EXISTS "scheduled_automations_ruleId_offerId_triggerRef_key";

CREATE UNIQUE INDEX "scheduled_automations_ruleId_offerId_triggerRef_actionIndex_key"
  ON "scheduled_automations" ("ruleId", "offerId", "triggerRef", "actionIndex");
