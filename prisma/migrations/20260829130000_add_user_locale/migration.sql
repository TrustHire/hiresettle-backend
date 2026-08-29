-- Migration: add locale to users for localized email templates (#281)
--
-- BCP-47 style tag (e.g. "en", "es") selecting which template variant to
-- render for notification emails. Defaults to "en"; missing translations
-- always fall back to English at render time.

ALTER TABLE "users" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
