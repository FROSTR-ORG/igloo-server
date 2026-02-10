-- UI event log persistence (DB mode)
-- Stores every UI-visible server log entry for backscroll + auditability.
-- Payloads are de-duplicated by sha256 hash to reduce space without losing entries.

CREATE TABLE IF NOT EXISTS ui_event_log_blobs (
  hash TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ui_event_log_entries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at_ms INTEGER NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  -- Optional payload reference (JSON stored in ui_event_log_blobs)
  data_hash TEXT REFERENCES ui_event_log_blobs(hash),
  data_preview TEXT,
  data_bytes INTEGER,
  -- Original event id emitted by the server (pre-persistence). Useful for debugging.
  source_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_ui_event_log_entries_created_at_ms ON ui_event_log_entries(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_ui_event_log_entries_type_seq ON ui_event_log_entries(type, seq DESC);
CREATE INDEX IF NOT EXISTS idx_ui_event_log_entries_seq ON ui_event_log_entries(seq DESC);

