import { ADMIN_SECRET, HEADLESS } from '../const.js';
import { getSecureCorsHeaders } from './utils.js';
import { RouteContext } from './types.js';
import { getAllUsers, deleteUser, isDatabaseInitialized } from '../db/database.js';
import { validateAdminSecret } from './onboarding.js';

/**
 * Shape of the request body for deleting a user via the admin API.
 * `userId` is validated at runtime to be an integer before use.
 */
interface DeleteUserRequest {
  userId?: unknown;
}

/**
 * Convert various `userId` input types into a normalized number or bigint.
 * Only accepts positive integers: number, numeric string (e.g. "1", "42"), and bigint (e.g. 1n).
 * Returns number for positive safe integers, or null if invalid.
 */
function normalizeUserId(input: unknown): number | bigint | null {
  if (typeof input === 'number') {
    // Require finite, safe integer, and positive (> 0)
    return Number.isFinite(input) && Number.isSafeInteger(input) && input > 0 ? input : null;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    // Check if it's a valid positive integer string (no negative sign allowed)
    if (!/^\d+$/.test(trimmed)) return null;
    
    const parsed = Number(trimmed);
    // Require finite, safe integer, and positive (> 0)
    if (Number.isFinite(parsed) && Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
    return null;
  }

  if (typeof input === 'bigint') {
    // Require positive and within safe integer range
    if (input > 0n && input <= BigInt(Number.MAX_SAFE_INTEGER)) {
      // Coerce to number since it's within safe range
      return Number(input);
    }
    return null;
  }

  return null;
}

/**
 * Admin management routes that require ADMIN_SECRET authentication
 * These routes provide privileged operations even after initial setup
 */
export async function handleAdminRoute(
  req: Request,
  url: URL,
  _context: RouteContext
): Promise<Response | null> {
  // Admin routes only available in non-headless mode with initialized database
  if (HEADLESS) {
    return null;
  }

  if (!url.pathname.startsWith('/api/admin')) return null;

  const corsHeaders = getSecureCorsHeaders(req);
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  // Database must be initialized for admin operations
  try {
    const initialized = isDatabaseInitialized();
    if (!initialized) {
      return Response.json(
        { error: 'Database not initialized' },
        { status: 503, headers }
      );
    }
  } catch (err: any) {
    console.error('[admin] Database initialization check failed:', err.message);
    // Treat database errors as not initialized
    return Response.json(
      { error: 'Database not initialized' },
      { status: 503, headers }
    );
  }

  // All admin routes require ADMIN_SECRET authentication
  const authHeader = req.headers.get('Authorization');
  let adminSecret: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    adminSecret = authHeader.substring(7);
  }

  // Validate admin secret using timing-safe comparison
  const isValid = await validateAdminSecret(adminSecret);
  if (!isValid) {
    return Response.json(
      { error: 'Admin authentication required' },
      { status: 401, headers }
    );
  }

  try {
    switch (url.pathname) {
      case '/api/admin/users':
        if (req.method === 'GET') {
          // List all users (without sensitive data) and BigInt-safe ids
          const users = getAllUsers().map(u => ({
            id: typeof (u as any).id === 'bigint' ? (u as any).id.toString() : u.id,
            username: u.username,
            createdAt: u.createdAt,
            hasCredentials: !!u.hasCredentials,
          }));
          return Response.json({ users }, { headers });
        }
        break;

      case '/api/admin/users/delete':
        if (req.method === 'POST') {
          let body: DeleteUserRequest;
          try {
            body = await req.json();
          } catch (error) {
            return Response.json(
              { error: 'Invalid JSON in request body' },
              { status: 400, headers }
            );
          }

          if (body == null || typeof body !== 'object') {
            return Response.json(
              { error: 'Request body must be an object' },
              { status: 400, headers }
            );
          }

          const { userId } = body;
          const normalizedUserId = normalizeUserId(userId);
          if (normalizedUserId == null) {
            return Response.json(
              { error: 'Valid integer userId required' },
              { status: 400, headers }
            );
          }

          // Prevent deleting the last admin user
          // In this system, we consider users with stored credentials as admins
          const users = getAllUsers();
          const targetUser = users.find(u => String(u.id) === String(normalizedUserId));
          if (!targetUser) {
            return Response.json(
              { error: 'User not found or deletion failed' },
              { status: 404, headers }
            );
          }

          // Use consistent String comparison for filtering admin users
          const adminUsers = users.filter(u => u.hasCredentials && String(u.id) !== String(normalizedUserId));
          const isTargetAdmin = !!targetUser.hasCredentials;
          if (isTargetAdmin && adminUsers.length === 0) {
            return Response.json(
              { error: 'Cannot delete the last admin user' },
              { status: 400, headers }
            );
          }

          // Pass the original targetUser.id to preserve its type
          const success = deleteUser(targetUser.id);
          if (!success) {
            return Response.json(
              { error: 'User not found or deletion failed' },
              { status: 404, headers }
            );
          }

          return Response.json(
            { success: true, message: 'User deleted successfully' },
            { headers }
          );
        }
        break;

      case '/api/admin/status':
        if (req.method === 'GET') {
          // Provide system status information
          const users = getAllUsers();
          return Response.json(
            {
              initialized: true,
              userCount: users.length,
              hasAdminSecret: !!ADMIN_SECRET,
              mode: 'database',
            },
            { headers }
          );
        }
        break;
    }

    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers }
    );
  } catch (error) {
    console.error('Admin API Error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500, headers }
    );
  }
}