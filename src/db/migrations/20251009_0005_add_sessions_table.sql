-- Minimal session persistence for DB-backed auth
-- Stores only what is required for authorization; no secrets/derived keys

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_access DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_access ON sessions(last_access);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

