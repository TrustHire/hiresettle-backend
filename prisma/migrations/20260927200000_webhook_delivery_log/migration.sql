-- Webhook delivery log for subscribers (#397)
--
-- Deliveries are now recorded per subscription for both successful and
-- failed attempts, including the receiver's HTTP response code.

-- AlterEnum
ALTER TYPE "WebhookDeliveryStatus" ADD VALUE IF NOT EXISTS 'SUCCEEDED';

-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN "subscriptionId" TEXT;
ALTER TABLE "webhook_deliveries" ADD COLUMN "responseCode" INTEGER;

-- CreateIndex
CREATE INDEX "webhook_deliveries_subscriptionId_createdAt_idx" ON "webhook_deliveries"("subscriptionId", "createdAt");
