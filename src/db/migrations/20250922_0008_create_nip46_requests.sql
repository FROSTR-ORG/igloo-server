-- Pending NIP-46 request queue persisted on the server so headless mode can
-- capture, approve, and resume requests even when the UI is unavailable.

CREATE TABLE IF NOT EXISTS nip46_requests (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_pubkey TEXT NOT NULL,
  method TEXT NOT NULL,
  params TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','completed','failed','expired')) DEFAULT 'pending',
  result TEXT,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_nip46_requests_user_status
  ON nip46_requests(user_id, status, created_at DESC);
