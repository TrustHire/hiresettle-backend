-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxActiveEngagements" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "planId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default plans
INSERT INTO "plans" ("id", "name", "maxActiveEngagements") VALUES
  ('plan_starter', 'Starter', 3),
  ('plan_growth', 'Growth', 10),
  ('plan_enterprise', 'Enterprise', 2147483647);

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_redemptions_discountCodeId_companyId_key" ON "discount_redemptions"("discountCodeId", "companyId");

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "discountCodeId" TEXT;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "discountCodeId" TEXT;
ALTER TABLE "invoices" ADD COLUMN "discountAmount" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
