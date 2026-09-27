-- Migration: add tags string array to engagements table (#252)
ALTER TABLE "engagements" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

-- GIN index to support efficient array-contains queries
CREATE INDEX "engagements_tags_idx" ON "engagements" USING GIN ("tags");

-- Full-text search support (#373): generated tsvector across title, description and tags
ALTER TABLE "engagements"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string("tags", ' '), '')), 'C')
  ) STORED;

-- GIN index to support ranked full-text search queries
CREATE INDEX "engagements_search_vector_idx" ON "engagements" USING GIN ("search_vector");
