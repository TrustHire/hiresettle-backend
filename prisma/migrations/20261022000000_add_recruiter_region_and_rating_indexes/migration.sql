-- AlterTable
ALTER TABLE "users" ADD COLUMN "region" TEXT,
ADD COLUMN "averageRating" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "users_region_idx" ON "users"("region");

-- CreateIndex
CREATE INDEX "users_averageRating_idx" ON "users"("averageRating");

-- CreateIndex
CREATE INDEX "users_role_deactivatedAt_region_averageRating_idx" ON "users"("role", "deactivatedAt", "region", "averageRating");

-- CreateIndex
CREATE INDEX "recruiter_reviews_recruiterId_rating_idx" ON "recruiter_reviews"("recruiterId", "rating");

-- CreateIndex
CREATE INDEX "recruiter_reviews_rating_idx" ON "recruiter_reviews"("rating");
