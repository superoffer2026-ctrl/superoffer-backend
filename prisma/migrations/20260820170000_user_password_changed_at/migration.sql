-- The settings screens show when the password was last changed.
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
