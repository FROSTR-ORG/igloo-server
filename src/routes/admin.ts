import { ADMIN_SECRET, HEADLESS } from '../const.js';
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js';
import { RouteContext } from './types.js';
import { getAllUsers, deleteUserSafely, isDatabaseInitialized } from '../db/database.js';
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
 * Returns number for safe integers, bigint for larger values, or null if invalid.
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
    
    // Try to parse as BigInt first to handle large numbers
    try {
      const asBigInt = BigInt(trimmed);
      if (asBigInt <= 0n) return null;
      
      // Return as number if within safe range, otherwise keep as bigint
      if (asBigInt <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(asBigInt);
      }
      return asBigInt;
    } catch {
      return null;
    }
  }

  if (typeof input === 'bigint') {
    // Accept any positive bigint
    return input > 0n ? input : null;
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
  
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
    'Vary': mergedVary,
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

          // Perform atomic delete with last-admin guard inside a DB transaction
          const { success, error } = deleteUserSafely(normalizedUserId);
          if (!success) {
            const status = error === 'User not found' ? 404 : (error === 'Cannot delete the last admin user' ? 400 : 500);
            return Response.json({ error: error || 'Deletion failed' }, { status, headers });
          }
          return Response.json({ success: true, message: 'User deleted successfully' }, { headers });
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
