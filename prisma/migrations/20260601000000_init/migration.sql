-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('COMPANY', 'RECRUITER', 'ARBITER', 'ADMIN');

-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'REPLACEMENT_REQUESTED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('LOCKED', 'PENDING', 'PROOF_SUBMITTED', 'CONFIRMED', 'DISPUTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MilestoneKind" AS ENUM ('PLACEMENT', 'RETENTION');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'ENGAGEMENT_CREATED',
  'MILESTONE_UNLOCKED',
  'PROOF_SUBMITTED',
  'MILESTONE_CONFIRMED',
  'DISPUTE_RAISED',
  'DISPUTE_RESOLVED',
  'REPLACEMENT_REQUESTED',
  'ENGAGEMENT_CANCELLED',
  'PAYMENT_RELEASED',
  'RETENTION_WINDOW_APPROACHING',
  'ARBITER_ASSIGNED',
  'ARBITER_REASSIGNED',
  'ARBITER_RECUSAL_REQUESTED'
);

-- CreateTable: users (base columns; subsequent migrations add passwordHash, deactivatedAt, avatarUrl)
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "stellarAddress" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "company" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'COMPANY',
    "webhookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_stellarAddress_key" ON "users"("stellarAddress");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateTable: engagements
CREATE TABLE "engagements" (
    "id" TEXT NOT NULL,
    "companyAddress" TEXT NOT NULL,
    "recruiterAddress" TEXT NOT NULL,
    "arbiterAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "totalAmount" BIGINT NOT NULL,
    "releasedAmount" BIGINT NOT NULL DEFAULT 0,
    "jobTitle" TEXT NOT NULL,
    "jobDescription" TEXT,
    "salaryRange" TEXT,
    "location" TEXT,
    "status" "EngagementStatus" NOT NULL DEFAULT 'ACTIVE',
    "txHash" TEXT,
    "createdLedger" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "engagements" ADD CONSTRAINT "engagements_companyAddress_fkey"
    FOREIGN KEY ("companyAddress") REFERENCES "users"("stellarAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engagements" ADD CONSTRAINT "engagements_recruiterAddress_fkey"
    FOREIGN KEY ("recruiterAddress") REFERENCES "users"("stellarAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engagements" ADD CONSTRAINT "engagements_arbiterAddress_fkey"
    FOREIGN KEY ("arbiterAddress") REFERENCES "users"("stellarAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: milestones
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "milestoneIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MilestoneKind" NOT NULL,
    "paymentPercent" INTEGER NOT NULL,
    "retentionDays" INTEGER,
    "validAfterLedger" INTEGER,
    "unlockEstimatedAt" TIMESTAMP(3),
    "proofHash" TEXT,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReleased" BIGINT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "milestones_engagementId_milestoneIndex_key" ON "milestones"("engagementId", "milestoneIndex");

ALTER TABLE "milestones" ADD CONSTRAINT "milestones_engagementId_fkey"
    FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: chain_events
CREATE TABLE "chain_events" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT,
    "eventName" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chain_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chain_events_engagementId_idx" ON "chain_events"("engagementId");
CREATE INDEX "chain_events_eventName_idx" ON "chain_events"("eventName");
CREATE INDEX "chain_events_processed_idx" ON "chain_events"("processed");

ALTER TABLE "chain_events" ADD CONSTRAINT "chain_events_engagementId_fkey"
    FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: system_config
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable: dead_letter_events
CREATE TABLE "dead_letter_events" (
    "id" TEXT NOT NULL,
    "originalId" TEXT NOT NULL,
    "engagementId" TEXT,
    "eventName" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dead_letter_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dead_letter_events_originalId_key" ON "dead_letter_events"("originalId");
CREATE INDEX "dead_letter_events_eventName_idx" ON "dead_letter_events"("eventName");
CREATE INDEX "dead_letter_events_engagementId_idx" ON "dead_letter_events"("engagementId");

-- CreateTable: notifications
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");
CREATE INDEX "notifications_read_idx" ON "notifications"("read");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: audit_logs
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "audit_logs_changedBy_idx" ON "audit_logs"("changedBy");

-- CreateTable: retention_schedules
CREATE TABLE "retention_schedules" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "milestoneIndex" INTEGER NOT NULL,
    "validAfterLedger" INTEGER NOT NULL,
    "unlockAt" TIMESTAMP(3) NOT NULL,
    "notifyAt" TIMESTAMP(3) NOT NULL,
    "unlocked" BOOLEAN NOT NULL DEFAULT false,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retention_schedules_engagementId_milestoneIndex_key" ON "retention_schedules"("engagementId", "milestoneIndex");
CREATE INDEX "retention_schedules_unlockAt_idx" ON "retention_schedules"("unlockAt");
CREATE INDEX "retention_schedules_notifyAt_idx" ON "retention_schedules"("notifyAt");
CREATE INDEX "retention_schedules_unlocked_idx" ON "retention_schedules"("unlocked");
