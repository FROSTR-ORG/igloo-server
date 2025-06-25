import { serve } from 'bun';
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
  createNodeWithCredentials 
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
      setupNodeEventListeners(node, addServerLog, broadcastEvent, peerStatuses);
    }
  } catch (error) {
    addServerLog('error', 'Failed to create initial Bifrost node', error);
  }
} else {
  addServerLog('info', 'No credentials found, starting server without Bifrost node. Use the Configure page to set up credentials.');
}

// HTTP Server
serve({
  port: 8002,
  websocket: relay.handler(),
  fetch: async (req, server) => {
    if (server.upgrade(req)) return;
    const url = new URL(req.url);

    // Create route context
    const context = {
      node,
      peerStatuses,
      eventStreams,
      addServerLog,
      broadcastEvent,
      updateNode: (newNode: ServerBifrostNode | null) => {
        node = newNode;
        if (newNode) {
          setupNodeEventListeners(newNode, addServerLog, broadcastEvent, peerStatuses);
        }
      }
    };

    // Handle the request using the unified router
    return await handleRequest(req, url, context);
  }
});

console.log(`Server running at ${CONST.HOST_NAME}:${CONST.HOST_PORT}`);
addServerLog('info', `Server running at ${CONST.HOST_NAME}:${CONST.HOST_PORT}`);

// Note: Node event listeners are already set up in setupNodeEventListeners() if node exists
if (!node) {
  addServerLog('info', 'Node not initialized - credentials not available. Server is ready for configuration.');
}
