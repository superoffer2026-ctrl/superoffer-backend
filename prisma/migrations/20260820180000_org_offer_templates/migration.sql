-- Reusable offer term sets, previously kept in the workspace's localStorage.
ALTER TABLE "organizations" ADD COLUMN "offerTemplates" JSONB NOT NULL DEFAULT '[]';
