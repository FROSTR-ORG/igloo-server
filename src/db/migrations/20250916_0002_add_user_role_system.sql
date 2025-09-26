-- Add role-based access control to users table
-- This migration adds a role column to support flexible permission management
-- and removes the hardcoded admin privileges for user ID 1

-- Add role column with default 'user' role and validation constraint
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'
  CHECK (role IN ('admin', 'user'));

-- Set the first user as admin for backward compatibility
-- This maintains the existing behavior where user ID 1 had admin privileges
UPDATE users SET role = 'admin' WHERE id = 1;

-- Create index for efficient role-based queries
CREATE INDEX idx_users_role ON users(role);

-- Add a comment to document the role system
-- Valid roles: 'admin' (full system access), 'user' (standard user)
-- Future roles can be added as needed (e.g., 'moderator', 'readonly')
--
-- To add new roles in future migrations:
-- ALTER TABLE users DROP CONSTRAINT users_role_check;
-- ALTER TABLE users ADD CONSTRAINT users_role_check
--   CHECK (role IN ('admin', 'user', 'moderator'));