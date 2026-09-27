-- Dispute workflow (#381, #382, #383) and tokenized calendar feed (#380)

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DISPUTE_SLA_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DISPUTE_APPEALED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DISPUTE_APPEAL_DECIDED';

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');
CREATE TYPE "DisputeStage" AS ENUM ('ASSIGNMENT', 'ARBITER_REVIEW', 'APPEAL_REVIEW');
CREATE TYPE "DisputeSlaStatus" AS ENUM ('ON_TRACK', 'OVERDUE', 'MET');
CREATE TYPE "DisputeOutcome" AS ENUM ('RELEASE', 'REFUND');
CREATE TYPE "DisputeAppealStatus" AS ENUM ('OPEN', 'DECIDED');

-- AlterTable: calendar feed token (#380)
ALTER TABLE "users" ADD COLUMN "calendarTokenHash" TEXT;
ALTER TABLE "users" ADD COLUMN "calendarTokenCreatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "users_calendarTokenHash_key" ON "users"("calendarTokenHash");

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "raisedById" TEXT,
    "reason" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "stage" "DisputeStage" NOT NULL DEFAULT 'ASSIGNMENT',
    "arbiterId" TEXT,
    "arbiterAssignedAt" TIMESTAMP(3),
    "arbiterManuallyAssigned" BOOLEAN NOT NULL DEFAULT false,
    "responseDeadline" TIMESTAMP(3),
    "slaStatus" "DisputeSlaStatus" NOT NULL DEFAULT 'ON_TRACK',
    "slaEscalatedAt" TIMESTAMP(3),
    "outcome" "DisputeOutcome",
    "resolvedAt" TIMESTAMP(3),
    "appealDeadline" TIMESTAMP(3),
    "fundsLocked" BOOLEAN NOT NULL DEFAULT true,
    "fundsReleasedAt" TIMESTAMP(3),
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dispute_appeals" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "appellantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "originalArbiterId" TEXT,
    "arbiterId" TEXT,
    "originalOutcome" "DisputeOutcome" NOT NULL,
    "status" "DisputeAppealStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "DisputeOutcome",
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispute_appeals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "arbiter_recusals" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "arbiterId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arbiter_recusals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_milestoneId_status_idx" ON "disputes"("milestoneId", "status");
CREATE INDEX "disputes_engagementId_idx" ON "disputes"("engagementId");
CREATE INDEX "disputes_arbiterId_status_idx" ON "disputes"("arbiterId", "status");
CREATE INDEX "disputes_status_slaStatus_responseDeadline_idx" ON "disputes"("status", "slaStatus", "responseDeadline");
CREATE INDEX "disputes_status_appealDeadline_idx" ON "disputes"("status", "appealDeadline");
CREATE UNIQUE INDEX "dispute_appeals_disputeId_key" ON "dispute_appeals"("disputeId");
CREATE INDEX "dispute_appeals_arbiterId_idx" ON "dispute_appeals"("arbiterId");
CREATE UNIQUE INDEX "arbiter_recusals_engagementId_arbiterId_key" ON "arbiter_recusals"("engagementId", "arbiterId");
CREATE INDEX "arbiter_recusals_arbiterId_idx" ON "arbiter_recusals"("arbiterId");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_arbiterId_fkey" FOREIGN KEY ("arbiterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dispute_appeals" ADD CONSTRAINT "dispute_appeals_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "arbiter_recusals" ADD CONSTRAINT "arbiter_recusals_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "arbiter_recusals" ADD CONSTRAINT "arbiter_recusals_arbiterId_fkey" FOREIGN KEY ("arbiterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
