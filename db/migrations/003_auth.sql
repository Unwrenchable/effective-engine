-- Migration 003: Users, roles, API keys

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'consumer',
  -- role values: 'admin' | 'broker' | 'agent' | 'consumer'
  full_name     TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);

-- Sub-licensed IDX API keys (for agents/brokers embedding your search on their sites)
CREATE TABLE api_keys (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key_hash    TEXT    NOT NULL,   -- bcrypt hash of the raw key
  label       TEXT,               -- human label for the key
  scopes      JSONB   NOT NULL DEFAULT '["idx:read"]',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used   TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_user_id ON api_keys (user_id);
