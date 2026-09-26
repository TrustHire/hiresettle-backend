-- AlterTable: api_keys — add scopes column
-- Existing keys receive an empty array (unrestricted, backward-compatible).
ALTER TABLE "api_keys"
    ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
