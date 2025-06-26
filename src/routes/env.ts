import { 
  createConnectedNode, 
  createAndConnectNode
} from '@frostr/igloo-core';
import { PrivilegedRouteContext, ServerBifrostNode } from './types.js';
import { 
  readEnvFile, 
  writeEnvFile, 
  filterEnvObject, 
  validateEnvKeys, 
  getValidRelays 
} from './utils.js';

// Add a lock to prevent concurrent node updates
let nodeUpdateLock: Promise<void> = Promise.resolve();

// Extracted node creation and connection logic with reduced timeout and retries
async function createAndConnectServerNode(env: any, context: PrivilegedRouteContext): Promise<void> {
  // Synchronize node updates to prevent race conditions
  nodeUpdateLock = nodeUpdateLock.then(async () => {
    // Clean up existing node if it exists
    if (context.node) {
      context.addServerLog('info', 'Cleaning up existing Bifrost node...');
      // igloo-core handles cleanup internally
    }

    // Check if we now have both credentials
    if (env.SHARE_CRED && env.GROUP_CRED) {
      context.addServerLog('info', 'Creating and connecting node...');
      const nodeRelays = getValidRelays(env.RELAYS);
      let apiConnectionAttempts = 0;
      const apiMaxAttempts = 1; // Only 1 attempt for API responsiveness
      let newNode: ServerBifrostNode | null = null;
      while (apiConnectionAttempts < apiMaxAttempts && !newNode) {
        apiConnectionAttempts++;
        try {
          const result = await createConnectedNode({
            group: env.GROUP_CRED,
            share: env.SHARE_CRED,
            relays: nodeRelays,
            connectionTimeout: 5000, // 5 seconds for fast API response
            autoReconnect: true
          }, {
            enableLogging: false,
            logLevel: 'error'
          });
          if (result.node) {
            newNode = result.node as unknown as ServerBifrostNode;
            if (context.updateNode) {
              context.updateNode(newNode);
            }
            context.addServerLog('info', 'Node connected and ready');
            if (result.state) {
              context.addServerLog('info', `Connected to ${result.state.connectedRelays.length}/${nodeRelays.length} relays`);
            }
            break;
          } else {
            throw new Error('Enhanced node creation returned no node');
          }
        } catch (enhancedError) {
          context.addServerLog('info', 'Enhanced node creation failed, using basic connection...');
          const basicNode = await createAndConnectNode({
            group: env.GROUP_CRED,
            share: env.SHARE_CRED,
            relays: nodeRelays
          });
          if (basicNode) {
            newNode = basicNode as unknown as ServerBifrostNode;
            if (context.updateNode) {
              context.updateNode(newNode);
            }
            context.addServerLog('info', 'Node connected and ready (basic mode)');
          }
        }
      }
    } else {
      context.addServerLog('info', 'Incomplete credentials, node not created');
      context.addServerLog('info', `Share credential: ${env.SHARE_CRED ? 'Present' : 'Missing'}, Group credential: ${env.GROUP_CRED ? 'Present' : 'Missing'}`);
    }
  });
  return nodeUpdateLock;
}

export async function handleEnvRoute(req: Request, url: URL, context: PrivilegedRouteContext): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/env')) return null;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    switch (url.pathname) {
      case '/api/env':
        if (req.method === 'GET') {
          const env = await readEnvFile();
          return Response.json(env, { headers });
        }
        
        if (req.method === 'POST') {
          const body = await req.json();
          const env = await readEnvFile();
          
          // Security: Validate and filter incoming environment variables
          const { filteredEnv, rejectedKeys } = filterEnvObject(body);
          
          if (rejectedKeys.length > 0) {
            console.warn(`Rejected unauthorized environment variable keys: ${rejectedKeys.join(', ')}`);
            context.addServerLog('warn', `Rejected unauthorized environment variable keys: ${rejectedKeys.join(', ')}`);
          }
          
          // Only proceed if we have valid keys to update
          if (Object.keys(filteredEnv).length === 0) {
            return Response.json({ 
              success: false, 
              message: 'No valid environment variables provided',
              rejectedKeys 
            }, { status: 400, headers });
          }
          
          // Check if we're updating credentials
          const updatingCredentials = 'SHARE_CRED' in filteredEnv || 'GROUP_CRED' in filteredEnv;
          
          // Update environment variables (only whitelisted ones)
          Object.assign(env, filteredEnv);
          
          if (await writeEnvFile(env)) {
            // If credentials were updated, recreate the node
            if (updatingCredentials) {
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
          
          // Validate that keys is an array
          if (!Array.isArray(keys)) {
            return Response.json({ 
              success: false, 
              message: 'Keys must be provided as an array' 
            }, { status: 400, headers });
          }
          
          const env = await readEnvFile();
          
          // Security: Validate keys against whitelist
          const { validKeys, invalidKeys } = validateEnvKeys(keys);
          
          if (invalidKeys.length > 0) {
            console.warn(`Rejected unauthorized deletion of environment variable keys: ${invalidKeys.join(', ')}`);
            context.addServerLog('warn', `Rejected unauthorized deletion of environment variable keys: ${invalidKeys.join(', ')}`);
          }
          
          // Only proceed if we have valid keys to delete
          if (validKeys.length === 0) {
            return Response.json({ 
              success: false, 
              message: 'No valid environment variables provided for deletion',
              rejectedKeys: invalidKeys 
            }, { status: 400, headers });
          }
          
          // Check if we're deleting credentials (only from valid keys)
          const deletingCredentials = validKeys.includes('SHARE_CRED') || validKeys.includes('GROUP_CRED');
          
          // Delete only whitelisted keys
          for (const key of validKeys) {
            delete env[key];
          }
          
          if (await writeEnvFile(env)) {
            // If credentials were deleted, clean up the node
            if (deletingCredentials && context.node) {
              try {
                context.addServerLog('info', 'Credentials deleted, cleaning up Bifrost node...');
                // Note: igloo-core handles cleanup internally
                if (context.updateNode) {
                  context.updateNode(null);
                }
                context.addServerLog('info', 'Bifrost node cleaned up successfully');
              } catch (error) {
                context.addServerLog('error', 'Error cleaning up Bifrost node', error);
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