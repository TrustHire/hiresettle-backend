ALTER TABLE "users" ADD COLUMN "verifiedAt" TIMESTAMP(3);

ALTER TABLE "companies" ADD COLUMN "emailDomain" TEXT;
ALTER TABLE "companies" ADD COLUMN "domainVerificationToken" TEXT;
ALTER TABLE "companies" ADD COLUMN "domainVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "companies_emailDomain_key" ON "companies"("emailDomain");
