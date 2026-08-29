-- Add database indexes for admin metrics and common query patterns
-- This migration adds indexes for the most common query patterns to improve performance

-- Indexes for engagements table
CREATE INDEX IF NOT EXISTS "engagements_status_idx" ON "engagements"("status");
CREATE INDEX IF NOT EXISTS "engagements_companyAddress_idx" ON "engagements"("companyAddress");
CREATE INDEX IF NOT EXISTS "engagements_recruiterAddress_idx" ON "engagements"("recruiterAddress");

-- Indexes for milestones table
CREATE INDEX IF NOT EXISTS "milestones_status_idx" ON "milestones"("status");
CREATE INDEX IF NOT EXISTS "milestones_engagement_id_idx" ON "milestones"("engagementId");

-- Composite index for engagement status and timestamps (for admin metrics and reporting)
CREATE INDEX IF NOT EXISTS "engagements_status_created_at_idx" ON "engagements"("status", "createdAt");

-- Composite index for milestone status and engagementId (for dispute queries)
CREATE INDEX IF NOT EXISTS "milestones_status_engagement_id_idx" ON "milestones"("status", "engagementId");

-- Index for users role queries (admin metrics)
CREATE INDEX IF NOT EXISTS "users_role_deactivated_at_idx" ON "users"("role", "deactivatedAt");

-- Add comment for documentation
COMMENT ON INDEX "engagements_status_idx" IS 'Admin metrics: count engagements by status';
COMMENT ON INDEX "engagements_companyAddress_idx" IS 'Common query: filter by company';
COMMENT ON INDEX "engagements_recruiterAddress_idx" IS 'Common query: filter by recruiter';
COMMENT ON INDEX "milestones_status_idx" IS 'Admin metrics: count disputed milestones';
COMMENT ON INDEX "engagements_status_created_at_idx" IS 'Admin reports: time-series by status';
COMMENT ON INDEX "milestones_status_engagement_id_idx" IS 'Dispute resolution: find disputed milestones per engagement';
COMMENT ON INDEX "users_role_deactivated_at_idx" IS 'Admin metrics: count active users by role';