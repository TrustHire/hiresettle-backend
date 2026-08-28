-- Add companyOwnerId to users so sub-users can be linked to the inviting company owner
ALTER TABLE "users" ADD COLUMN "companyOwnerId" TEXT;

-- CreateTable: team_invites
CREATE TABLE "team_invites" (
    "id"             TEXT         NOT NULL,
    "companyOwnerId" TEXT         NOT NULL,
    "email"          TEXT         NOT NULL,
    "token"          TEXT         NOT NULL,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "acceptedAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_invites_token_key" ON "team_invites"("token");
CREATE INDEX "team_invites_companyOwnerId_idx" ON "team_invites"("companyOwnerId");
CREATE INDEX "team_invites_email_idx" ON "team_invites"("email");
CREATE INDEX "team_invites_token_idx" ON "team_invites"("token");

-- AddForeignKey
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_companyOwnerId_fkey"
    FOREIGN KEY ("companyOwnerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
