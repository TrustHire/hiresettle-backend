-- Notification types
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLAIMABLE_BALANCE_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLAIMABLE_BALANCE_REMINDER';

-- Per-key API limits
ALTER TABLE "api_keys" ADD COLUMN "rateLimit" INTEGER;
ALTER TABLE "api_keys" ADD COLUMN "monthlyQuota" INTEGER;
ALTER TABLE "api_keys" ADD COLUMN "quotaPeriod" TEXT;
ALTER TABLE "api_keys" ADD COLUMN "quotaUsed" INTEGER NOT NULL DEFAULT 0;

-- Audit log hash chains
ALTER TABLE "audit_logs" ADD COLUMN "chainSeq" INTEGER, ADD COLUMN "prevHash" TEXT, ADD COLUMN "hash" TEXT;
CREATE UNIQUE INDEX "audit_logs_chainSeq_key" ON "audit_logs"("chainSeq");

ALTER TABLE "EngagementAuditLog" ADD COLUMN "chainSeq" INTEGER, ADD COLUMN "prevHash" TEXT, ADD COLUMN "hash" TEXT;
CREATE UNIQUE INDEX "EngagementAuditLog_chainSeq_key" ON "EngagementAuditLog"("chainSeq");

ALTER TABLE "milestone_audit_logs" ADD COLUMN "chainSeq" INTEGER, ADD COLUMN "prevHash" TEXT, ADD COLUMN "hash" TEXT;
CREATE UNIQUE INDEX "milestone_audit_logs_chainSeq_key" ON "milestone_audit_logs"("chainSeq");

CREATE TABLE "audit_chain_anchors" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "rootHash" TEXT NOT NULL,
    "heads" JSONB NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_chain_anchors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "audit_chain_anchors_day_key" ON "audit_chain_anchors"("day");

-- SEP-24 payouts
CREATE TYPE "PayoutStatus" AS ENUM ('INTERACTIVE', 'PENDING_USER_TRANSFER', 'PENDING_ANCHOR', 'COMPLETED', 'FAILED', 'EXPIRED');

CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "anchorId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "amount" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'INTERACTIVE',
    "anchorTransactionId" TEXT NOT NULL,
    "anchorStatus" TEXT,
    "anchorToken" TEXT NOT NULL,
    "interactiveUrl" TEXT NOT NULL,
    "moreInfoUrl" TEXT,
    "amountIn" TEXT,
    "amountOut" TEXT,
    "amountFee" TEXT,
    "withdrawAnchorAccount" TEXT,
    "withdrawMemo" TEXT,
    "withdrawMemoType" TEXT,
    "stellarTransactionId" TEXT,
    "externalTransactionId" TEXT,
    "message" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payouts_anchorId_anchorTransactionId_key" ON "payouts"("anchorId", "anchorTransactionId");
CREATE INDEX "payouts_recruiterId_createdAt_idx" ON "payouts"("recruiterId", "createdAt");
CREATE INDEX "payouts_status_lastPolledAt_idx" ON "payouts"("status", "lastPolledAt");
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Claimable balance fallback
CREATE TYPE "ClaimableBalanceStatus" AS ENUM ('UNCLAIMED', 'CLAIMED', 'RECLAIMED');

CREATE TABLE "claimable_balances" (
    "id" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "recruiterId" TEXT,
    "recipientAddress" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "milestoneIndex" INTEGER NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "status" "ClaimableBalanceStatus" NOT NULL DEFAULT 'UNCLAIMED',
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastRemindedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "claimable_balances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "claimable_balances_balanceId_key" ON "claimable_balances"("balanceId");
CREATE UNIQUE INDEX "claimable_balances_engagementId_milestoneIndex_key" ON "claimable_balances"("engagementId", "milestoneIndex");
CREATE INDEX "claimable_balances_status_lastRemindedAt_idx" ON "claimable_balances"("status", "lastRemindedAt");
ALTER TABLE "claimable_balances" ADD CONSTRAINT "claimable_balances_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
