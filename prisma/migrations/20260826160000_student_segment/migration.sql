-- Alumni: students whose admission our team has verified.
--
-- Kept apart from `discoverable`, which is the student's own choice about being
-- seen. This one is ours, and it should not be undone by a student toggling
-- their own visibility back on after they have been admitted.
ALTER TABLE "student_profiles"
  ADD COLUMN "segment" TEXT NOT NULL DEFAULT 'STUDENT',
  ADD COLUMN "alumniSince" TIMESTAMP(3),
  ADD COLUMN "alumniOfferId" TEXT;

CREATE INDEX "student_profiles_segment_idx" ON "student_profiles"("segment");

-- Anyone already purged was, by definition, an admitted student.
UPDATE "student_profiles" SET "segment" = 'ALUMNI' WHERE "status" = 'PURGED';
