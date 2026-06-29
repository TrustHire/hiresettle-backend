-- AlterEnum: add ACCOUNT_MERGED to EngagementStatus
ALTER TYPE "EngagementStatus" ADD VALUE IF NOT EXISTS 'ACCOUNT_MERGED';

-- AlterEnum: add ACCOUNT_MERGE_DETECTED to NotificationType
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_MERGE_DETECTED';

-- CreateTable: milestone_audit_logs (added in PR #120)
CREATE TABLE IF NOT EXISTS "milestone_audit_logs" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "fromStatus" "MilestoneStatus" NOT NULL,
    "toStatus" "MilestoneStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "milestone_audit_logs_milestoneId_idx" ON "milestone_audit_logs"("milestoneId");
CREATE INDEX IF NOT EXISTS "milestone_audit_logs_changedBy_idx" ON "milestone_audit_logs"("changedBy");

ALTER TABLE "milestone_audit_logs" ADD CONSTRAINT "milestone_audit_logs_milestoneId_fkey"
    FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "milestone_audit_logs" ADD CONSTRAINT "milestone_audit_logs_changedBy_fkey"
    FOREIGN KEY ("changedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: dispute_evidence (added in PR #120)
CREATE TABLE IF NOT EXISTS "dispute_evidence" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "s3Path" TEXT NOT NULL,
    "s3Url" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dispute_evidence_milestoneId_idx" ON "dispute_evidence"("milestoneId");
CREATE INDEX IF NOT EXISTS "dispute_evidence_uploadedBy_idx" ON "dispute_evidence"("uploadedBy");

ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_milestoneId_fkey"
    FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_uploadedBy_fkey"
    FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
