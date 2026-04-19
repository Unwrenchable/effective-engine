-- Migration 004: Saved searches (buyer alerts)

CREATE TABLE saved_searches (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  email           TEXT,            -- notification email override
  criteria        JSONB   NOT NULL,
  frequency       TEXT    NOT NULL DEFAULT 'instant',
  -- frequency: 'instant' | 'daily' | 'weekly'
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ
);

CREATE INDEX idx_saved_searches_user_id ON saved_searches (user_id);
CREATE INDEX idx_saved_searches_active  ON saved_searches (is_active) WHERE is_active;

-- Track which listings have already triggered notifications (prevent duplicates)
CREATE TABLE alert_notifications (
  id              SERIAL PRIMARY KEY,
  saved_search_id INTEGER NOT NULL REFERENCES saved_searches (id) ON DELETE CASCADE,
  listing_id      TEXT    NOT NULL,
  notified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (saved_search_id, listing_id)
);

CREATE INDEX idx_alert_notifications_search ON alert_notifications (saved_search_id);
