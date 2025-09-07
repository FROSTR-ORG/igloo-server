import { PrivilegedRouteContext, RequestAuth } from './types.js';
import { 
  readEnvFile, 
  writeEnvFile, 
  filterPublicEnvObject, 
  validateEnvKeys, 
  getSecureCorsHeaders 
} from './utils.js';
import { HEADLESS } from '../const.js';
import { getUserCredentials } from '../db/database.js';
import { createAndStartNode } from './node-manager.js';

// Add a lock to prevent concurrent node updates
let nodeUpdateLock: Promise<void> = Promise.resolve();

// Helper function to execute node operations under lock without poisoning the queue
export async function executeUnderNodeLock<T>(
  operation: () => Promise<T>,
  context: PrivilegedRouteContext
): Promise<T> {
  // Create a promise for this specific operation
  const run = nodeUpdateLock.then(operation);
  
  // Update the queue to continue even if this operation fails
  // This preserves queue continuity while allowing caller to see errors
  nodeUpdateLock = run
    .then(() => undefined)
    .catch(() => undefined);
  
  // Add error handling that logs but re-throws for caller visibility
  return run.catch((error) => {
    context.addServerLog('error', 'Node operation failed', error);
    throw error; // Re-throw so callers see the failure
  });
}

// Synchronized node cleanup function
export async function cleanupNodeSynchronized(context: PrivilegedRouteContext): Promise<void> {
  return executeUnderNodeLock(async () => {
    if (context.node) {
      context.addServerLog('info', 'Credentials deleted, cleaning up Bifrost node...');
      // updateNode(null) will handle all cleanup atomically
      context.updateNode(null);
      context.addServerLog('info', 'Bifrost node cleaned up successfully');
    }
  }, context);
}

// Helper function to validate relay URLs
function validateRelayUrls(relays: any): { valid: boolean; urls?: string[]; error?: string } {
  if (!relays) {
    return { valid: true, urls: undefined };
  }

  // Parse relays if they're a string
  let parsedRelays: string[];
  if (typeof relays === 'string') {
    try {
      parsedRelays = JSON.parse(relays);
    } catch {
      // If not valid JSON, try splitting by comma
      parsedRelays = relays.split(',').map((r: string) => r.trim());
    }
  } else if (Array.isArray(relays)) {
    parsedRelays = relays;
  } else {
    return { valid: false, error: 'Relays must be a string or array' };
  }

  // Validate each relay URL
  for (const relay of parsedRelays) {
    if (typeof relay !== 'string') {
      return { valid: false, error: 'Each relay must be a string' };
    }
    
    try {
      const url = new URL(relay);
      // Relays should be WebSocket URLs
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        return { valid: false, error: `Invalid relay protocol: ${url.protocol}. Must be ws:// or wss://` };
      }
    } catch {
      return { valid: false, error: `Invalid relay URL: ${relay}` };
    }
  }

  return { valid: true, urls: parsedRelays };
}

// Wrapper function to use shared node creation with env variables
async function createAndConnectServerNode(env: any, context: PrivilegedRouteContext): Promise<void> {
  // Validate and parse relays
  const relayValidation = validateRelayUrls(env.RELAYS);
  if (!relayValidation.valid) {
    throw new Error(relayValidation.error);
  }
  
  return createAndStartNode({
    group_cred: env.GROUP_CRED,
    share_cred: env.SHARE_CRED,
    relays: relayValidation.urls,
    group_name: env.GROUP_NAME
  }, context);
}

export async function handleEnvRoute(req: Request, url: URL, context: PrivilegedRouteContext, auth?: RequestAuth | null): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/env')) return null;
  
  const corsHeaders = getSecureCorsHeaders(req);
  
  // In non-headless mode, env routes are restricted
  if (!HEADLESS && req.method === 'POST') {
    return Response.json(
      { error: 'Environment modification not allowed in database mode. Use /api/user/credentials instead.' },
      { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Validate auth parameter structure when needed in database mode
  if (!HEADLESS && req.method === 'GET') {
    if (!auth || typeof auth !== 'object') {
      return Response.json(
        { error: 'Authentication required' },
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
    
    if (!auth.authenticated) {
      return Response.json(
        { error: 'Invalid authentication' },
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
    
    if (typeof auth.userId !== 'number' || auth.userId <= 0) {
      return Response.json(
        { error: 'Invalid user authentication' },
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  }

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
            const publicEnv = filterPublicEnvObject(env);
            return Response.json(publicEnv, { headers });
          } else {
            // Database mode - return empty or user's credentials if available
            if (auth?.authenticated && typeof auth.userId === 'number') {
              // Use secure getters to access sensitive data
              let secret: string | null = null;
              let isDerivedKey = false;
              
              // Try to get password first (direct auth) - only use secure getter
              const password = auth.getPassword?.();
              if (password) {
                secret = password;
                isDerivedKey = false;
              } else {
                // Try to get derived key (session auth) - only use secure getter
                const derivedKey = auth.getDerivedKey?.();
                if (derivedKey) {
                  // Convert binary derived key to hex for PBKDF2
                  const { bytesToHex } = await import('./utils.js');
                  secret = bytesToHex(derivedKey);
                  isDerivedKey = true;
                }
              }
              
              if (!secret) return Response.json({}, { headers });
              let credentials;
              try {
                credentials = getUserCredentials(
                  auth.userId,
                  secret,
                  isDerivedKey
                );
              } catch (error) {
                console.error('Failed to retrieve user credentials for env:', error);
                return Response.json({}, { headers });
              }
              if (credentials) {
                // In database mode, don't return credential placeholders as they can be misinterpreted
                // The frontend should use /api/user/credentials to get actual values
                return Response.json({
                  // Don't return placeholders - return undefined for security
                  GROUP_CRED: undefined,
                  SHARE_CRED: undefined,
                  // Safe to return non-sensitive metadata
                  GROUP_NAME: credentials.group_name || undefined,
                  RELAYS: credentials.relays ? JSON.stringify(credentials.relays) : undefined,
                  // Add metadata to indicate credentials exist
                  hasCredentials: !!(credentials.group_cred && credentials.share_cred)
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
          
          // Validate relays before updating
          if (validKeys.includes('RELAYS') && body.RELAYS !== undefined) {
            const relayValidation = validateRelayUrls(body.RELAYS);
            if (!relayValidation.valid) {
              return Response.json({ 
                success: false, 
                error: relayValidation.error 
              }, { status: 400, headers });
            }
          }
          
          // Update only allowed keys
          const updatingCredentials = validKeys.some(key => ['GROUP_CRED', 'SHARE_CRED'].includes(key));
          const updatingRelays = validKeys.includes('RELAYS');
          
          for (const key of validKeys) {
            if (body[key] !== undefined) {
              env[key] = body[key];
            }
          }
          
          if (await writeEnvFile(env)) {
            // If credentials or relays were updated, recreate the node (with lock)
            if (updatingCredentials || updatingRelays) {
              try {
                await executeUnderNodeLock(async () => {
                  await createAndConnectServerNode(env, context);
                }, context);
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