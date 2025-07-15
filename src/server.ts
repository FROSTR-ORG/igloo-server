import { serve } from 'bun';
import { cleanupBifrostNode } from '@frostr/igloo-core';
import { NostrRelay } from './class/relay.js';
import * as CONST from './const.js';
import { 
  handleRequest, 
  PeerStatus, 
  ServerBifrostNode 
} from './routes/index.js';
import { 
  createBroadcastEvent, 
  createAddServerLog, 
  setupNodeEventListeners, 
  createNodeWithCredentials,
  cleanupHealthMonitoring
} from './node/manager.js';

// Event streaming for frontend
const eventStreams = new Set<ReadableStreamDefaultController>();

// Peer status tracking
let peerStatuses = new Map<string, PeerStatus>();

// Create event management functions
const broadcastEvent = createBroadcastEvent(eventStreams);
const addServerLog = createAddServerLog(broadcastEvent);

// Create the Nostr relay
const relay = new NostrRelay();

// Create and connect the Bifrost node using igloo-core only if credentials are available
let node: ServerBifrostNode | null = null;

// Node restart logic
async function restartNode(reason: string = 'health check failure') {
  addServerLog('system', `Restarting node due to: ${reason}`);
  
  try {
    // Clean up existing node
    if (node) {
      try {
        cleanupBifrostNode(node as any);
      } catch (err) {
        addServerLog('warn', 'Failed to clean up previous node during restart', err);
      }
    }
    
    // Clean up health monitoring
    cleanupHealthMonitoring();
    
    // Clear peer statuses
    peerStatuses.clear();
    
    // Wait a moment before recreating
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Recreate node if we have credentials
    if (CONST.hasCredentials()) {
      const newNode = await createNodeWithCredentials(
        CONST.GROUP_CRED!,
        CONST.SHARE_CRED!,
        process.env.RELAYS,
        addServerLog
      );
      
      if (newNode) {
        node = newNode;
        setupNodeEventListeners(node, addServerLog, broadcastEvent, peerStatuses, () => {
          // Recursive restart callback
          restartNode('recursive health check failure');
        });
        addServerLog('system', 'Node successfully restarted');
      } else {
        addServerLog('error', 'Failed to restart node - will retry later');
        // Schedule another restart attempt
        setTimeout(() => {
          restartNode('retry after failed restart');
        }, 30000); // Wait 30 seconds before retrying
      }
    } else {
      addServerLog('error', 'Cannot restart node - no credentials available');
    }
  } catch (error) {
    addServerLog('error', 'Error during node restart', error);
    // Schedule another restart attempt
    setTimeout(() => {
      restartNode('retry after error');
    }, 30000); // Wait 30 seconds before retrying
  }
}

// Initial node setup
if (CONST.hasCredentials()) {
  addServerLog('info', 'Creating and connecting node...');
  try {
    node = await createNodeWithCredentials(
      CONST.GROUP_CRED!,
      CONST.SHARE_CRED!,
      process.env.RELAYS,
      addServerLog
    );
    
    if (node) {
      setupNodeEventListeners(node, addServerLog, broadcastEvent, peerStatuses, () => {
        // Node unhealthy callback
        restartNode('watchdog timeout');
      });
    }
  } catch (error) {
    addServerLog('error', 'Failed to create initial Bifrost node', error);
  }
} else {
  addServerLog('info', 'No credentials found, starting server without Bifrost node. Use the Configure page to set up credentials.');
}

// Create the updateNode function for privileged routes
const updateNode = (newNode: ServerBifrostNode | null) => {
  // Clean up the old node to prevent memory leaks
  if (node) {
    try {
      // Cast to any to handle type mismatch - igloo-core cleanup accepts broader types
      cleanupBifrostNode(node as any);
    } catch (err) {
      addServerLog('warn', 'Failed to clean up previous node', err);
    }
  }
  
  // Clean up health monitoring
  cleanupHealthMonitoring();
  
  node = newNode;
  if (newNode) {
    setupNodeEventListeners(newNode, addServerLog, broadcastEvent, peerStatuses, () => {
      // Node unhealthy callback for dynamically created nodes
      restartNode('dynamic node watchdog timeout');
    });
  }
};

// HTTP Server
serve({
  port: CONST.HOST_PORT,
  hostname: CONST.HOST_NAME,
  websocket: relay.handler(),
  fetch: async (req, server) => {
    if (server.upgrade(req)) return;
    const url = new URL(req.url);

    // Create base (restricted) context for general routes
    const baseContext = {
      node,
      peerStatuses,
      eventStreams,
      addServerLog,
      broadcastEvent
    };

    // Create privileged context with updateNode for trusted routes  
    const privilegedContext = {
      ...baseContext,
      updateNode
    };

    // Handle the request using the unified router with appropriate context
    return await handleRequest(req, url, baseContext, privilegedContext);
  }
});

console.log(`Server running at ${CONST.HOST_NAME}:${CONST.HOST_PORT}`);
addServerLog('info', `Server running at ${CONST.HOST_NAME}:${CONST.HOST_PORT}`);

// Note: Node event listeners are already set up in setupNodeEventListeners() if node exists
if (!node) {
  addServerLog('info', 'Node not initialized - credentials not available. Server is ready for configuration.');
}

// Graceful shutdown handling
process.on('SIGTERM', () => {
  addServerLog('system', 'Received SIGTERM, shutting down gracefully');
  cleanupHealthMonitoring();
  process.exit(0);
});

process.on('SIGINT', () => {
  addServerLog('system', 'Received SIGINT, shutting down gracefully');
  cleanupHealthMonitoring();
  process.exit(0);
});
