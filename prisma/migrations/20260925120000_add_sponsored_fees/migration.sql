-- CreateTable
CREATE TABLE "sponsored_fees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "innerTxHash" TEXT NOT NULL,
    "feeStroops" BIGINT NOT NULL,
    "feeSource" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsored_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sponsored_fees_txHash_key" ON "sponsored_fees"("txHash");
CREATE INDEX "sponsored_fees_companyId_idx" ON "sponsored_fees"("companyId");
CREATE INDEX "sponsored_fees_createdAt_idx" ON "sponsored_fees"("createdAt");
