-- Backfill existing installs so nip46_relays gains the current constraints and
-- nip46_requests can dedupe by a stored client request id.

CREATE TABLE nip46_relays_tmp (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  relays TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO nip46_relays_tmp (user_id, relays, created_at, updated_at)
SELECT
  user_id,
  COALESCE(NULLIF(relays, ''), '[]'),
  COALESCE(created_at, CURRENT_TIMESTAMP),
  COALESCE(updated_at, CURRENT_TIMESTAMP)
FROM nip46_relays;

DROP TABLE nip46_relays;
ALTER TABLE nip46_relays_tmp RENAME TO nip46_relays;

ALTER TABLE nip46_requests ADD COLUMN client_request_id TEXT;

UPDATE nip46_requests
SET client_request_id = TRIM(CAST(json_extract(params, '$.id') AS TEXT))
WHERE client_request_id IS NULL
  AND json_valid(params)
  AND json_type(params, '$.id') IS NOT NULL;

DELETE FROM nip46_requests
WHERE rowid IN (
  SELECT older.rowid
  FROM nip46_requests AS older
  JOIN nip46_requests AS newer
    ON newer.user_id = older.user_id
   AND newer.session_pubkey = older.session_pubkey
   AND newer.client_request_id = older.client_request_id
   AND newer.status = 'pending'
   AND older.status = 'pending'
   AND newer.client_request_id IS NOT NULL
   AND (
     newer.created_at > older.created_at
     OR (newer.created_at = older.created_at AND newer.id > older.id)
   )
);

DROP INDEX IF EXISTS idx_nip46_requests_dedupe;

CREATE UNIQUE INDEX IF NOT EXISTS idx_nip46_requests_pending_dedupe
  ON nip46_requests(user_id, session_pubkey, client_request_id)
  WHERE status = 'pending' AND client_request_id IS NOT NULL;
