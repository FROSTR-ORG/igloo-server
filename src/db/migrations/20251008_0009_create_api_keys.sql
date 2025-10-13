-- Create API key management table for database mode

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  label TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_admin INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,
  last_used_ip TEXT,
  revoked_at DATETIME,
  revoked_reason TEXT,
  CHECK (length(prefix) >= 12),
  CHECK (length(key_hash) = 64)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_active_prefix ON api_keys(prefix) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used ON api_keys(last_used_at);

CREATE TRIGGER IF NOT EXISTS trg_api_keys_touch_updated_at
AFTER UPDATE ON api_keys
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE api_keys
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
