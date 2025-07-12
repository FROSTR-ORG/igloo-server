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
  createNodeWithCredentials 
} from './node/manager.js';

// Event streaming for frontend - WebSocket connections
const eventStreams = new Set<any>();

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
  node = newNode;
  if (newNode) {
    setupNodeEventListeners(newNode, addServerLog, broadcastEvent, peerStatuses);
  }
};

// WebSocket handler for event streaming and Nostr relay
const websocketHandler = {
  message(ws: any, message: string | Buffer) {
    // Check if this is an event stream WebSocket or relay WebSocket
    if (ws.data?.isEventStream) {
      // Handle event stream WebSocket messages if needed
      // Currently, event stream is one-way (server to client)
      return;
    } else {
      // Delegate to NostrRelay handler
      return relay.handler().message?.(ws, message);
    }
  },
  open(ws: any) {
    // Check if this is an event stream WebSocket
    if (ws.data?.isEventStream) {
      // Mark WebSocket for identification and add to event streams
      (ws as any)._isEventStream = true;
      eventStreams.add(ws);
      
      // Send initial connection event
      const connectEvent = {
        type: 'system',
        message: 'Connected to event stream',
        timestamp: new Date().toLocaleTimeString(),
        id: Math.random().toString(36).substring(2, 11)
      };
      
      try {
        ws.send(JSON.stringify(connectEvent));
      } catch (error) {
        console.error('Error sending initial event:', error);
      }
    } else {
      // Delegate to NostrRelay handler
      return relay.handler().open?.(ws);
    }
  },
  close(ws: any, code: number, reason: string) {
    // Check if this is an event stream WebSocket
    if (ws.data?.isEventStream || (ws as any)._isEventStream) {
      // Remove from event streams
      eventStreams.delete(ws);
    } else {
      // Delegate to NostrRelay handler
      return relay.handler().close?.(ws, code, reason);
    }
  }
};

// HTTP Server
serve({
  port: CONST.HOST_PORT,
  hostname: CONST.HOST_NAME,
  websocket: websocketHandler,
  fetch: async (req, server) => {
    const url = new URL(req.url);
    
    // Handle WebSocket upgrade for event stream
    if (url.pathname === '/api/events' && req.headers.get('upgrade') === 'websocket') {
      // Check authentication for WebSocket upgrade
      const { authenticate, AUTH_CONFIG } = await import('./routes/auth.js');
      
      if (AUTH_CONFIG.ENABLED) {
        // For WebSocket, check URL parameters for auth info since headers may not be available
        const apiKey = url.searchParams.get('apiKey');
        const sessionId = url.searchParams.get('sessionId');
        
        let authReq = req;
        
        // If we have URL parameters, create a modified request with the auth headers
        if (apiKey) {
          const headers = new Headers(req.headers);
          headers.set('X-API-Key', apiKey);
          authReq = new Request(req.url, {
            method: req.method,
            headers: headers,
            body: req.body
          });
        } else if (sessionId) {
          const headers = new Headers(req.headers);
          headers.set('X-Session-ID', sessionId);
          authReq = new Request(req.url, {
            method: req.method,
            headers: headers,
            body: req.body
          });
        }
        
        const authResult = authenticate(authReq);
        if (!authResult.authenticated) {
          return new Response('Unauthorized', { 
            status: 401,
            headers: {
              'Content-Type': 'text/plain'
            }
          });
        }
      }
      
      const upgraded = server.upgrade(req, {
        data: { isEventStream: true }
      });
      
      if (upgraded) {
        return undefined; // WebSocket upgrade successful
      }
    }
    
    // Handle WebSocket upgrade for Nostr relay
    if (url.pathname === '/' && req.headers.get('upgrade') === 'websocket') {
      const upgraded = server.upgrade(req, {
        data: { isEventStream: false }
      });
      
      if (upgraded) {
        return undefined; // WebSocket upgrade successful
      }
    }

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
