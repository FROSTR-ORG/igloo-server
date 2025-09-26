-- Persist a stable NIP-46 transport private key per user

CREATE TABLE IF NOT EXISTS nip46_transport_keys (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  transport_sk TEXT NOT NULL, -- 32-byte hex (64 chars)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_nip46_transport_keys_touch_updated_at
AFTER UPDATE ON nip46_transport_keys
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE nip46_transport_keys
  SET updated_at = CURRENT_TIMESTAMP
  WHERE user_id = NEW.user_id;
END;

