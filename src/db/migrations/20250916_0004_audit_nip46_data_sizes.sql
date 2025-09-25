-- Audit NIP-46 session data sizes to identify potential truncation issues
--
-- This migration creates a temporary audit table to track sessions
-- with large data fields that might be at risk of truncation.
-- The MAX_JSON_FIELD_SIZE limit has been increased from 10KB to 50KB.

-- Create audit table for tracking data sizes
CREATE TABLE IF NOT EXISTS nip46_data_audit (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  user_id INTEGER,
  client_pubkey TEXT,
  relay_size INTEGER,
  methods_size INTEGER,
  kinds_size INTEGER,
  total_size INTEGER,
  has_risk_old_limit BOOLEAN,  -- Would have been truncated with 10KB limit
  has_risk_new_limit BOOLEAN,  -- Would be truncated with 50KB limit
  audited_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit existing sessions
INSERT INTO nip46_data_audit (
  session_id,
  user_id,
  client_pubkey,
  relay_size,
  methods_size,
  kinds_size,
  total_size,
  has_risk_old_limit,
  has_risk_new_limit
)
SELECT
  id,
  user_id,
  client_pubkey,
  CASE WHEN relays IS NOT NULL THEN LENGTH(relays) ELSE 0 END as relay_size,
  CASE WHEN policy_methods IS NOT NULL THEN LENGTH(policy_methods) ELSE 0 END as methods_size,
  CASE WHEN policy_kinds IS NOT NULL THEN LENGTH(policy_kinds) ELSE 0 END as kinds_size,
  CASE
    WHEN relays IS NOT NULL OR policy_methods IS NOT NULL OR policy_kinds IS NOT NULL
    THEN COALESCE(LENGTH(relays), 0) + COALESCE(LENGTH(policy_methods), 0) + COALESCE(LENGTH(policy_kinds), 0)
    ELSE 0
  END as total_size,
  -- Check if any field would exceed old 10KB limit
  CASE
    WHEN COALESCE(LENGTH(relays), 0) > 10000
      OR COALESCE(LENGTH(policy_methods), 0) > 10000
      OR COALESCE(LENGTH(policy_kinds), 0) > 10000
    THEN 1
    ELSE 0
  END as has_risk_old_limit,
  -- Check if any field would exceed new 50KB limit
  CASE
    WHEN COALESCE(LENGTH(relays), 0) > 50000
      OR COALESCE(LENGTH(policy_methods), 0) > 50000
      OR COALESCE(LENGTH(policy_kinds), 0) > 50000
    THEN 1
    ELSE 0
  END as has_risk_new_limit
FROM nip46_sessions;

-- Report summary
SELECT
  'NIP-46 Data Size Audit Summary' as report,
  COUNT(*) as total_sessions,
  SUM(has_risk_old_limit) as at_risk_old_limit,
  SUM(has_risk_new_limit) as at_risk_new_limit,
  MAX(relay_size) as max_relay_size,
  MAX(methods_size) as max_methods_size,
  MAX(kinds_size) as max_kinds_size,
  MAX(total_size) as max_total_size
FROM nip46_data_audit;

-- Log details of any sessions at risk with the new 50KB limit
SELECT
  'WARNING: Session ' || client_pubkey || ' exceeds 50KB limit' as warning,
  'Relay size: ' || relay_size || ' bytes' as relay_info,
  'Methods size: ' || methods_size || ' bytes' as methods_info,
  'Kinds size: ' || kinds_size || ' bytes' as kinds_info
FROM nip46_data_audit
WHERE has_risk_new_limit = 1;