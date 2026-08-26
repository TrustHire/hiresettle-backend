-- prisma/migrations/20260727220000_add_engagement_notes_and_webhook_subscriptions/migration.sql
--
-- Adds two new tables:
--   * engagement_notes: internal notes/comments left by participants on an
--     engagement (issue #171).
--   * webhook_subscriptions: per-company registered webhook target URLs
--     (issue #173).

-- CreateTable
CREATE TABLE "engagement_notes" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "engagement_notes_engagementId_idx" ON "engagement_notes"("engagementId");

-- AddForeignKey
ALTER TABLE "engagement_notes" ADD CONSTRAINT "engagement_notes_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_notes" ADD CONSTRAINT "engagement_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_subscriptions_companyId_idx" ON "webhook_subscriptions"("companyId");

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
