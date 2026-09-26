-- CreateTable: recovery_codes
-- Single-use backup codes for 2FA-enabled accounts.
-- The raw code is shown once at generation time; only the SHA-256 hash is stored.

CREATE TABLE "recovery_codes" (
    "id"       TEXT         NOT NULL,
    "userId"   TEXT         NOT NULL,
    "codeHash" TEXT         NOT NULL,
    "usedAt"   TIMESTAMP(3),
    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_codes_userId_idx" ON "recovery_codes"("userId");

-- AddForeignKey
ALTER TABLE "recovery_codes"
    ADD CONSTRAINT "recovery_codes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
