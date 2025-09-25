import { HEADLESS } from '../const.js';
import {
  getUserById,
  getUserCredentials,
  updateUserCredentials,
  deleteUserCredentials,
  getUserPeerPolicies,
  type UserCredentials
} from '../db/database.js';
import { getSecureCorsHeaders, mergeVaryHeaders, parseJsonRequestBody } from './utils.js';
import { PrivilegedRouteContext, RequestAuth } from './types.js';
import { createNodeWithCredentials } from '../node/manager.js';
import { executeUnderNodeLock, cleanupNodeSynchronized } from '../utils/node-lock.js';
import { getNip46Service } from '../nip46/index.js';

// Define route-to-methods mapping for proper 404/405 handling
const ROUTE_METHODS: Record<string, string[]> = {
  '/api/user/profile': ['GET'],
  '/api/user/credentials': ['GET', 'POST', 'PUT', 'DELETE'],
  '/api/user/relays': ['GET', 'POST', 'PUT']
};

/**
 * Returns a string secret for encryption/decryption and whether it's a derived key.
 * Uses secure getters to access sensitive data that clears after first access.
 */
function getAuthSecret(auth: RequestAuth): { secret: string | Uint8Array; isDerivedKey: boolean } | null {
  // Only use secure getters - no fallback to direct access
  const password = auth.getPassword?.();
  if (typeof password === 'string' && password.length > 0) {
    return { secret: password, isDerivedKey: false };
  }

  const derivedKey = auth.getDerivedKey?.();
  if (derivedKey) return { secret: derivedKey, isDerivedKey: true };

  return null;
}

/**
 * Returns true when the provided string is a valid WebSocket URL.
 * Accepts only ws:// or wss:// protocols.
 */
function isValidWebSocketUrl(value: string): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

function resolveUserId(input: unknown): number | bigint | null {
  if (typeof input === 'number' && Number.isSafeInteger(input) && input > 0) {
    return input;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
      try {
        return BigInt(trimmed);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function handleUserRoute(
  req: Request,
  url: URL,
  context: PrivilegedRouteContext,
  auth: RequestAuth | null
): Promise<Response | null> {
  // User routes only available in non-headless mode
  if (HEADLESS) {
    return null;
  }

  if (!url.pathname.startsWith('/api/user')) return null;

  const corsHeaders = getSecureCorsHeaders(req);
  // Use utility function to merge Vary headers properly
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
    ...corsHeaders,
    'Vary': mergedVary,
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  // Check if user is authenticated (auth passed as parameter now, not from context)
  if (!auth || !auth.authenticated) {
    return Response.json(
      { error: 'Authentication required' },
      { status: 401, headers }
    );
  }

  // Database users have numeric IDs (number or string representation of bigint)
  let userId: number | bigint | null = null;
  if (typeof auth.userId === 'number') {
    userId = auth.userId;
  } else if (typeof auth.userId === 'string' && /^\d+$/.test(auth.userId)) {
    // Convert string representation back to bigint for database
    userId = BigInt(auth.userId);
  }
  
  // Require a valid database user
  // Note: Environment auth users (API Key/Basic Auth) have string userIds and
  // are intentionally blocked from credential storage operations for security
  if (userId === null) {
    return Response.json(
      { error: 'Database user authentication required. Credential storage is not available for API Key or Basic Auth users.' },
      { status: 401, headers }
    );
  }

  try {
    switch (url.pathname) {
      case '/api/user/profile':
        if (req.method === 'GET') {
          const user = getUserById(userId);
          if (!user) {
            return Response.json(
              { error: 'User not found' },
              { status: 404, headers }
            );
          }

          // Return user profile (without sensitive data)
          return Response.json(
            {
              id: typeof user.id === 'bigint' ? user.id.toString() : user.id,
              username: user.username,
              createdAt: user.created_at,
              hasCredentials: !!(user.group_cred_encrypted && user.share_cred_encrypted),
            },
            { headers }
          );
        }
        break;

      case '/api/user/credentials':
        if (req.method === 'GET') {
          const authSecret = getAuthSecret(auth);
          if (!authSecret) {
            return Response.json(
              { error: 'Password or derived key required for decryption. Please login again.' },
              { status: 401, headers }
            );
          }
          let credentials: UserCredentials | null;
          try {
            credentials = getUserCredentials(
              userId,
              authSecret.secret,
              authSecret.isDerivedKey
            );
          } catch (error) {
            console.error('Failed to retrieve user credentials:', error);
            return Response.json(
              { error: 'Password or derived key required for decryption. Please login again.' },
              { status: 401, headers }
            );
          }
          if (!credentials) {
            return Response.json(
              { error: 'No credentials found' },
              { status: 404, headers }
            );
          }

          // Auto-start node if credentials exist (perform atomically under node lock)
          if (credentials.group_cred && credentials.share_cred) {
            // Capture values to preserve type narrowing across async closure
            const groupCred = credentials.group_cred!;
            const shareCred = credentials.share_cred!;
            const relays = credentials.relays;
            const groupName = credentials.group_name;

            await executeUnderNodeLock(async () => {
              if (!context.node) {
                context.addServerLog('info', 'Auto-starting Bifrost node for logged-in user...');
                try {
                  const peerPolicies = getUserPeerPolicies(userId);
                  const peerPoliciesJson = peerPolicies.length > 0 ? JSON.stringify(peerPolicies) : undefined;
                  const node = await createNodeWithCredentials(
                    groupCred,
                    shareCred,
                    relays?.join(','),
                    context.addServerLog,
                    peerPoliciesJson
                  );
                  if (node) {
                    context.updateNode(node, {
                      credentials: {
                        group: groupCred,
                        share: shareCred,
                        relaysEnv: relays?.join(','),
                        peerPoliciesRaw: peerPoliciesJson,
                        source: 'dynamic'
                      }
                    });
                  }
                } catch (error) {
                  context.addServerLog('error', 'Failed to auto-start node', error);
                }
              }
            }, context);
          }

          const service = getNip46Service();
          if (service) {
            const resolvedId = resolveUserId(auth?.userId);
            if (resolvedId) {
              service.setActiveUser(resolvedId);
              await service.ensureStarted();
            }
          }

          return Response.json(credentials, { headers });
        }

        if (req.method === 'POST' || req.method === 'PUT') {
          const authSecret = getAuthSecret(auth);
          if (!authSecret) {
            return Response.json(
              { error: 'Password or derived key required for encryption. Please login again.' },
              { status: 401, headers }
            );
          }

          let body: any;
          try {
            body = await parseJsonRequestBody(req);
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : 'Invalid request body' },
              { status: 400, headers }
            );
          }

          const updates: Partial<UserCredentials> = {};

          // Only update provided fields with proper type validation
          if ('group_cred' in body) {
            // Validate group_cred type (string or null)
            if (body.group_cred === null || typeof body.group_cred === 'string') {
              updates.group_cred = body.group_cred;
            } else {
              return Response.json(
                { error: 'Invalid group_cred format. Must be a string or null.' },
                { status: 400, headers }
              );
            }
          }
          
          if ('share_cred' in body) {
            // Validate share_cred type (string or null)
            if (body.share_cred === null || typeof body.share_cred === 'string') {
              updates.share_cred = body.share_cred;
            } else {
              return Response.json(
                { error: 'Invalid share_cred format. Must be a string or null.' },
                { status: 400, headers }
              );
            }
          }
          
          if ('relays' in body) {
            // Validate relays format
            if (body.relays === null || 
                (Array.isArray(body.relays) && 
                 body.relays.every((r: any) => typeof r === 'string'))) {
              updates.relays = body.relays;
            } else {
              return Response.json(
                { error: 'Invalid relays format. Must be an array of strings or null.' },
                { status: 400, headers }
              );
            }
          }
          
          if ('group_name' in body) {
            // Validate group_name type (string or null)
            if (body.group_name === null || typeof body.group_name === 'string') {
              updates.group_name = body.group_name;
            } else {
              return Response.json(
                { error: 'Invalid group_name format. Must be a string or null.' },
                { status: 400, headers }
              );
            }
          }

          const success = updateUserCredentials(
            userId,
            updates,
            authSecret.secret,
            authSecret.isDerivedKey
          );
          
          if (!success) {
            return Response.json(
              { error: 'Failed to update credentials' },
              { status: 500, headers }
            );
          }

          // After saving credentials, check if we should start the node
          // Retrieve the latest credentials to see if we have everything needed
          let credentials: UserCredentials | null;
          try {
            credentials = getUserCredentials(
              userId,
              authSecret.secret,
              authSecret.isDerivedKey
            );
          } catch (error) {
            console.error('Failed to retrieve user credentials after save:', error);
            // Don't fail the request since the save was successful
            // Just skip node startup
            credentials = null;
          }
          if (credentials && credentials.group_cred && credentials.share_cred) {
            // Start the node under the shared lock to avoid races
            try {
              await executeUnderNodeLock(async () => {
                if (!context.node && credentials) {
                  context.addServerLog('info', 'Starting Bifrost node with saved credentials...');
                  const peerPolicies = getUserPeerPolicies(userId);
                  const peerPoliciesJson = peerPolicies.length > 0 ? JSON.stringify(peerPolicies) : undefined;
                  const groupCred = credentials.group_cred!;
                  const shareCred = credentials.share_cred!;
                  const relays = credentials.relays;
                  const relaysEnv = relays?.length ? relays.join(',') : undefined;

                  const node = await createNodeWithCredentials(
                    groupCred,
                    shareCred,
                    relaysEnv,
                    context.addServerLog,
                    peerPoliciesJson
                  );
                  if (node) {
                    context.updateNode(node, {
                      credentials: {
                        group: groupCred,
                        share: shareCred,
                        relaysEnv,
                        peerPoliciesRaw: peerPoliciesJson,
                        source: 'dynamic'
                      }
                    });
                  }
                } else {
                  context.addServerLog('info', 'Node already running, skipping restart');
                }
              }, context);
            } catch (error) {
              context.addServerLog('error', 'Failed to start node after saving credentials', error);
            }
          }

          return Response.json(
            { success: true, message: 'Credentials updated successfully' },
            { headers }
          );
        }

        if (req.method === 'DELETE') {
          const success = deleteUserCredentials(userId);
          
          if (!success) {
            return Response.json(
              { error: 'Failed to delete credentials' },
              { status: 500, headers }
            );
          }

          // After deleting credentials, stop and cleanup any running node for this user
          try {
            await cleanupNodeSynchronized(context);
          } catch (error) {
            context.addServerLog('error', 'Failed to cleanup node after credential deletion', error);
            return Response.json(
              { error: 'Credentials deleted but failed to cleanup node' },
              { status: 500, headers }
            );
          }

          return Response.json(
            { success: true, message: 'Credentials deleted successfully' },
            { headers }
          );
        }
        break;

      case '/api/user/relays':
        // Convenience endpoint for managing just relays
        if (req.method === 'GET') {
          const user = getUserById(userId);
          if (!user) {
            return Response.json(
              { error: 'User not found' },
              { status: 404, headers }
            );
          }

          let relays: string[] = [];
          if (user.relays) {
            try {
              relays = JSON.parse(user.relays);
            } catch {
              relays = [];
            }
          }

          return Response.json({ relays }, { headers });
        }

        if (req.method === 'POST' || req.method === 'PUT') {
          let body: any;
          try {
            body = await parseJsonRequestBody(req);
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : 'Invalid request body' },
              { status: 400, headers }
            );
          }

          // Check if relays field is present in the request body
          if (!('relays' in body)) {
            return Response.json(
              { error: 'Missing required field: relays' },
              { status: 400, headers }
            );
          }

          const relays = (body as any).relays;

          if (relays !== null) {
            if (!Array.isArray(relays)) {
              return Response.json(
                { error: 'Invalid relays format. Must be an array of strings or null.' },
                { status: 400, headers }
              );
            }
            const invalidRelays = relays.filter((r: any) => typeof r !== 'string' || !isValidWebSocketUrl(r));
            if (invalidRelays.length > 0) {
              return Response.json(
                { error: 'Invalid relay URLs. Must use ws:// or wss://' },
                { status: 400, headers }
              );
            }
          }

          // Relays are stored as plain JSON, so no auth secret needed for relay-only updates
          // Pass empty string and false to indicate no encryption needed
          const success = updateUserCredentials(
            userId,
            { relays },
            '',  // No password/key needed for unencrypted fields
            false // Not a derived key
          );
          
          if (!success) {
            return Response.json(
              { error: 'Failed to update relays' },
              { status: 500, headers }
            );
          }

          return Response.json(
            { success: true, message: 'Relays updated successfully' },
            { headers }
          );
        }
        break;
    }

    // Check if the route exists
    const allowedMethods = ROUTE_METHODS[url.pathname];
    if (!allowedMethods) {
      // Route doesn't exist
      return Response.json(
        { error: 'Not found' },
        { status: 404, headers }
      );
    }

    // Route exists but method not allowed
    return Response.json(
      { error: 'Method not allowed' },
      { 
        status: 405, 
        headers: {
          ...headers,
          'Allow': allowedMethods.join(', ')
        }
      }
    );
  } catch (error) {
    console.error('User API Error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500, headers }
    );
  }
}
