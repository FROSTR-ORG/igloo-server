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
  getValidRelays,
  getSecureCorsHeaders 
} from './utils.js';
import { setupNodeEventListeners, cleanupHealthMonitoring } from '../node/manager.js';

// Add a lock to prevent concurrent node updates
let nodeUpdateLock: Promise<void> = Promise.resolve();

// Extracted node creation and connection logic with reduced timeout and retries
async function createAndConnectServerNode(env: any, context: PrivilegedRouteContext): Promise<void> {
  // Synchronize node updates to prevent race conditions
  nodeUpdateLock = nodeUpdateLock.then(async () => {
    // Clean up existing node if it exists
    if (context.node) {
      context.addServerLog('info', 'Cleaning up existing Bifrost node...');
      cleanupHealthMonitoring();
      // igloo-core handles cleanup internally
    }

    // Check if we now have both credentials
    if (env.SHARE_CRED && env.GROUP_CRED) {
      context.addServerLog('info', 'Creating and connecting node...');
      const nodeRelays = getValidRelays(env.RELAYS);
      let apiConnectionAttempts = 0;
      const apiMaxAttempts = 1; // Only 1 attempt for API responsiveness
      let newNode: ServerBifrostNode | null = null;
      
      // Node restart callback for health monitoring
      const nodeRestartCallback = () => {
        context.addServerLog('system', 'Node unhealthy - attempting restart via health monitoring');
        // Use a timeout to prevent blocking the current operation
        setTimeout(async () => {
          try {
            await createAndConnectServerNode(env, context);
          } catch (error) {
            context.addServerLog('error', 'Failed to restart node via health monitoring', error);
          }
        }, 1000);
      };
      
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
            // Set up health monitoring with restart callback
            setupNodeEventListeners(newNode, context.addServerLog, context.broadcastEvent, context.peerStatuses, nodeRestartCallback);
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
            // Set up health monitoring with restart callback
            setupNodeEventListeners(newNode, context.addServerLog, context.broadcastEvent, context.peerStatuses, nodeRestartCallback);
            context.addServerLog('info', 'Node connected and ready (basic mode)');
          }
        }
      }
      
      if (!newNode) {
        context.addServerLog('error', 'Failed to create node after all attempts');
      }
    } else {
      context.addServerLog('info', 'Insufficient credentials for node creation');
    }
  });
}

export async function handleEnvRoute(req: Request, url: URL, context: PrivilegedRouteContext): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/env')) return null;

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
          const env = await readEnvFile();
          const { filteredEnv } = filterEnvObject(env);
          return Response.json(filteredEnv, { headers });
        }
        
        if (req.method === 'POST') {
          const body = await req.json();
          const env = await readEnvFile();
          
          // Validate which keys are allowed to be updated
          const { validKeys, invalidKeys: rejectedKeys } = validateEnvKeys(Object.keys(body));
          
          // Update only allowed keys
          const updatingCredentials = validKeys.some(key => ['GROUP_CRED', 'SHARE_CRED'].includes(key));
          
          for (const key of validKeys) {
            if (body[key] !== undefined) {
              env[key] = body[key];
            }
          }
          
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
            if (deletingCredentials && context.node) {
              try {
                context.addServerLog('info', 'Credentials deleted, cleaning up Bifrost node...');
                cleanupHealthMonitoring();
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