-- Migration 006: Compliance audit log
-- Required by MLS data agreements to prove IDX display compliance

CREATE TABLE compliance_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  listing_id    TEXT,
  action        TEXT    NOT NULL,
  -- action: 'displayed'|'redacted'|'opted_out'|'expired'|'photo_capped'
  consumer_ip   TEXT,
  user_agent    TEXT,
  details       JSONB,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_compliance_audit_listing   ON compliance_audit_log (listing_id);
CREATE INDEX idx_compliance_audit_action    ON compliance_audit_log (action);
CREATE INDEX idx_compliance_audit_recorded  ON compliance_audit_log (recorded_at DESC);

-- Partition by month for scalability (optional — enable once at high volume)
-- CREATE TABLE compliance_audit_log_y2025m01 PARTITION OF compliance_audit_log
--   FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- IDX display sessions: track per-session compliance for MLS reporting
CREATE TABLE idx_sessions (
  id           BIGSERIAL PRIMARY KEY,
  session_id   TEXT    NOT NULL,
  user_id      INTEGER REFERENCES users (id),
  api_key_id   INTEGER REFERENCES api_keys (id),
  listings_shown JSONB,   -- array of listing_ids shown
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ
);

CREATE INDEX idx_sessions_session ON idx_sessions (session_id);
CREATE INDEX idx_sessions_started ON idx_sessions (started_at DESC);
