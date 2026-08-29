-- Migration: create saved_filters table for named engagement filter presets (#253)
CREATE TABLE "saved_filters" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "filters"   JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- Each user can only have one preset with a given name
CREATE UNIQUE INDEX "saved_filters_userId_name_key" ON "saved_filters"("userId", "name");

-- General lookup index
CREATE INDEX "saved_filters_userId_idx" ON "saved_filters"("userId");

-- Foreign key to users
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
