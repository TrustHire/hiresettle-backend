-- Migration: add archivedAt to engagements
--
-- archivedAt is a soft-archive timestamp set when an engagement (typically a
-- cancelled one) is archived out of the default list views. It preserves the
-- record while keeping it out of the default GET /engagements results. A NULL
-- value means the engagement is active/visible. The index supports the
-- default-list filter: WHERE "archivedAt" IS NULL.

ALTER TABLE "engagements" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "engagements_archivedAt_idx" ON "engagements"("archivedAt");
