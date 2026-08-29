-- Migration: add placementDueAt and reminderSent to milestones (#260)
ALTER TABLE "milestones" ADD COLUMN "placementDueAt" TIMESTAMP(3);
ALTER TABLE "milestones" ADD COLUMN "reminderSent"   BOOLEAN NOT NULL DEFAULT false;

-- Index for the scheduler query: find PLACEMENT milestones with dueAt approaching and not yet reminded
CREATE INDEX "milestones_placementDueAt_reminderSent_idx"
    ON "milestones"("placementDueAt", "reminderSent")
    WHERE "placementDueAt" IS NOT NULL AND "reminderSent" = false;
