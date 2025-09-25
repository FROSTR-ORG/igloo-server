-- Fix potential infinite recursion in rate_limits trigger
-- Date: 2025-09-17
--
-- The AFTER UPDATE trigger that updates the same table could cause unnecessary
-- overhead and potential recursion issues. Since the application code can
-- handle setting updated_at directly, we remove the trigger in favor of
-- explicit application control.
--
-- This follows the same pattern as the fix for nip46_sessions table
-- (see 20250916_0003_fix_nip46_trigger_recursion.sql)

-- Drop the problematic trigger
DROP TRIGGER IF EXISTS update_rate_limits_timestamp;

-- Note: The application code in src/utils/rate-limiter.ts will be updated
-- to explicitly set updated_at = CURRENT_TIMESTAMP in all UPDATE queries