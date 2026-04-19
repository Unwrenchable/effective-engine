-- Migration 007: Local AI — update embedding dimension for self-hosted models
--
-- Changes the description_embedding column from vector(1536) (OpenAI text-embedding-3-small)
-- to vector(768) (Ollama nomic-embed-text — the default self-hosted embedding model).
--
-- IMPORTANT: If you have existing embeddings they will be dropped by this migration.
-- Re-run the AI enrichment job after migrating:
--   node server/sync/ingest.js --full
--
-- If you prefer to keep using OpenAI embeddings (1536-dim) set AI_PROVIDER=openai and
-- change the dimension below to 1536 before running this migration.
--
-- Ollama setup:
--   curl -fsSL https://ollama.com/install.sh | sh
--   ollama pull nomic-embed-text   # 768-dim embeddings
--   ollama pull llama3.2           # chat / descriptions / narratives
--   ollama pull llava              # vision / photo tags

ALTER TABLE listings DROP COLUMN IF EXISTS description_embedding;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS description_embedding vector(768);

DROP INDEX IF EXISTS idx_listings_embedding;

CREATE INDEX IF NOT EXISTS idx_listings_embedding
  ON listings USING ivfflat (description_embedding vector_cosine_ops)
  WITH (lists = 100);
