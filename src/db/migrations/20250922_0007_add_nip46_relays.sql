-- Dedicated relay pool for NIP-46 traffic

CREATE TABLE IF NOT EXISTS nip46_relays (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  relays TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- NOTE: we intentionally avoid an UPDATE-in-trigger pattern here. Application-level
-- helper functions (`setNip46Relays` / `mergeNip46Relays`) already set
-- `updated_at = CURRENT_TIMESTAMP` on every write, so an additional trigger is not
-- required and sidesteps recursion concerns entirely.
