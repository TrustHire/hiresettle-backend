-- AddIdleSessionTracking
-- Track the last time a refresh token was used so idle sessions can be
-- expired before their natural expiry (see IDLE_SESSION_WINDOW_DAYS).
ALTER TABLE "refresh_tokens" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

-- Backfill legacy rows: without usage history we assume a session has been
-- idle since it was created, so it is measured against the idle window
-- correctly instead of being treated as permanently active.
UPDATE "refresh_tokens" SET "lastUsedAt" = "createdAt" WHERE "lastUsedAt" IS NULL;