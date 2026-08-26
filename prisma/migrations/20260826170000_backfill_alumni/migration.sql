-- Admissions confirmed before the alumni segment existed.
--
-- Those students were hidden by `discoverable` alone, which is the student's
-- own setting — so a confirmed alumnus who turned their visibility back on
-- would have reappeared in front of universities. The segment is ours and
-- cannot be undone by the student, so every confirmed admission belongs in it.
UPDATE "student_profiles" sp
SET "segment"       = 'ALUMNI',
    "discoverable"  = false,
    "alumniSince"   = COALESCE(f."confirmedAt", f."updatedAt"),
    "alumniOfferId" = f."offerId"
FROM "admission_follow_ups" f
JOIN "offers" o ON o."id" = f."offerId"
WHERE sp."userId" = o."studentUserId"
  AND f."status" = 'CONFIRMED'
  AND sp."segment" <> 'ALUMNI';
