-- Migration: add weekly digest opt-in flag to users (#276)
--
-- digestEnabled is a per-user opt-in toggle. When true, the weekly digest
-- cron (Monday 09:00 UTC) emails the user a summary of their notifications
-- from the prior 7 days. Defaults to false so no user receives a digest
-- until they explicitly opt in.

ALTER TABLE "users" ADD COLUMN "digestEnabled" BOOLEAN NOT NULL DEFAULT false;
