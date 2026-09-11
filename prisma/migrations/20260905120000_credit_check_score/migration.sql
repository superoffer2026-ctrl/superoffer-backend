-- The CIBIL score itself, kept alongside the band.
--
-- The band is what an organisation is shown; the score is what the co-applicant
-- is shown about their own record, which is theirs to see. Existing rows carry
-- no score: they were produced by the stub bureau this replaces, and inventing
-- one for them would be indistinguishable from a real reading.
ALTER TABLE "credit_checks" ADD COLUMN "score" INTEGER;
