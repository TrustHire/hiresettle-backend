-- CreateTable: trusted_devices
-- Records devices that have completed a successful 2FA login and been granted
-- a skip-2FA window (default 30 days, configurable via TRUSTED_DEVICE_TTL_DAYS).
-- The raw token is issued once to the client; only the SHA-256 hash is stored.

CREATE TABLE "trusted_devices" (
    "id"         TEXT         NOT NULL,
    "userId"     TEXT         NOT NULL,
    "tokenHash"  TEXT         NOT NULL,
    "name"       TEXT,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "revokedAt"  TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_tokenHash_key" ON "trusted_devices"("tokenHash");
CREATE INDEX "trusted_devices_userId_idx"    ON "trusted_devices"("userId");
CREATE INDEX "trusted_devices_tokenHash_idx" ON "trusted_devices"("tokenHash");

-- AddForeignKey
ALTER TABLE "trusted_devices"
    ADD CONSTRAINT "trusted_devices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
