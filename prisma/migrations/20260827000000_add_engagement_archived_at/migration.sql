-- Migration: add archivedAt and visibility to engagements
--
-- archivedAt is a soft-archive timestamp set when an engagement (typically a
-- cancelled one) is archived out of the default list views. It preserves the
-- record while keeping it out of the default GET /engagements results. A NULL
-- value means the engagement is active/visible. The index supports the
-- default-list filter: WHERE "archivedAt" IS NULL.
--
-- visibility controls whether an engagement is discoverable by recruiters via
-- the public GET /listings endpoint. It defaults to PRIVATE so existing rows
-- stay hidden until a verified company explicitly publishes them.

ALTER TABLE "engagements" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "engagements_archivedAt_idx" ON "engagements"("archivedAt");

CREATE TYPE "EngagementVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

ALTER TABLE "engagements" ADD COLUMN "visibility" "EngagementVisibility" NOT NULL DEFAULT 'PRIVATE';

CREATE INDEX "engagements_visibility_idx" ON "engagements"("visibility");
