-- Issue #174: per-subscription HMAC signing secret for outgoing webhooks
ALTER TABLE "users" ADD COLUMN "webhookSecret" TEXT;

-- Issue #177: per-user rate-limit override (falls back to default when NULL)
ALTER TABLE "users" ADD COLUMN "rateLimitOverride" INTEGER;

-- Issue #175/#176: track webhook deliveries that exhausted their retries so
-- they are logged instead of silently dropped, and can be resent by an admin.
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('FAILED', 'RESENT');

CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "url" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'FAILED',
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastResendAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries"("status");
CREATE INDEX "webhook_deliveries_userId_idx" ON "webhook_deliveries"("userId");

ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
