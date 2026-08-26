-- GDPR right-to-erasure: add deletedAt to users and create data_deletion_requests table

ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TABLE "data_deletion_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_deletion_requests_processedAt_idx" ON "data_deletion_requests"("processedAt");
