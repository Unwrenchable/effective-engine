-- Migration 010: Newsletter subscribers
--
-- Self-hosted newsletter subscription table — replaces Formspree.
-- Supports multi-site opt-in (main_site / horse_site), unsubscribe tokens,
-- and an audit timestamp so we always know when someone opted out.

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id               SERIAL PRIMARY KEY,
  email            TEXT         NOT NULL,
  source           TEXT         NOT NULL DEFAULT 'horse_site'
                     CHECK (source IN ('main_site', 'horse_site')),
  -- One-time token sent in unsubscribe links; generated on insert.
  unsubscribe_token TEXT        NOT NULL UNIQUE
                     DEFAULT encode(gen_random_bytes(24), 'hex'),
  subscribed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  unsubscribed_at  TIMESTAMPTZ,
  -- Allow the same email to subscribe from multiple sources.
  UNIQUE (email, source)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_email  ON newsletter_subscribers (email);
CREATE INDEX IF NOT EXISTS idx_newsletter_source ON newsletter_subscribers (source);
CREATE INDEX IF NOT EXISTS idx_newsletter_active ON newsletter_subscribers (source, subscribed_at DESC)
  WHERE unsubscribed_at IS NULL;
