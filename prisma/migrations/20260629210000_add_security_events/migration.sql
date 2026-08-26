-- CreateEnum
CREATE TYPE "SecurityEventAction" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'PASSWORD_RESET', 'EMAIL_VERIFICATION', 'ROLE_CHANGE', 'ADMIN_OVERRIDE');

-- CreateTable: security_events (append-only, issue #87)
CREATE TABLE IF NOT EXISTS "security_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" "SecurityEventAction" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "security_events_userId_idx" ON "security_events"("userId");
CREATE INDEX IF NOT EXISTS "security_events_action_idx" ON "security_events"("action");
CREATE INDEX IF NOT EXISTS "security_events_createdAt_idx" ON "security_events"("createdAt");

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
