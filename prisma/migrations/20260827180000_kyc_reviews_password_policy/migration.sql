-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: recruiter KYC fields on users
ALTER TABLE "users" ADD COLUMN "kycStatus" "KycStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "users" ADD COLUMN "kycReviewedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "kycReviewedBy" TEXT;
ALTER TABLE "users" ADD COLUMN "kycRejectionReason" TEXT;

-- CreateIndex
CREATE INDEX "users_kycStatus_idx" ON "users"("kycStatus");

-- CreateTable: KYC documents
CREATE TABLE "kyc_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "s3Path" TEXT NOT NULL,
    "s3Url" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kyc_documents_userId_idx" ON "kyc_documents"("userId");

ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: recruiter reviews
CREATE TABLE "recruiter_reviews" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruiter_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recruiter_reviews_engagementId_key" ON "recruiter_reviews"("engagementId");
CREATE INDEX "recruiter_reviews_recruiterId_idx" ON "recruiter_reviews"("recruiterId");
CREATE INDEX "recruiter_reviews_reviewerId_idx" ON "recruiter_reviews"("reviewerId");

ALTER TABLE "recruiter_reviews" ADD CONSTRAINT "recruiter_reviews_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recruiter_reviews" ADD CONSTRAINT "recruiter_reviews_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recruiter_reviews" ADD CONSTRAINT "recruiter_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
