-- Add new notification types
ALTER TYPE "NotificationType" ADD VALUE 'COMMENT_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'WATCHER_ADDED';

-- Add placed candidate details to engagements (#368)
ALTER TABLE "engagements" ADD COLUMN "candidateName" TEXT;
ALTER TABLE "engagements" ADD COLUMN "candidateEmail" TEXT;
ALTER TABLE "engagements" ADD COLUMN "candidatePhone" TEXT;
ALTER TABLE "engagements" ADD COLUMN "candidateStartDate" TIMESTAMP(3);
ALTER TABLE "engagements" ADD COLUMN "candidateRole" TEXT;
ALTER TABLE "engagements" ADD COLUMN "placedAt" TIMESTAMP(3);

-- Create engagement_comments table (#368)
CREATE TABLE "engagement_comments" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagement_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "engagement_comments_engagementId_createdAt_idx" ON "engagement_comments"("engagementId", "createdAt");
CREATE INDEX "engagement_comments_authorId_idx" ON "engagement_comments"("authorId");

ALTER TABLE "engagement_comments" ADD CONSTRAINT "engagement_comments_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engagement_comments" ADD CONSTRAINT "engagement_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create engagement_watchers table (#369)
CREATE TABLE "engagement_watchers" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_watchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "engagement_watchers_engagementId_userId_key" ON "engagement_watchers"("engagementId", "userId");
CREATE INDEX "engagement_watchers_userId_idx" ON "engagement_watchers"("userId");
CREATE INDEX "engagement_watchers_engagementId_idx" ON "engagement_watchers"("engagementId");

ALTER TABLE "engagement_watchers" ADD CONSTRAINT "engagement_watchers_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engagement_watchers" ADD CONSTRAINT "engagement_watchers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engagement_watchers" ADD CONSTRAINT "engagement_watchers_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
