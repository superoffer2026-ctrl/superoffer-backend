-- Following up a student who accepted an offer, and recording when their
-- personal data was removed. Keyed on the offer: a student may hold several,
-- and it is one specific acceptance being verified.
CREATE TABLE "admission_follow_ups" (
  "id"          TEXT NOT NULL,
  "offerId"     TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "note"        TEXT,
  "checkedBy"   TEXT,
  "confirmedAt" TIMESTAMP(3),
  "purgedAt"    TIMESTAMP(3),
  "purgedBy"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admission_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admission_follow_ups_offerId_key" ON "admission_follow_ups"("offerId");
CREATE INDEX "admission_follow_ups_status_idx" ON "admission_follow_ups"("status");

ALTER TABLE "admission_follow_ups"
  ADD CONSTRAINT "admission_follow_ups_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
