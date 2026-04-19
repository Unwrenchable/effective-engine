-- Migration 008: Future of real estate schema additions
--
-- Adds tables and columns to support next-generation real estate features
-- that keep the platform fully self-contained:
--
--   blockchain_tx_hash  — on-chain property transfer recording (Ethereum/Avalanche)
--   showings            — self-serve buyer showing scheduler (no Calendly/ShowingTime)
--   documents           — offer/contract tracking (integrates with self-hosted Docuseal)

-- ─── Blockchain title/escrow reference ───────────────────────────────────────
-- Store the transaction hash after a property sale is recorded on-chain.
-- Null until a blockchain transfer is initiated.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS blockchain_tx_hash TEXT;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS blockchain_network TEXT;  -- e.g. 'ethereum', 'avalanche'

CREATE INDEX IF NOT EXISTS idx_listings_blockchain_tx
  ON listings (blockchain_tx_hash)
  WHERE blockchain_tx_hash IS NOT NULL;

-- ─── Showings ─────────────────────────────────────────────────────────────────
-- Buyers self-schedule property showings through the platform.
-- No Calendly, ShowingTime, or other third-party scheduling service required.
CREATE TABLE IF NOT EXISTS showings (
  id              SERIAL PRIMARY KEY,
  listing_id      INTEGER      NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  buyer_user_id   INTEGER      REFERENCES users (id) ON DELETE SET NULL,
  buyer_name      TEXT         NOT NULL,
  buyer_email     TEXT         NOT NULL,
  buyer_phone     TEXT,
  showing_date    DATE         NOT NULL,
  start_time      TIME         NOT NULL,
  end_time        TIME         NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'pending',
  --   pending | confirmed | cancelled | completed
  notes           TEXT,
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_showings_listing_id    ON showings (listing_id);
CREATE INDEX IF NOT EXISTS idx_showings_buyer_user_id ON showings (buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_showings_date          ON showings (showing_date, start_time);
CREATE INDEX IF NOT EXISTS idx_showings_status        ON showings (status);

-- ─── Documents ────────────────────────────────────────────────────────────────
-- Track offer letters, purchase agreements, and supporting documents.
-- Designed to integrate with self-hosted Docuseal (https://www.docuseal.com)
-- or any document-signing solution.  No DocuSign or HelloSign required.
CREATE TABLE IF NOT EXISTS documents (
  id               SERIAL PRIMARY KEY,
  listing_id       INTEGER      REFERENCES listings (id) ON DELETE SET NULL,
  owner_user_id    INTEGER      REFERENCES users (id) ON DELETE SET NULL,
  doc_type         TEXT         NOT NULL,
  --   offer | counter_offer | purchase_agreement | disclosure | addendum | other
  title            TEXT         NOT NULL,
  status           TEXT         NOT NULL DEFAULT 'draft',
  --   draft | sent | signed | voided | expired
  docuseal_id      TEXT,        -- external ID if using Docuseal
  file_path        TEXT,        -- local path under MEDIA_LOCAL_PATH/documents/
  signed_at        TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_listing_id    ON documents (listing_id);
CREATE INDEX IF NOT EXISTS idx_documents_owner_user_id ON documents (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status        ON documents (status);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type      ON documents (doc_type);
