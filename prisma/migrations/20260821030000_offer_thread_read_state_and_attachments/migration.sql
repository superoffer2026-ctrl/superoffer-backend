-- Per-side read state for an offer's message thread, so each party gets its own
-- unread badge without one side clearing the other's.
ALTER TABLE "offers" ADD COLUMN "studentReadAt" TIMESTAMP(3);
ALTER TABLE "offers" ADD COLUMN "organizationReadAt" TIMESTAMP(3);

-- One optional attachment per message, stored like a student document.
ALTER TABLE "offer_messages" ADD COLUMN "fileName" TEXT;
ALTER TABLE "offer_messages" ADD COLUMN "storagePath" TEXT;
ALTER TABLE "offer_messages" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "offer_messages" ADD COLUMN "fileSize" INTEGER;
