import { createConnectedNode, createAndConnectNode } from '@frostr/igloo-core';
import { PrivilegedRouteContext, ServerBifrostNode } from './types.js';
import { getValidRelays } from './utils.js';
import { executeUnderNodeLock } from '../utils/node-lock.js';

type ConnectedNodeConfig = Parameters<typeof createConnectedNode>[0];
type BasicNodeConfig = Parameters<typeof createAndConnectNode>[0];

export interface NodeCredentials {
  group_cred: string;
  share_cred: string;
  relays?: string[] | null;
  group_name?: string | null;
}

/**
 * Creates and connects a Bifrost node using provided credentials
 * Works with both env-based and database-based credentials
 */
export async function createAndStartNode(
  credentials: NodeCredentials,
  context: PrivilegedRouteContext
): Promise<void> {
  return executeUnderNodeLock(async () => {
    // Check if we have the minimum required credentials
    if (!credentials.group_cred || !credentials.share_cred) {
      context.addServerLog('error', 'Cannot start node: missing group or share credentials');
      throw new Error('Missing group or share credentials');
    }

    // Properly dispose of existing node before creating a new one
    if (context.node) {
      context.addServerLog('info', 'Preparing to replace existing Bifrost node...');
      
      // updateNode handles all cleanup: cleanupBifrostNode, cleanupMonitoring, and resetHealthMonitoring
      context.updateNode(null);
      
      context.addServerLog('info', 'Previous node disposed successfully');
    }

    // Convert relays to the format expected by getValidRelays
    // credentials.relays is string[] | null from the database
    // getValidRelays expects a string (comma-separated or JSON array string)
    let relayString: string | undefined;
    if (credentials.relays && Array.isArray(credentials.relays)) {
      // Convert array to comma-separated string
      relayString = credentials.relays.join(',');
    }
    
    const nodeRelays = getValidRelays(relayString);
    
    let newNode: ServerBifrostNode | null = null;
    
    try {
      // Try enhanced node creation first (with connection state)
      const baseConfig: BasicNodeConfig = {
        group: credentials.group_cred,
        share: credentials.share_cred,
        relays: nodeRelays,
      };

      const enhancedConfig: ConnectedNodeConfig = {
        ...baseConfig,
        connectionTimeout: 5000, // 5 seconds for fast response
        autoReconnect: true
      };

      const result = await createConnectedNode(enhancedConfig, {
        enableLogging: false,
        logLevel: 'error'
      });
      
      if (result.node) {
        newNode = result.node;
        context.updateNode(newNode, {
          credentials: {
            group: credentials.group_cred,
            share: credentials.share_cred,
            relaysEnv: relayString,
            source: 'dynamic'
          }
        });
        context.addServerLog('info', 'Node connected and ready');
        
        if (result.state) {
          context.addServerLog('info', `Connected to ${result.state.connectedRelays.length}/${nodeRelays?.length ?? 0} relays`);
        }
      } else {
        throw new Error('Enhanced node creation returned no node');
      }
    } catch (enhancedError) {
      // Fall back to basic node creation
      context.addServerLog('info', 'Enhanced node creation failed, using basic connection...');
      
      try {
        const fallbackConfig: BasicNodeConfig = {
          group: credentials.group_cred,
          share: credentials.share_cred,
          relays: nodeRelays
        };
        const basicNode = await createAndConnectNode(fallbackConfig);
        
        if (basicNode) {
          newNode = basicNode;
          context.updateNode(newNode, {
            credentials: {
              group: credentials.group_cred,
              share: credentials.share_cred,
              relaysEnv: relayString,
              source: 'dynamic'
            }
          });
          context.addServerLog('info', 'Node connected and ready (basic mode)');
        }
      } catch (basicError) {
        context.addServerLog('error', 'Failed to create node with basic connection', basicError);
      }
    }
    
    if (!newNode) {
      context.addServerLog('error', 'Failed to create node after all attempts - both enhanced and basic connection methods failed');
      throw new Error('Failed to create node after all attempts - both enhanced and basic connection methods failed');
    }
  }, context);
}

/**
 * Clears all pending cleanup timers
 * Should be called on server shutdown
 * Note: Currently no timers are used since cleanup is handled by updateNode
 */
export function clearCleanupTimers(): void {
  // No timers to clear - cleanup is handled synchronously by updateNode
}
