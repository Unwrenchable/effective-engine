-- Migration 001: Core schema
-- Tables: listings, listing_media, open_houses, agents, offices, sync_state

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Listings ─────────────────────────────────────────────────────────────────
CREATE TABLE listings (
  id                       SERIAL PRIMARY KEY,
  listing_id               TEXT        NOT NULL UNIQUE,   -- MLS# / ListingId
  mls_status               TEXT        NOT NULL,          -- Active, Closed, etc.
  list_price               NUMERIC(12,2),
  original_list_price      NUMERIC(12,2),

  -- Address
  street_number            TEXT,
  street_name              TEXT,
  unit_number              TEXT,
  city                     TEXT,
  state_or_province        TEXT        DEFAULT 'NV',
  postal_code              TEXT,
  county                   TEXT,
  subdivision_name         TEXT,

  -- Geo (WGS84 point, populated from Latitude/Longitude fields)
  latitude                 DOUBLE PRECISION,
  longitude                DOUBLE PRECISION,
  location                 geometry(Point, 4326),   -- PostGIS spatial column

  -- Key facts
  bedrooms_total           SMALLINT,
  bathrooms_total          NUMERIC(4,1),
  bathrooms_full           SMALLINT,
  bathrooms_half           SMALLINT,
  living_area              NUMERIC(10,2),   -- sq ft
  lot_size_sqft            NUMERIC(12,2),
  lot_size_acres           NUMERIC(10,4),

  property_type            TEXT,
  property_sub_type        TEXT,
  year_built               SMALLINT,
  garage_spaces            SMALLINT,
  pool_yn                  BOOLEAN     DEFAULT FALSE,
  spa_yn                   BOOLEAN     DEFAULT FALSE,
  view_yn                  BOOLEAN     DEFAULT FALSE,
  view_description         TEXT,

  -- HOA
  hoa_fee                  NUMERIC(10,2),
  hoa_fee_frequency        TEXT,

  -- Agent / Office (display-safe fields only — no seller info)
  list_office_name         TEXT,
  list_office_mls_id       TEXT,
  list_agent_full_name     TEXT,
  list_agent_mls_id        TEXT,

  -- Timestamps
  listing_contract_date    DATE,
  on_market_date           DATE,
  modification_timestamp   TIMESTAMPTZ,
  synced_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Remarks / features
  public_remarks           TEXT,
  community_features       TEXT,
  interior_features        TEXT,
  exterior_features        TEXT,
  heating                  TEXT,
  cooling                  TEXT,
  fireplace_yn             BOOLEAN     DEFAULT FALSE,
  fireplaces_total         SMALLINT,
  laundry_features         TEXT,
  parking_features         TEXT,
  roof                     TEXT,
  foundation_details       TEXT,

  -- Compliance
  idx_display_allowed      BOOLEAN     DEFAULT TRUE,
  attribution_courtesy_of  TEXT,
  attribution_disclaimer   TEXT,

  -- AI-generated fields (populated asynchronously)
  ai_description           TEXT,
  ai_photo_tags            JSONB
);

CREATE INDEX idx_listings_mls_status     ON listings (mls_status);
CREATE INDEX idx_listings_city           ON listings (city);
CREATE INDEX idx_listings_postal_code    ON listings (postal_code);
CREATE INDEX idx_listings_list_price     ON listings (list_price);
CREATE INDEX idx_listings_on_market_date ON listings (on_market_date DESC);
CREATE INDEX idx_listings_agent_mls_id   ON listings (list_agent_mls_id);
CREATE INDEX idx_listings_location       ON listings USING GIST (location);
CREATE INDEX idx_listings_ai_photo_tags  ON listings USING GIN (ai_photo_tags);

-- ─── Listing media ────────────────────────────────────────────────────────────
CREATE TABLE listing_media (
  id           SERIAL PRIMARY KEY,
  listing_id   INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  original_url TEXT    NOT NULL,
  cdn_url      TEXT    NOT NULL,
  media_type   TEXT    NOT NULL DEFAULT 'photo',  -- 'photo' | 'video' | 'document'
  media_order  SMALLINT NOT NULL DEFAULT 0,
  caption      TEXT
);

CREATE INDEX idx_listing_media_listing_id ON listing_media (listing_id, media_order);

-- ─── Open houses ─────────────────────────────────────────────────────────────
CREATE TABLE open_houses (
  id              SERIAL PRIMARY KEY,
  listing_id      INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  open_house_date DATE    NOT NULL,
  start_time      TIME,
  end_time        TIME,
  remarks         TEXT
);

CREATE INDEX idx_open_houses_listing_id ON open_houses (listing_id);
CREATE INDEX idx_open_houses_date       ON open_houses (open_house_date);

-- ─── Price history / CDC ──────────────────────────────────────────────────────
CREATE TABLE price_history (
  id           SERIAL PRIMARY KEY,
  listing_id   INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  price        NUMERIC(12,2) NOT NULL,
  event_type   TEXT    NOT NULL,   -- 'initial', 'price_change', 'sold', 'expired'
  event_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, event_type, price, event_date)
);

CREATE INDEX idx_price_history_listing_id ON price_history (listing_id, event_date DESC);

-- ─── CDC event log ────────────────────────────────────────────────────────────
CREATE TABLE cdc_log (
  id          BIGSERIAL PRIMARY KEY,
  listing_id  TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  details     JSONB,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cdc_log_listing_id  ON cdc_log (listing_id);
CREATE INDEX idx_cdc_log_event_type  ON cdc_log (event_type);
CREATE INDEX idx_cdc_log_recorded_at ON cdc_log (recorded_at DESC);

-- ─── Agents ───────────────────────────────────────────────────────────────────
CREATE TABLE agents (
  id           SERIAL PRIMARY KEY,
  mls_id       TEXT   NOT NULL UNIQUE,
  full_name    TEXT,
  email        TEXT,
  phone        TEXT,
  office_name  TEXT,
  office_mls_id TEXT,
  photo_url    TEXT,
  bio          TEXT,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Offices ──────────────────────────────────────────────────────────────────
CREATE TABLE offices (
  id          SERIAL PRIMARY KEY,
  mls_id      TEXT NOT NULL UNIQUE,
  name        TEXT,
  phone       TEXT,
  address     TEXT,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Sync state ───────────────────────────────────────────────────────────────
CREATE TABLE sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Market snapshots ─────────────────────────────────────────────────────────
CREATE TABLE market_snapshots (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL,
  narrative    TEXT,
  stats_json   JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_snapshots_slug ON market_snapshots (slug, generated_at DESC);
