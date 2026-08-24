-- Candidate triage moved out of the workspace's localStorage: an entry is now
-- either a shortlist or an explicit rejection.
ALTER TABLE "shortlists" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'SHORTLISTED';
