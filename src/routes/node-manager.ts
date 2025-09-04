import { createConnectedNode, createAndConnectNode } from '@frostr/igloo-core';
import { ServerBifrostNode } from '../types/bifrost-node.js';
import { PrivilegedRouteContext } from './types.js';
import { getValidRelays } from './utils.js';

// Add a lock to prevent concurrent node updates
let nodeUpdateLock: Promise<void> = Promise.resolve();

// Helper function to execute node operations under lock without poisoning the queue
async function executeUnderNodeLock<T>(
  operation: () => Promise<T>,
  context: PrivilegedRouteContext
): Promise<T> {
  // Create a promise for this specific operation
  const run = nodeUpdateLock.then(operation);
  
  // Update the lock to wait for this operation, but not for its errors
  nodeUpdateLock = run.then(
    () => {}, // Success: just continue
    (error) => {
      // Failure: log it but don't propagate to next operation
      context.addServerLog('error', 'Node operation failed', error);
    }
  );
  
  // Return the actual promise so the caller gets the result/error
  return run;
}

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
      return;
    }

    // Log node replacement if applicable
    if (context.node) {
      context.addServerLog('info', 'Preparing to replace existing Bifrost node...');
    }

    const nodeRelays = getValidRelays(
      credentials.relays ? JSON.stringify(credentials.relays) : undefined
    );
    
    let newNode: ServerBifrostNode | null = null;
    
    try {
      // Try enhanced node creation first (with connection state)
      const result = await createConnectedNode({
        group: credentials.group_cred,
        share: credentials.share_cred,
        relays: nodeRelays,
        connectionTimeout: 5000, // 5 seconds for fast response
        autoReconnect: true
      }, {
        enableLogging: false,
        logLevel: 'error'
      });
      
      if (result.node) {
        newNode = result.node as unknown as ServerBifrostNode;
        context.updateNode(newNode);
        context.addServerLog('info', 'Node connected and ready');
        
        if (result.state) {
          context.addServerLog('info', `Connected to ${result.state.connectedRelays.length}/${nodeRelays.length} relays`);
        }
      } else {
        throw new Error('Enhanced node creation returned no node');
      }
    } catch (enhancedError) {
      // Fall back to basic node creation
      context.addServerLog('info', 'Enhanced node creation failed, using basic connection...');
      
      try {
        const basicNode = await createAndConnectNode({
          group: credentials.group_cred,
          share: credentials.share_cred,
          relays: nodeRelays
        });
        
        if (basicNode) {
          newNode = basicNode as unknown as ServerBifrostNode;
          context.updateNode(newNode);
          context.addServerLog('info', 'Node connected and ready (basic mode)');
        }
      } catch (basicError) {
        context.addServerLog('error', 'Failed to create node with basic connection', basicError);
      }
    }
    
    if (!newNode) {
      context.addServerLog('error', 'Failed to create node after all attempts');
    }
  });
}