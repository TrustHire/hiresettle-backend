-- Enums
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATS_CANDIDATE_HIRED';
CREATE TYPE "AccountingProvider" AS ENUM ('XERO', 'QUICKBOOKS');
CREATE TYPE "AccountingCategory" AS ENUM ('PLATFORM_FEE', 'RECRUITER_FEE');
CREATE TYPE "AccountingSyncStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
CREATE TYPE "AtsProvider" AS ENUM ('GREENHOUSE', 'LEVER');

-- Proof requirements
ALTER TABLE "milestones" ADD COLUMN "proofRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "milestones" ADD COLUMN "readyForProofAt" TIMESTAMP(3);
ALTER TABLE "milestone_proof_versions" ADD COLUMN "requirementEvidence" JSONB;

-- OAuth clients
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "oauth_clients_clientId_key" ON "oauth_clients"("clientId");
CREATE INDEX "oauth_clients_companyId_idx" ON "oauth_clients"("companyId");
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Accounting
CREATE TABLE "accounting_connections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "AccountingProvider" NOT NULL,
    "externalTenantId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "syncFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_connections_companyId_provider_key" ON "accounting_connections"("companyId", "provider");
ALTER TABLE "accounting_connections" ADD CONSTRAINT "accounting_connections_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "accounting_account_mappings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "AccountingProvider" NOT NULL,
    "category" "AccountingCategory" NOT NULL,
    "accountCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_account_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_account_mappings_companyId_provider_category_key"
    ON "accounting_account_mappings"("companyId", "provider", "category");
ALTER TABLE "accounting_account_mappings" ADD CONSTRAINT "accounting_account_mappings_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "accounting_sync_logs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "category" "AccountingCategory" NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "AccountingSyncStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_sync_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_sync_logs_connectionId_category_milestoneId_key"
    ON "accounting_sync_logs"("connectionId", "category", "milestoneId");
CREATE INDEX "accounting_sync_logs_connectionId_status_idx" ON "accounting_sync_logs"("connectionId", "status");
ALTER TABLE "accounting_sync_logs" ADD CONSTRAINT "accounting_sync_logs_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "accounting_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ATS
CREATE TABLE "ats_integrations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "AtsProvider" NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ats_integrations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ats_integrations_companyId_provider_key" ON "ats_integrations"("companyId", "provider");
ALTER TABLE "ats_integrations" ADD CONSTRAINT "ats_integrations_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ats_engagement_mappings" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "externalJobId" TEXT NOT NULL DEFAULT '',
    "externalCandidateId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ats_engagement_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ats_engagement_mappings_integrationId_externalJobId_externalCandidateId_key"
    ON "ats_engagement_mappings"("integrationId", "externalJobId", "externalCandidateId");
CREATE INDEX "ats_engagement_mappings_engagementId_idx" ON "ats_engagement_mappings"("engagementId");
ALTER TABLE "ats_engagement_mappings" ADD CONSTRAINT "ats_engagement_mappings_integrationId_fkey"
    FOREIGN KEY ("integrationId") REFERENCES "ats_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ats_webhook_events" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "engagementId" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ats_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ats_webhook_events_integrationId_payloadHash_key"
    ON "ats_webhook_events"("integrationId", "payloadHash");
ALTER TABLE "ats_webhook_events" ADD CONSTRAINT "ats_webhook_events_integrationId_fkey"
    FOREIGN KEY ("integrationId") REFERENCES "ats_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
