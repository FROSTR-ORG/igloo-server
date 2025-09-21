-- Migration: Add rate_limits table for persistent rate limiting
-- Purpose: Replace in-memory rate limiting to prevent bypass via server restart
-- Date: 2025-09-16

CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,         -- IP address, fingerprint, or user ID
  bucket TEXT NOT NULL,             -- Rate limit bucket (e.g., 'auth', 'onboarding', 'nip46')
  count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 0), -- Number of attempts in current window
  window_start INTEGER NOT NULL,    -- Unix timestamp (ms) when window started
  last_attempt INTEGER NOT NULL,    -- Unix timestamp (ms) of last attempt
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Composite unique index on identifier+bucket for fast lookups and upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_identifier_bucket
  ON rate_limits(identifier, bucket);

-- Index on window_start for efficient cleanup of expired entries
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start
  ON rate_limits(window_start);

-- Index on last_attempt for time-based queries
CREATE INDEX IF NOT EXISTS idx_rate_limits_last_attempt
  ON rate_limits(last_attempt);

CREATE TRIGGER IF NOT EXISTS update_rate_limits_timestamp
  AFTER UPDATE ON rate_limits
  FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE rate_limits
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
  END;
