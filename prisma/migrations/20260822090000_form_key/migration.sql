-- A schema document is now identified by which form it is as well as which
-- variant, so organisation forms can live alongside the student profile.
ALTER TABLE "form_schemas" ADD COLUMN "formKey" TEXT NOT NULL DEFAULT 'STUDENT_PROFILE';

DROP INDEX IF EXISTS "form_schemas_variant_version_key";
DROP INDEX IF EXISTS "form_schemas_variant_status_idx";

CREATE UNIQUE INDEX "form_schemas_formKey_variant_version_key" ON "form_schemas"("formKey", "variant", "version");
CREATE INDEX "form_schemas_formKey_variant_status_idx" ON "form_schemas"("formKey", "variant", "status");
