-- Migration: add Microsoft Teams webhook URL to users (#391)
--
-- Optional Teams incoming-webhook URL configured per user (typically a
-- COMPANY account). When set, key notification types are posted to the
-- company's Teams channel as Adaptive Cards.

ALTER TABLE "users" ADD COLUMN "teamsWebhookUrl" TEXT;
