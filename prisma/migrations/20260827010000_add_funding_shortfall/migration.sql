-- Track the observed escrow balance and funding shortfall state.
ALTER TABLE "engagements" ADD COLUMN "fundingShortfall" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "engagements" ADD COLUMN "escrowBalance" BIGINT;

ALTER TYPE "NotificationType" ADD VALUE 'FUNDING_SHORTFALL_DETECTED';