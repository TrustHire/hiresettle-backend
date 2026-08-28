-- Migration: add tags string array to engagements table (#252)
ALTER TABLE "engagements" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

-- GIN index to support efficient array-contains queries
CREATE INDEX "engagements_tags_idx" ON "engagements" USING GIN ("tags");
