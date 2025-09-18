-- Initial schema for NIP-46 persistence

CREATE TABLE IF NOT EXISTS nip46_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_pubkey TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','active','revoked')) DEFAULT 'pending',
  profile_name TEXT,
  profile_url TEXT,
  profile_image TEXT,
  relays TEXT,          -- JSON array string
  policy_methods TEXT,  -- JSON object string
  policy_kinds TEXT,    -- JSON object string
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME,
  UNIQUE(user_id, client_pubkey)
);

CREATE TRIGGER IF NOT EXISTS trg_nip46_sessions_touch_updated_at
AFTER UPDATE ON nip46_sessions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE nip46_sessions
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

CREATE INDEX IF NOT EXISTS idx_nip46_sessions_user ON nip46_sessions(user_id);

CREATE TABLE IF NOT EXISTS nip46_session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_pubkey TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','status_change','grant_method','grant_kind','revoke_method','revoke_kind','upsert')),
  detail TEXT,
  value TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nip46_events_user_pub ON nip46_session_events(user_id, client_pubkey, created_at);
