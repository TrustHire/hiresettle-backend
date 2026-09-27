-- Milestone workflow enhancements: proof versioning (#376), proof review SLA (#377),
-- partial payment release (#378) and milestone comments (#379)

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROOF_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROOF_REVIEW_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROOF_SLA_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PARTIAL_RELEASE_PROPOSED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PARTIAL_RELEASE_EXECUTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MILESTONE_COMMENT_ADDED';

-- CreateEnum
CREATE TYPE "ProofVersionStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');
CREATE TYPE "ProofSlaAction" AS ENUM ('AUTO_APPROVE', 'ESCALATE_TO_ADMIN');
CREATE TYPE "PartialReleaseStatus" AS ENUM ('PROPOSED', 'EXECUTED', 'REJECTED', 'FAILED');
CREATE TYPE "PartialRemainderAction" AS ENUM ('REFUND', 'RETAIN');

-- AlterTable: company proof review SLA settings (#377)
ALTER TABLE "users" ADD COLUMN "proofSlaDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "users" ADD COLUMN "proofSlaAction" "ProofSlaAction" NOT NULL DEFAULT 'ESCALATE_TO_ADMIN';

-- AlterTable: structured milestone audit entries (#378)
ALTER TABLE "milestone_audit_logs" ADD COLUMN "action" TEXT;
ALTER TABLE "milestone_audit_logs" ADD COLUMN "details" JSONB;

-- CreateTable
CREATE TABLE "milestone_proof_versions" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "proofUrl" TEXT,
    "content" TEXT,
    "proofHash" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ProofVersionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reminder50SentAt" TIMESTAMP(3),
    "reminder90SentAt" TIMESTAMP(3),
    "slaExpiredAt" TIMESTAMP(3),

    CONSTRAINT "milestone_proof_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "milestone_partial_releases" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "releaseAmount" BIGINT NOT NULL,
    "remainderAmount" BIGINT NOT NULL,
    "remainderAction" "PartialRemainderAction" NOT NULL,
    "reason" TEXT,
    "status" "PartialReleaseStatus" NOT NULL DEFAULT 'PROPOSED',
    "companyApproverId" TEXT,
    "companyApprovedAt" TIMESTAMP(3),
    "recruiterApproverId" TEXT,
    "recruiterApprovedAt" TIMESTAMP(3),
    "txHash" TEXT,
    "executedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestone_partial_releases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "milestone_comments" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_comments_pkey" PRIMARY KEY ("id")
);

-- Backfill: existing proofs become version 1 so history starts from what is on record
INSERT INTO "milestone_proof_versions" ("id", "milestoneId", "versionNumber", "proofHash", "submittedAt", "status")
SELECT gen_random_uuid()::text, m."id", 1, NULLIF(m."proofHash", ''), m."updatedAt",
       CASE WHEN m."status" IN ('CONFIRMED', 'RESOLVED') THEN 'APPROVED'::"ProofVersionStatus"
            ELSE 'SUBMITTED'::"ProofVersionStatus" END
FROM "milestones" m
WHERE m."status" IN ('PROOF_SUBMITTED', 'CONFIRMED', 'DISPUTED', 'RESOLVED');

-- CreateIndex
CREATE UNIQUE INDEX "milestone_proof_versions_milestoneId_versionNumber_key" ON "milestone_proof_versions"("milestoneId", "versionNumber");
CREATE INDEX "milestone_proof_versions_status_submittedAt_idx" ON "milestone_proof_versions"("status", "submittedAt");
CREATE INDEX "milestone_partial_releases_milestoneId_status_idx" ON "milestone_partial_releases"("milestoneId", "status");
CREATE INDEX "milestone_partial_releases_engagementId_idx" ON "milestone_partial_releases"("engagementId");
-- At most one open proposal per milestone
CREATE UNIQUE INDEX "milestone_partial_releases_one_proposed_idx"
    ON "milestone_partial_releases"("milestoneId")
    WHERE "status" = 'PROPOSED';
CREATE INDEX "milestone_comments_milestoneId_createdAt_idx" ON "milestone_comments"("milestoneId", "createdAt");
CREATE INDEX "milestone_comments_engagementId_createdAt_idx" ON "milestone_comments"("engagementId", "createdAt");

-- AddForeignKey
ALTER TABLE "milestone_proof_versions" ADD CONSTRAINT "milestone_proof_versions_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "milestone_partial_releases" ADD CONSTRAINT "milestone_partial_releases_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "milestone_comments" ADD CONSTRAINT "milestone_comments_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "milestone_comments" ADD CONSTRAINT "milestone_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
