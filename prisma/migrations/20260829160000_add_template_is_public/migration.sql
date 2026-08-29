-- AlterTable
ALTER TABLE "engagement_templates" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "engagement_templates_isPublic_idx" ON "engagement_templates"("isPublic");
