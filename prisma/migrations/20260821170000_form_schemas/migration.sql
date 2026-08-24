-- Admin-authored student forms, versioned so a draft can be edited without
-- students ever seeing a half-finished change.
CREATE TABLE "form_schemas" (
  "id"          TEXT NOT NULL,
  "version"     INTEGER NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'DRAFT',
  "variant"     TEXT NOT NULL DEFAULT 'DEFAULT',
  "label"       TEXT NOT NULL,
  "definition"  JSONB NOT NULL,
  "publishNote" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "form_schemas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "form_schemas_variant_version_key" ON "form_schemas"("variant", "version");
CREATE INDEX "form_schemas_variant_status_idx" ON "form_schemas"("variant", "status");
