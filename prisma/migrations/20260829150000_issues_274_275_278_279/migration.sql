-- Migration: issues #274 #275 #278 #279
-- #275: per-webhook event type filtering
ALTER TABLE "webhook_subscriptions" ADD COLUMN "eventTypes" TEXT[] NOT NULL DEFAULT '{}';

-- #278: Discord notification integration (mirrors Slack)
ALTER TABLE "users" ADD COLUMN "discordWebhookUrl" TEXT;

-- #279: notification batching window (configurable per user)
ALTER TABLE "users" ADD COLUMN "batchWindowSeconds" INTEGER NOT NULL DEFAULT 60;

-- #279: notification batch tracking table
CREATE TABLE "notification_batches" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "count"     INTEGER NOT NULL DEFAULT 1,
  "firstData" JSONB,
  "flushedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "notification_batches_userId_type_flushedAt_idx" ON "notification_batches"("userId", "type", "flushedAt");
CREATE INDEX "notification_batches_expiresAt_idx" ON "notification_batches"("expiresAt");
