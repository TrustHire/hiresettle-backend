-- prisma/migrations/20260629120000_add_engagement_replacement_reason/migration.sql
--
-- Adds the `replacementReason` column to the `engagements` table.
-- This optional text field (≤ 500 chars) is populated when a company
-- calls POST /engagements/:id/request-replacement and provides a reason.
-- The column is intentionally nullable — reason is never mandatory.

ALTER TABLE "engagements"
  ADD COLUMN "replacementReason" TEXT;