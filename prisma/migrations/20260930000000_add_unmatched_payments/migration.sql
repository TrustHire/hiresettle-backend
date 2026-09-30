-- Migration: add_unmatched_payments
-- Adds UnmatchedPayment table for incoming Stellar deposits that could not
-- be reconciled to an engagement (wrong/missing memo), and tracks the last
-- Horizon cursor so the poller resumes across restarts.

-- Enum for review status
CREATE TYPE "UnmatchedPaymentStatus" AS ENUM ('PENDING', 'MATCHED', 'REFUNDED', 'IGNORED');

-- New notification type for unmatched payment alerts
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'UNMATCHED_PAYMENT_ALERT';

-- Table to store unmatched incoming payments
CREATE TABLE "unmatched_payments" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "txHash"         TEXT        NOT NULL,
  "sender"         TEXT        NOT NULL,
  "assetCode"      TEXT        NOT NULL,
  "assetIssuer"    TEXT,
  "amount"         TEXT        NOT NULL,   -- human-readable amount from Horizon
  "memo"           TEXT,                   -- raw memo value; NULL if absent
  "memoType"       TEXT,                   -- 'text' | 'id' | 'hash' | 'return' | NULL
  "ledger"         INTEGER     NOT NULL    DEFAULT 0,
  "status"         "UnmatchedPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "matchedEngagementId" TEXT,             -- set when an admin manually matches
  "resolvedBy"     TEXT,                   -- admin userId who resolved
  "resolvedAt"     TIMESTAMP(3),
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL   DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL   DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "unmatched_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unmatched_payments_txHash_key" ON "unmatched_payments"("txHash");
CREATE INDEX "unmatched_payments_status_idx" ON "unmatched_payments"("status");
CREATE INDEX "unmatched_payments_sender_idx" ON "unmatched_payments"("sender");
CREATE INDEX "unmatched_payments_createdAt_idx" ON "unmatched_payments"("createdAt");

-- Persist the last Horizon payments cursor per watched address so the poller
-- survives restarts without reprocessing the entire history.
-- Reuses the existing system_config key-value store.
-- (No schema change needed — SystemConfig already exists.)
