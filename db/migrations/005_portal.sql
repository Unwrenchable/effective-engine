-- Migration 005: Agent portal — inquiries, leads, showings

CREATE TABLE inquiries (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  message       TEXT NOT NULL,
  listing_id    TEXT,   -- MLS# if inquiry is about a specific listing
  inquiry_type  TEXT NOT NULL DEFAULT 'general',
  -- type: 'showing' | 'info' | 'offer' | 'general'
  status        TEXT NOT NULL DEFAULT 'new',
  -- status: 'new' | 'contacted' | 'qualified' | 'closed'
  assigned_to   INTEGER REFERENCES users (id),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inquiries_listing_id  ON inquiries (listing_id);
CREATE INDEX idx_inquiries_status      ON inquiries (status);
CREATE INDEX idx_inquiries_created_at  ON inquiries (created_at DESC);

-- Off-market / pocket listings (exclusive to platform agents)
-- Must comply with NAR Clear Cooperation Policy
CREATE TABLE pocket_listings (
  id                   SERIAL PRIMARY KEY,
  agent_user_id        INTEGER NOT NULL REFERENCES users (id),
  address              TEXT NOT NULL,
  city                 TEXT,
  postal_code          TEXT,
  list_price           NUMERIC(12,2),
  bedrooms_total       SMALLINT,
  bathrooms_total      NUMERIC(4,1),
  living_area          NUMERIC(10,2),
  property_type        TEXT,
  description          TEXT,
  photos               JSONB,          -- [{url, cdn_url, order}]
  status               TEXT NOT NULL DEFAULT 'active',
  -- MLS compliance: days before mandatory MLS submission under Clear Cooperation
  clear_cooperation_deadline DATE,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pocket_listings_agent   ON pocket_listings (agent_user_id);
CREATE INDEX idx_pocket_listings_status  ON pocket_listings (status) WHERE is_active;
