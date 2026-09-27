-- CreateTable
CREATE TABLE "AdminUserNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUserNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminUserNote_userId_idx" ON "AdminUserNote"("userId");

-- CreateIndex
CREATE INDEX "AdminUserNote_authorId_idx" ON "AdminUserNote"("authorId");

-- AddForeignKey
ALTER TABLE "AdminUserNote" ADD CONSTRAINT "AdminUserNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUserNote" ADD CONSTRAINT "AdminUserNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
