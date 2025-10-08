import { ADMIN_SECRET, HEADLESS } from '../const.js';
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js';
import { RouteContext } from './types.js';
import { getAllUsers, deleteUserSafely, isDatabaseInitialized, listApiKeys, createApiKey, revokeApiKey } from '../db/database.js';
import { validateAdminSecret } from './onboarding.js';
import { checkRateLimit } from './auth.js';

/**
 * Shape of the request body for deleting a user via the admin API.
 * `userId` is validated at runtime to be an integer before use.
 */
interface DeleteUserRequest {
  userId?: unknown;
}

interface CreateApiKeyRequest {
  label?: unknown;
  userId?: unknown;
  createdByAdmin?: unknown;
}

interface RevokeApiKeyRequest {
  apiKeyId?: unknown;
  reason?: unknown;
}

/**
 * Convert various input types into a normalized positive integer (number or bigint).
 * Accepts number, numeric string (e.g. "1", "42"), and bigint (e.g. 1n).
 * Returns number for safe integers, bigint for larger values, or null if invalid.
 */
function normalizePositiveInteger(input: unknown): number | bigint | null {
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

  // Check rate limit before admin authentication to prevent brute force attacks
  const rate = await checkRateLimit(req);
  if (!rate.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded. Try again later.' },
      {
        status: 429,
        headers: {
          ...headers,
          'Retry-After': Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900')).toString()
        }
      }
    );
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
          const normalizedUserId = normalizePositiveInteger(userId);
          if (normalizedUserId == null) {
            return Response.json(
              { error: 'Valid integer userId required' },
              { status: 400, headers }
            );
          }

          // Perform atomic delete with last-admin guard inside a DB transaction
          const { success, error } = deleteUserSafely(normalizedUserId);
          if (!success) {
            console.error(`[admin] Error during user deletion for userId ${normalizedUserId}:`, error);
            const status = error === 'User not found'
              ? 404
              : error === 'Cannot delete the last admin user'
              ? 400
              : 500;
            return Response.json({ error: error || 'Deletion failed' }, { status, headers });
          }
          return Response.json({ success: true, message: 'User deleted successfully' }, { headers });
        }
        break;

      case '/api/admin/api-keys':
        if (req.method === 'GET') {
          const apiKeys = listApiKeys().map(key => ({
            id: typeof (key as any).id === 'bigint' ? (key as any).id.toString() : key.id,
            prefix: key.prefix,
            label: key.label,
            createdAt: key.createdAt,
            updatedAt: key.updatedAt,
            lastUsedAt: key.lastUsedAt,
            lastUsedIp: key.lastUsedIp,
            revokedAt: key.revokedAt,
            revokedReason: key.revokedReason,
            createdByUserId: key.createdByUserId,
            createdByAdmin: key.createdByAdmin,
          }));
          return Response.json({ apiKeys }, { headers });
        }

        if (req.method === 'POST') {
          let body: CreateApiKeyRequest;
          try {
            body = await req.json();
          } catch {
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

          let label: string | undefined;
          if (body.label !== undefined) {
            if (typeof body.label !== 'string') {
              return Response.json(
                { error: 'Label must be a string if provided' },
                { status: 400, headers }
              );
            }
            const trimmed = body.label.trim();
            if (trimmed.length > 0) {
              label = trimmed.slice(0, 128);
            }
          }

          const normalizedUserId = body.userId !== undefined
            ? normalizePositiveInteger(body.userId)
            : null;
          if (body.userId !== undefined && normalizedUserId == null) {
            return Response.json(
              { error: 'Valid integer userId required when provided' },
              { status: 400, headers }
            );
          }

          const createdByAdminFlag = typeof body.createdByAdmin === 'boolean'
            ? body.createdByAdmin
            : normalizedUserId == null;

          try {
            const result = createApiKey({
              label,
              createdByUserId: normalizedUserId ?? null,
              createdByAdmin: createdByAdminFlag,
            });

            const responseBody = {
              apiKey: {
                id: result.id,
                token: result.token,
                prefix: result.prefix,
                label: label ?? null,
                createdByUserId: normalizedUserId == null
                  ? null
                  : (typeof normalizedUserId === 'bigint' ? normalizedUserId.toString() : normalizedUserId),
                createdByAdmin: createdByAdminFlag,
              }
            };

            return Response.json(responseBody, { status: 201, headers });
          } catch (error) {
            console.error('[admin] Failed to create API key:', error);
            return Response.json(
              { error: 'Failed to create API key' },
              { status: 500, headers }
            );
          }
        }
        break;

      case '/api/admin/api-keys/revoke':
        if (req.method === 'POST') {
          let body: RevokeApiKeyRequest;
          try {
            body = await req.json();
          } catch {
            return Response.json(
              { error: 'Invalid JSON in request body' },
              { status: 400, headers }
            );
          }

          if (!body || typeof body !== 'object') {
            return Response.json(
              { error: 'Request body must be an object' },
              { status: 400, headers }
            );
          }

          const normalizedKeyId = normalizePositiveInteger(body.apiKeyId);
          if (normalizedKeyId == null) {
            return Response.json(
              { error: 'Valid integer apiKeyId required' },
              { status: 400, headers }
            );
          }

          let reason: string | undefined;
          if (body.reason !== undefined) {
            if (typeof body.reason !== 'string') {
              return Response.json(
                { error: 'Reason must be a string if provided' },
                { status: 400, headers }
              );
            }
            const trimmed = body.reason.trim();
            if (trimmed.length > 0) {
              reason = trimmed.slice(0, 256);
            }
          }

          const result = revokeApiKey(normalizedKeyId, reason);
          if (result.success) {
            return Response.json({ success: true }, { headers });
          }

          const status = result.error === 'not_found'
            ? 404
            : result.error === 'already_revoked'
              ? 409
              : 500;
          const message = result.error === 'not_found'
            ? 'API key not found'
            : result.error === 'already_revoked'
              ? 'API key already revoked'
              : 'Failed to revoke API key';

          return Response.json({ error: message }, { status, headers });
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
