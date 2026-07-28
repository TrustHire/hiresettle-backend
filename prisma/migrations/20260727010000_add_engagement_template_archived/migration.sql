-- Adds an `archived` flag to engagement_templates so templates can be
-- soft-deleted instead of removed, preserving historical reference from
-- past engagements that used them (issue #168).
ALTER TABLE "engagement_templates"
  ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
