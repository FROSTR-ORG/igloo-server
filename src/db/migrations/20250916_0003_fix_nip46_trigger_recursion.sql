-- Fix potential infinite recursion in trigger
--
-- The AFTER UPDATE trigger that updates the same table could cause infinite
-- recursion in some SQLite configurations. Since the application already
-- explicitly sets updated_at = CURRENT_TIMESTAMP in all UPDATE queries,
-- we can safely remove the trigger.

-- Drop the problematic trigger
DROP TRIGGER IF EXISTS trg_nip46_sessions_touch_updated_at;

-- Note: The 'revoked' status in the CHECK constraint is kept for backward
-- compatibility, even though revoked sessions are deleted rather than marked.
-- This avoids the need to recreate the table and migrate existing data.