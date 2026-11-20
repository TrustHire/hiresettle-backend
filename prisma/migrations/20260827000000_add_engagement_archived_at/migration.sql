-- Migration: add archivedAt and exclusiveUntil to engagements
--
-- archivedAt is a soft-archive timestamp set when an engagement (typically a
-- cancelled one) is archived out of the default list views. It preserves the
-- record while keeping it out of the default GET /engagements results. A NULL
-- value means the engagement is active/visible. The index supports the
-- default-list filter: WHERE "archivedAt" IS NULL.
--
-- exclusiveUntil is a nullable exclusivity window end date. When set and in the
-- future, the engagement's recruiter holds exclusive rights to the company +
-- job title, and conflicting engagements are rejected with 409. A NULL value
-- means no exclusivity is active. The composite index supports the conflict
-- lookup by company + job title.

ALTER TABLE "engagements" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "engagements" ADD COLUMN "exclusiveUntil" TIMESTAMP(3);

CREATE INDEX "engagements_archivedAt_idx" ON "engagements"("archivedAt");

CREATE INDEX "engagements_companyId_jobTitle_exclusiveUntil_idx" ON "engagements"("companyId", "jobTitle", "exclusiveUntil");
