-- Programmes a student can actually compare, and offers that keep their word.
--
-- The academic shape of a programme lived in a free-form JSON blob, so no two
-- universities described tuition or duration the same way and an offer could not
-- carry either reliably. Those fields are promoted to columns here and backfilled
-- from what is already stored. Everything stays nullable: this table is shared
-- with lenders, whose products have none of it.

ALTER TABLE "organizations" ADD COLUMN "logoRef"  TEXT;
ALTER TABLE "organizations" ADD COLUMN "coverRef" TEXT;

ALTER TABLE "organization_products" ADD COLUMN "degreeLevel"     TEXT;
ALTER TABLE "organization_products" ADD COLUMN "fieldOfStudy"    TEXT;
ALTER TABLE "organization_products" ADD COLUMN "durationMonths"  INTEGER;
ALTER TABLE "organization_products" ADD COLUMN "studyMode"       TEXT;
ALTER TABLE "organization_products" ADD COLUMN "campusLocation"  TEXT;
ALTER TABLE "organization_products" ADD COLUMN "intakes"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "organization_products" ADD COLUMN "tuitionFeeMinor" INTEGER;
ALTER TABLE "organization_products" ADD COLUMN "currency"        TEXT;
ALTER TABLE "organization_products" ADD COLUMN "scholarshipInfo" TEXT;
ALTER TABLE "organization_products" ADD COLUMN "imageRef"        TEXT;

-- An offer keeps the university and programme as they were the day it was sent.
ALTER TABLE "offers" ADD COLUMN "programSnapshot" JSONB NOT NULL DEFAULT '{}';

-- Backfill from the blob. Only what is unambiguous is moved: a tuition figure
-- that is not a plain number is left where it is rather than guessed at, so a
-- bad conversion cannot quietly become a price a student is shown.
UPDATE "organization_products" SET
  "degreeLevel"    = NULLIF(terms->>'degreeLevel', ''),
  "fieldOfStudy"   = NULLIF(terms->>'course', ''),
  "campusLocation" = NULLIF(terms->>'country', ''),
  "scholarshipInfo"= NULLIF(terms->>'scholarshipRange', ''),
  "durationMonths" = CASE
    WHEN terms->>'durationYears' ~ '^[0-9]+(\.[0-9]+)?$'
    THEN ROUND((terms->>'durationYears')::numeric * 12)::int
  END,
  "tuitionFeeMinor" = CASE
    WHEN regexp_replace(coalesce(terms->>'tuitionFee', ''), '[^0-9.]', '', 'g') ~ '^[0-9]+(\.[0-9]+)?$'
     AND regexp_replace(coalesce(terms->>'tuitionFee', ''), '[^0-9.]', '', 'g') <> ''
    THEN ROUND(regexp_replace(terms->>'tuitionFee', '[^0-9.]', '', 'g')::numeric * 100)::int
  END,
  "intakes" = CASE
    WHEN jsonb_typeof(terms->'intakes') = 'array'
    THEN ARRAY(SELECT jsonb_array_elements_text(terms->'intakes'))
    ELSE ARRAY[]::TEXT[]
  END
WHERE terms IS NOT NULL AND terms <> '{}'::jsonb;
