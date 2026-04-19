-- Migration 002: pgvector — semantic search embeddings
-- Requires pgvector extension (pre-installed on Railway, Supabase, Neon, etc.)
-- Install on self-hosted Postgres: https://github.com/pgvector/pgvector

CREATE EXTENSION IF NOT EXISTS vector;

-- Add 1536-dimensional embedding column to listings
-- (matches text-embedding-3-small output dimensions)
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS description_embedding vector(1536);

-- IVFFlat index for approximate nearest-neighbour search
-- lists=100 is a good starting value; increase when you have >100k listings
CREATE INDEX IF NOT EXISTS idx_listings_embedding
  ON listings USING ivfflat (description_embedding vector_cosine_ops)
  WITH (lists = 100);
