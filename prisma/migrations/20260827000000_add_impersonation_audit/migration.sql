-- Add explicit actor and target identities for impersonation audit events.
ALTER TYPE "SecurityEventAction" ADD VALUE 'IMPERSONATION_ISSUED';

ALTER TABLE "security_events" ADD COLUMN "actorId" TEXT;
ALTER TABLE "security_events" ADD COLUMN "targetUserId" TEXT;

CREATE INDEX "security_events_actorId_idx" ON "security_events"("actorId");
CREATE INDEX "security_events_targetUserId_idx" ON "security_events"("targetUserId");

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;