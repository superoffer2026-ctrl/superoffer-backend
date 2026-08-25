-- One mobile number, one student account.
--
-- The number is stored as the student typed it, so uniqueness runs on a derived
-- key of dial country plus digits. Existing rows are backfilled first, then the
-- index makes the rule a guarantee rather than a check two requests can race.

UPDATE "student_profiles"
SET "personal" = jsonb_set(
      "personal"::jsonb,
      '{mobileKey}',
      to_jsonb(
        upper(coalesce("personal"->>'mobileCountry', '')) || ':' ||
        regexp_replace(coalesce("personal"->>'mobileNumber', ''), '\D', '', 'g')
      )
    )
WHERE coalesce("personal"->>'mobileNumber', '') <> '';

-- Partial, because a student who has not given a number yet must not collide
-- with every other student who has not given one either.
CREATE UNIQUE INDEX "student_profiles_mobile_key"
  ON "student_profiles" (("personal"->>'mobileKey'))
  WHERE coalesce("personal"->>'mobileKey', '') <> '';
