-- AlterTable
ALTER TABLE "engagement_templates" ADD COLUMN "usageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "engagement_templates" ADD COLUMN "lastUsedAt" TIMESTAMP(3);
