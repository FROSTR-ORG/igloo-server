import { HEADLESS } from '../const.js';
import { 
  getUserById, 
  getUserCredentials, 
  updateUserCredentials,
  deleteUserCredentials,
  type UserCredentials
} from '../db/database.js';
import { getSecureCorsHeaders, bytesToHex } from './utils.js';
import { PrivilegedRouteContext, RequestAuth } from './types.js';
import { createAndStartNode } from './node-manager.js';
import { executeUnderNodeLock, cleanupNodeSynchronized } from './env.js';

/**
 * Returns a string secret for encryption/decryption and whether it's a derived key.
 * Uses secure getters to access sensitive data that clears after first access.
 */
function getAuthSecret(auth: RequestAuth): { secret: string; isDerivedKey: boolean } | null {
  // Only use secure getters - no fallback to direct access
  const password = auth.getPassword?.();
  if (typeof password === 'string' && password.length > 0) {
    return { secret: password, isDerivedKey: false };
  }
  
  const derivedKey = auth.getDerivedKey?.();
  if (derivedKey) {
    // Validate that derivedKey is Uint8Array or Buffer, convert Buffer to Uint8Array
    let keyBytes: Uint8Array | null = null;
    if (derivedKey instanceof Uint8Array) {
      keyBytes = derivedKey;
    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(derivedKey)) {
      keyBytes = new Uint8Array(derivedKey);
    } else {
      // Invalid type - treat as missing
      console.warn('Invalid derivedKey type in getAuthSecret; expected Uint8Array or Buffer');
      return null;
    }
    return { secret: bytesToHex(keyBytes), isDerivedKey: true };
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
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
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

  // Database users have numeric IDs
  const userId = typeof auth.userId === 'number' ? auth.userId : null;
  
  // Require a valid database user
  if (!userId) {
    return Response.json(
      { error: 'Database user authentication required' },
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
              id: user.id,
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
              { error: 'Password or derived key required for decryption. Please login again.' },
              { status: 401, headers }
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
                  await createAndStartNode({
                    group_cred: groupCred,
                    share_cred: shareCred,
                    relays,
                    group_name: groupName
                  }, context);
                } catch (error) {
                  context.addServerLog('error', 'Failed to auto-start node', error);
                }
              }
            }, context);
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

          const body = await req.json();
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
                  await createAndStartNode({
                    group_cred: credentials.group_cred!,
                    share_cred: credentials.share_cred!,
                    relays: credentials.relays ?? undefined,
                    group_name: credentials.group_name ?? undefined
                  }, context);
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
          const authSecret = getAuthSecret(auth);
          if (!authSecret) {
            return Response.json(
              { error: 'Password or derived key required for encryption. Please login again.' },
              { status: 401, headers }
            );
          }

          const body = await req.json();
          const { relays } = body;

          if (!Array.isArray(relays) || !relays.every(r => typeof r === 'string')) {
            return Response.json(
              { error: 'Invalid relays format. Must be an array of strings.' },
              { status: 400, headers }
            );
          }

          const success = updateUserCredentials(
            userId,
            { relays },
            authSecret.secret,
            authSecret.isDerivedKey
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

    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers }
    );
  } catch (error) {
    console.error('User API Error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500, headers }
    );
  }
}