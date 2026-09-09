-- Students are identified by their WhatsApp number, not an email address.
--
-- The column stays on the table because institutions and admins still sign in
-- with it; what changes is that no student row carries one. Addresses collected
-- by the old student signup form are cleared here so the column cannot be used
-- as a student sign-in identifier by anything that missed the change.
UPDATE "users"
SET "email" = NULL,
    "emailVerifiedAt" = NULL
WHERE "role" = 'STUDENT';
