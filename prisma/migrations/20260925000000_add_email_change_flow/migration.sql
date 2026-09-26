-- Migration: add_email_change_flow (#356)
-- Adds three fields to "users" to support the email change verification flow:
--   pendingEmail              – new address awaiting confirmation
--   emailChangeToken          – HMAC-SHA256 token sent to the new address (unique)
--   emailChangeTokenExpiresAt – 24 h TTL after which the token is stale

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "pendingEmail"               TEXT,
  ADD COLUMN IF NOT EXISTS "emailChangeToken"           TEXT,
  ADD COLUMN IF NOT EXISTS "emailChangeTokenExpiresAt"  TIMESTAMP(3);

-- The token column must be unique so two concurrent requests for the same user
-- cannot produce duplicate tokens.
CREATE UNIQUE INDEX IF NOT EXISTS "users_emailChangeToken_key"
  ON "users"("emailChangeToken");
