-- Migration: add Slack webhook URL to users (#277)
--
-- Optional Slack incoming-webhook URL configured per user (typically a
-- COMPANY account). When set, key notification types are posted to the
-- company's Slack channel in addition to in-app/email delivery.

ALTER TABLE "users" ADD COLUMN "slackWebhookUrl" TEXT;
