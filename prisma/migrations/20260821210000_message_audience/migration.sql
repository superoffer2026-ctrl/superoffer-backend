-- Automated notices are addressed to one side or both. Without this, a message
-- meant for the officer ("the student opened this offer") was also shown to the
-- student who caused it.
ALTER TABLE "offer_messages" ADD COLUMN "audience" TEXT;
