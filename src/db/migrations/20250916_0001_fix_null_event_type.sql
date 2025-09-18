-- Fix NULL handling in event_type validation triggers
-- Previous triggers would allow NULL event_type to pass through
-- because "NULL NOT IN (...)" evaluates to NULL, not FALSE

DROP TRIGGER IF EXISTS nip46_events_check_insert;
CREATE TRIGGER nip46_events_check_insert
BEFORE INSERT ON nip46_session_events
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.event_type IS NULL OR NEW.event_type NOT IN ('created','status_change','grant_method','grant_kind','revoke_method','revoke_kind','upsert')
    THEN RAISE(ABORT, 'invalid event_type') END;
END;

DROP TRIGGER IF EXISTS nip46_events_check_update;
CREATE TRIGGER nip46_events_check_update
BEFORE UPDATE OF event_type ON nip46_session_events
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.event_type IS NULL OR NEW.event_type NOT IN ('created','status_change','grant_method','grant_kind','revoke_method','revoke_kind','upsert')
    THEN RAISE(ABORT, 'invalid event_type') END;
END;