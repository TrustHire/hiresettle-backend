-- #250: Add PENDING_ACCEPTANCE to EngagementStatus enum
ALTER TYPE "EngagementStatus" ADD VALUE 'PENDING_ACCEPTANCE';

-- #251: Add customFields column to engagements
ALTER TABLE "engagements" ADD COLUMN "customFields" JSONB;

-- #251: Add allowedCustomFields column to users (for COMPANY role)
ALTER TABLE "users" ADD COLUMN "allowedCustomFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- #244: Create favorite_recruiters table
CREATE TABLE "favorite_recruiters" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_recruiters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "favorite_recruiters_companyId_recruiterId_key" ON "favorite_recruiters"("companyId", "recruiterId");
CREATE INDEX "favorite_recruiters_companyId_idx" ON "favorite_recruiters"("companyId");

ALTER TABLE "favorite_recruiters" ADD CONSTRAINT "favorite_recruiters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "favorite_recruiters" ADD CONSTRAINT "favorite_recruiters_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- #242: Create CompanyRole enum
CREATE TYPE "CompanyRole" AS ENUM ('OWNER', 'MEMBER', 'BILLING');

-- #242: Create company_members table
CREATE TABLE "company_members" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "companyRole" "CompanyRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_members_companyId_memberId_key" ON "company_members"("companyId", "memberId");
CREATE INDEX "company_members_companyId_idx" ON "company_members"("companyId");
CREATE INDEX "company_members_memberId_idx" ON "company_members"("memberId");

ALTER TABLE "company_members" ADD CONSTRAINT "company_members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
