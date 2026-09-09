-- Subscriptions billed offline, shown online.
--
-- No money moves through the product: the finance team takes payment by
-- transfer or cheque and records it here, so an organisation can see what they
-- were sold and what they still owe. Quota is counted per period rather than per
-- organisation, so a new period begins at zero without anything having to reset it.

ALTER TABLE "organizations" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "suspensionReason" TEXT;

CREATE TABLE "subscriptions" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "plan"           TEXT NOT NULL,
  "periodStart"    TIMESTAMP(3) NOT NULL,
  "periodEnd"      TIMESTAMP(3) NOT NULL,
  "amountMinor"    INTEGER NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'INR',
  "status"         TEXT NOT NULL DEFAULT 'ISSUED',
  "invoiceNumber"  TEXT NOT NULL,
  "paymentRef"     TEXT,
  "paidAt"         TIMESTAMP(3),
  "recordedBy"     TEXT,
  "note"           TEXT,
  "profilesViewed" INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_invoiceNumber_key" ON "subscriptions"("invoiceNumber");
CREATE INDEX "subscriptions_organizationId_periodStart_idx" ON "subscriptions"("organizationId", "periodStart");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "profile_views" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentUserId"  TEXT NOT NULL,
  "subscriptionId" TEXT,
  "viewedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profile_views_pkey" PRIMARY KEY ("id")
);

-- One student costs one view per period, however many times they are opened.
CREATE UNIQUE INDEX "profile_views_organizationId_studentUserId_subscriptionId_key"
  ON "profile_views"("organizationId", "studentUserId", "subscriptionId");
CREATE INDEX "profile_views_organizationId_viewedAt_idx" ON "profile_views"("organizationId", "viewedAt");

ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
