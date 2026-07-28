-- Pre-existing gap: the "engagement_templates" table backing EngagementTemplatesModule
-- was never captured by a migration. It must exist before we can extend it below, so
-- this catches it up to match the model that has been live in prisma/schema.prisma.
CREATE TABLE "engagement_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "jobDescription" TEXT,
    "salaryRange" TEXT,
    "location" TEXT,
    "milestoneConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagement_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "engagement_templates_companyId_idx" ON "engagement_templates"("companyId");

ALTER TABLE "engagement_templates" ADD CONSTRAINT "engagement_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add in-app / SSE channel toggles alongside the existing emailEnabled flag
ALTER TABLE "notification_preferences" ADD COLUMN     "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sseEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: track which version an engagement template is currently on
ALTER TABLE "engagement_templates" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable: immutable per-version snapshots of engagement templates
CREATE TABLE "engagement_template_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "jobDescription" TEXT,
    "salaryRange" TEXT,
    "location" TEXT,
    "milestoneConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_template_versions_pkey" PRIMARY KEY ("id")
);

-- Backfill version 1 for every existing template from its current fields
INSERT INTO "engagement_template_versions" ("id", "templateId", "version", "name", "jobTitle", "jobDescription", "salaryRange", "location", "milestoneConfig", "createdAt")
SELECT gen_random_uuid(), "id", 1, "name", "jobTitle", "jobDescription", "salaryRange", "location", "milestoneConfig", "createdAt"
FROM "engagement_templates";

-- AlterTable: link engagements to the specific template version they were created with
ALTER TABLE "engagements" ADD COLUMN     "templateVersionId" TEXT;

-- CreateIndex
CREATE INDEX "engagement_template_versions_templateId_idx" ON "engagement_template_versions"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_template_versions_templateId_version_key" ON "engagement_template_versions"("templateId", "version");

-- AddForeignKey
ALTER TABLE "engagement_template_versions" ADD CONSTRAINT "engagement_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "engagement_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "engagement_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
