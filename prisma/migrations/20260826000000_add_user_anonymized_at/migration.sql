-- Migration: add anonymizedAt to users
--
-- anonymizedAt is set by PiiAnonymizationSchedulerService once all PII fields
-- on a deleted account have been scrubbed. It acts as an idempotency marker so
-- the scheduler never double-processes the same account, and as an audit trail
-- confirming when erasure completed.
--
-- The composite index on (deletedAt, anonymizedAt) makes the scheduler's query
-- efficient: WHERE "deletedAt" IS NOT NULL AND "anonymizedAt" IS NULL AND "deletedAt" < $cutoff

ALTER TABLE "users" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

CREATE INDEX "users_deletedAt_anonymizedAt_idx" ON "users"("deletedAt", "anonymizedAt");
