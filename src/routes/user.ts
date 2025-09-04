import { HEADLESS } from '../const.js';
import { 
  getUserById, 
  getUserCredentials, 
  updateUserCredentials,
  deleteUserCredentials,
  type UserCredentials
} from '../db/database.js';
import { getSecureCorsHeaders } from './utils.js';
import { PrivilegedRouteContext } from './types.js';
import { createAndStartNode } from './node-manager.js';

export async function handleUserRoute(
  req: Request,
  url: URL,
  context: PrivilegedRouteContext
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

  // Check if user is authenticated
  const auth = (context as any).auth;
  if (!auth || !auth.authenticated) {
    return Response.json(
      { error: 'Authentication required' },
      { status: 401, headers }
    );
  }

  // Database users have numeric IDs
  const userId = typeof auth.userId === 'number' ? auth.userId : null;
  const password = auth.password; // Password from session for decryption

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
          if (!password) {
            return Response.json(
              { error: 'Password required for decryption. Please login again.' },
              { status: 401, headers }
            );
          }

          const credentials = getUserCredentials(userId, password);
          if (!credentials) {
            return Response.json(
              { error: 'Failed to retrieve credentials' },
              { status: 500, headers }
            );
          }

          // Auto-start node if credentials exist and node isn't running
          if (credentials.group_cred && credentials.share_cred && !context.node) {
            context.addServerLog('info', 'Auto-starting Bifrost node for logged-in user...');
            try {
              await createAndStartNode({
                group_cred: credentials.group_cred,
                share_cred: credentials.share_cred,
                relays: credentials.relays,
                group_name: credentials.group_name
              }, context);
            } catch (error) {
              context.addServerLog('error', 'Failed to auto-start node', error);
            }
          }

          return Response.json(credentials, { headers });
        }

        if (req.method === 'POST' || req.method === 'PUT') {
          if (!password) {
            return Response.json(
              { error: 'Password required for encryption. Please login again.' },
              { status: 401, headers }
            );
          }

          const body = await req.json();
          const updates: Partial<UserCredentials> = {};

          // Only update provided fields
          if ('group_cred' in body) updates.group_cred = body.group_cred;
          if ('share_cred' in body) updates.share_cred = body.share_cred;
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
          if ('group_name' in body) updates.group_name = body.group_name;

          const success = updateUserCredentials(userId, updates, password);
          
          if (!success) {
            return Response.json(
              { error: 'Failed to update credentials' },
              { status: 500, headers }
            );
          }

          // After saving credentials, check if we should start the node
          // Retrieve the latest credentials to see if we have everything needed
          const credentials = getUserCredentials(userId, password);
          if (credentials && credentials.group_cred && credentials.share_cred) {
            // Only start if node isn't already running
            if (!context.node) {
              context.addServerLog('info', 'Starting Bifrost node with saved credentials...');
              try {
                await createAndStartNode({
                  group_cred: credentials.group_cred,
                  share_cred: credentials.share_cred,
                  relays: credentials.relays,
                  group_name: credentials.group_name
                }, context);
              } catch (error) {
                context.addServerLog('error', 'Failed to start node after saving credentials', error);
              }
            } else {
              context.addServerLog('info', 'Node already running, skipping restart');
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

          return Response.json(
            { success: true, message: 'Credentials deleted successfully' },
            { headers }
          );
        }
        break;

      case '/api/user/relays':
        // Convenience endpoint for managing just relays
        if (req.method === 'GET') {
          if (!password) {
            return Response.json(
              { error: 'Password required for decryption. Please login again.' },
              { status: 401, headers }
            );
          }

          const credentials = getUserCredentials(userId, password);
          if (!credentials) {
            return Response.json(
              { error: 'Failed to retrieve relays' },
              { status: 500, headers }
            );
          }

          return Response.json(
            { relays: credentials.relays || [] },
            { headers }
          );
        }

        if (req.method === 'POST' || req.method === 'PUT') {
          if (!password) {
            return Response.json(
              { error: 'Password required for encryption. Please login again.' },
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

          const success = updateUserCredentials(userId, { relays }, password);
          
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