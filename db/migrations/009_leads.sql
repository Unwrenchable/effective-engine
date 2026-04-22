-- Migration 009: Lead capture enhancements + inquiry message threads
--
-- Adds lead source tagging, listing-update opt-in, status audit columns,
-- and an inquiry_messages table for chat-style threaded conversations.

-- ─── Extend inquiries table ───────────────────────────────────────────────────

-- Tag where the lead came from (main site vs horse site)
ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS lead_source TEXT NOT NULL DEFAULT 'main_site'
    CHECK (lead_source IN ('main_site', 'horse_site'));

-- Opt-in flag: visitor asked to receive new-listing update emails
ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS subscribe_to_updates BOOLEAN NOT NULL DEFAULT FALSE;

-- Audit: who changed the status and when
ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS status_changed_at   TIMESTAMPTZ;
ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS status_changed_by   INTEGER REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inquiries_lead_source ON inquiries (lead_source);

-- ─── Inquiry message threads ─────────────────────────────────────────────────
-- Each row is one message in the conversation history for a given inquiry.
-- direction: 'inbound'  = message from the lead (captured at submit time)
--            'outbound' = reply/note added by Donna / admin staff
CREATE TABLE IF NOT EXISTS inquiry_messages (
  id           SERIAL PRIMARY KEY,
  inquiry_id   INTEGER      NOT NULL REFERENCES inquiries (id) ON DELETE CASCADE,
  direction    TEXT         NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body         TEXT         NOT NULL,
  author_id    INTEGER      REFERENCES users (id) ON DELETE SET NULL,
  -- author_id is NULL for inbound messages from the public contact form
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inq_messages_inquiry_id ON inquiry_messages (inquiry_id, created_at);
