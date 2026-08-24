-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "offer_templates" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "terms" JSONB NOT NULL DEFAULT '{}',
    "value" TEXT,
    "valueLabel" TEXT,
    "conditions" TEXT,
    "nextSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responseWindowDays" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offer_templates_organizationId_idx" ON "offer_templates"("organizationId");

-- CreateIndex
CREATE INDEX "offer_templates_productId_isDefault_idx" ON "offer_templates"("productId", "isDefault");

-- AddForeignKey
ALTER TABLE "offer_templates" ADD CONSTRAINT "offer_templates_productId_fkey" FOREIGN KEY ("productId") REFERENCES "organization_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "offer_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
