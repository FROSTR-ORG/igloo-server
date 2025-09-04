import { PrivilegedRouteContext, ServerBifrostNode } from './types.js';
import { 
  readEnvFile, 
  writeEnvFile, 
  filterEnvObject, 
  validateEnvKeys, 
  getValidRelays,
  getSecureCorsHeaders 
} from './utils.js';
import { HEADLESS } from '../const.js';
import { getUserCredentials } from '../db/database.js';
import { createAndStartNode } from './node-manager.js';

// Add a lock to prevent concurrent node updates
let nodeUpdateLock: Promise<void> = Promise.resolve();

// Helper function to execute node operations under lock without poisoning the queue
async function executeUnderNodeLock<T>(
  operation: () => Promise<T>,
  context: PrivilegedRouteContext
): Promise<T> {
  // Create a promise for this specific operation
  const run = nodeUpdateLock.then(operation);
  
  // Keep the queue alive even if this run fails
  nodeUpdateLock = run
    .catch((error) => {
      context.addServerLog('error', 'Node operation failed', error);
      // Don't re-throw here - just log and continue
    })
    .then(() => undefined); // Ensure queue always resolves
  
  // Return the result of this specific operation (may throw)
  return run;
}

// Synchronized node cleanup function
async function cleanupNodeSynchronized(context: PrivilegedRouteContext): Promise<void> {
  return executeUnderNodeLock(async () => {
    if (context.node) {
      context.addServerLog('info', 'Credentials deleted, cleaning up Bifrost node...');
      // updateNode(null) will handle all cleanup atomically
      context.updateNode(null);
      context.addServerLog('info', 'Bifrost node cleaned up successfully');
    }
  }, context);
}

// Wrapper function to use shared node creation with env variables
async function createAndConnectServerNode(env: any, context: PrivilegedRouteContext): Promise<void> {
  // Parse relays if they're a string
  let relays = env.RELAYS;
  if (typeof relays === 'string') {
    try {
      relays = JSON.parse(relays);
    } catch {
      // If not valid JSON, try splitting by comma
      relays = relays.split(',').map((r: string) => r.trim());
    }
  }
  
  return createAndStartNode({
    group_cred: env.GROUP_CRED,
    share_cred: env.SHARE_CRED,
    relays: relays,
    group_name: env.GROUP_NAME
  }, context);
}

export async function handleEnvRoute(req: Request, url: URL, context: PrivilegedRouteContext): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/env')) return null;
  
  // In non-headless mode, env routes are restricted
  if (!HEADLESS && req.method === 'POST') {
    const corsHeaders = getSecureCorsHeaders(req);
    return Response.json(
      { error: 'Environment modification not allowed in database mode. Use /api/user/credentials instead.' },
      { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);

  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  try {
    switch (url.pathname) {
      case '/api/env':
        if (req.method === 'GET') {
          // In headless mode, return env vars
          // In database mode, try to return user credentials in env format for compatibility
          if (HEADLESS) {
            const env = await readEnvFile();
            const { filteredEnv } = filterEnvObject(env);
            return Response.json(filteredEnv, { headers });
          } else {
            // Database mode - return empty or user's credentials if available
            const auth = (context as any).auth;
            if (auth?.authenticated && typeof auth.userId === 'number' && auth.password) {
              const credentials = getUserCredentials(auth.userId, auth.password);
              if (credentials) {
                // Map to env format for compatibility
                return Response.json({
                  GROUP_CRED: credentials.group_cred || undefined,
                  SHARE_CRED: credentials.share_cred || undefined,
                  GROUP_NAME: credentials.group_name || undefined,
                  RELAYS: credentials.relays ? JSON.stringify(credentials.relays) : undefined
                }, { headers });
              }
            }
            return Response.json({}, { headers });
          }
        }
        
        if (req.method === 'POST') {
          const body = await req.json();
          const env = await readEnvFile();
          
          // Validate which keys are allowed to be updated
          const { validKeys, invalidKeys: rejectedKeys } = validateEnvKeys(Object.keys(body));
          
          // Update only allowed keys
          const updatingCredentials = validKeys.some(key => ['GROUP_CRED', 'SHARE_CRED'].includes(key));
          const updatingRelays = validKeys.includes('RELAYS');
          
          for (const key of validKeys) {
            if (body[key] !== undefined) {
              env[key] = body[key];
            }
          }
          
          if (await writeEnvFile(env)) {
            // If credentials or relays were updated, recreate the node
            if (updatingCredentials || updatingRelays) {
              try {
                await createAndConnectServerNode(env, context);
              } catch (error) {
                context.addServerLog('error', 'Error recreating Bifrost node', error);
                // Continue anyway - the env vars were saved
              }
            }
            
            const responseMessage = rejectedKeys.length > 0 
              ? `Environment variables updated. Rejected unauthorized keys: ${rejectedKeys.join(', ')}`
              : 'Environment variables updated';
            
            return Response.json({ 
              success: true, 
              message: responseMessage,
              rejectedKeys: rejectedKeys.length > 0 ? rejectedKeys : undefined
            }, { headers });
          } else {
            return Response.json({ success: false, message: 'Failed to update .env file' }, { status: 500, headers });
          }
        }
        break;

      case '/api/env/delete':
        if (req.method === 'POST') {
          const body = await req.json();
          const { keys } = body;
          
          if (!Array.isArray(keys) || keys.length === 0) {
            return Response.json({ error: 'Keys array is required' }, { status: 400, headers });
          }
          
          const env = await readEnvFile();
          
          // Validate which keys are allowed to be deleted
          const { validKeys, invalidKeys } = validateEnvKeys(keys);
          
          // Check if we're deleting credentials
          const deletingCredentials = validKeys.some(key => ['GROUP_CRED', 'SHARE_CRED'].includes(key));
          
          // Delete only allowed keys
          for (const key of validKeys) {
            delete env[key];
          }
          
          if (await writeEnvFile(env)) {
            // If credentials were deleted, clean up the node
            if (deletingCredentials) {
              try {
                // Use synchronized cleanup to prevent race conditions
                await cleanupNodeSynchronized(context);
              } catch (error) {
                // Error already logged by executeUnderNodeLock
                // Continue anyway - the env vars were deleted
              }
            }
            
            const responseMessage = invalidKeys.length > 0 
              ? `Environment variables deleted. Rejected unauthorized keys: ${invalidKeys.join(', ')}`
              : 'Environment variables deleted';
            
            return Response.json({ 
              success: true, 
              message: responseMessage,
              deletedKeys: validKeys,
              rejectedKeys: invalidKeys.length > 0 ? invalidKeys : undefined
            }, { headers });
          } else {
            return Response.json({ success: false, message: 'Failed to update .env file' }, { status: 500, headers });
          }
        }
        break;
    }
    
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers });
  }
} 