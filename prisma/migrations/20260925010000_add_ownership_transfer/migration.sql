-- Migration: add_ownership_transfer (#360)
-- Adds the OwnershipTransfer table to support the two-step company ownership
-- transfer flow: the current owner initiates, the new owner must accept within
-- 7 days, and the action is recorded in audit_logs.

CREATE TABLE "ownership_transfers" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,  -- FK → users.id of the company owner (the one being replaced)
  "fromOwnerId"  TEXT NOT NULL,  -- current owner user id
  "toMemberId"   TEXT NOT NULL,  -- proposed new owner user id (must be a CompanyMember)
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "acceptedAt"   TIMESTAMP(3),
  "cancelledAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- Only one pending transfer per company at a time
CREATE UNIQUE INDEX "ownership_transfers_companyId_pending"
  ON "ownership_transfers"("companyId")
  WHERE "acceptedAt" IS NULL AND "cancelledAt" IS NULL;

CREATE INDEX "ownership_transfers_companyId_idx"   ON "ownership_transfers"("companyId");
CREATE INDEX "ownership_transfers_toMemberId_idx"  ON "ownership_transfers"("toMemberId");
