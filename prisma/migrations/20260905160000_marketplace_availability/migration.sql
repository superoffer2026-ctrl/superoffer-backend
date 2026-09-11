-- A seat and the money for it are two separate things to find.
--
-- Discovery filtered on one flag, so a student who had accepted a place was
-- still being shown to banks that pay per candidate, and a student who had
-- arranged a loan was still hidden from nobody at all. Each market now closes
-- on its own acceptance.
ALTER TABLE "student_profiles" ADD COLUMN "admissionStatus" TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE "student_profiles" ADD COLUMN "financeStatus"   TEXT NOT NULL DEFAULT 'OPEN';

CREATE INDEX "student_profiles_admissionStatus_idx" ON "student_profiles"("admissionStatus");
CREATE INDEX "student_profiles_financeStatus_idx"   ON "student_profiles"("financeStatus");

-- Backfill from what students have already decided. An offer that was later
-- withdrawn or expired never placed anybody, so it is not counted.
UPDATE "student_profiles" p
SET "admissionStatus" = 'PLACED'
WHERE EXISTS (
  SELECT 1 FROM "offers" o
  WHERE o."studentUserId" = p."userId"
    AND o."studentDecision" = 'ACCEPTED'
    AND o."category" = 'UNIVERSITY'
    AND o."status" NOT IN ('WITHDRAWN', 'EXPIRED')
);

UPDATE "student_profiles" p
SET "financeStatus" = 'PLACED'
WHERE EXISTS (
  SELECT 1 FROM "offers" o
  WHERE o."studentUserId" = p."userId"
    AND o."studentDecision" = 'ACCEPTED'
    AND o."category" = 'BANK'
    AND o."status" NOT IN ('WITHDRAWN', 'EXPIRED')
);

-- An alumnus is placed by definition; the admin already verified it.
UPDATE "student_profiles" SET "admissionStatus" = 'PLACED' WHERE "segment" = 'ALUMNI';
