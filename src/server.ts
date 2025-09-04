import { serve, type ServerWebSocket } from 'bun';
import { cleanupBifrostNode } from '@frostr/igloo-core';
import { NostrRelay } from './class/relay.js';
import * as CONST from './const.js';
import { closeDatabase } from './db/database.js';
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
  cleanupMonitoring,
  resetHealthMonitoring
} from './node/manager.js';

// Node restart configuration with validation
const parseRestartConfig = () => {
  const initialRetryDelay = parseInt(process.env.NODE_RESTART_DELAY || '30000');
  const maxRetryAttempts = parseInt(process.env.NODE_MAX_RETRIES || '5');
  const backoffMultiplier = parseFloat(process.env.NODE_BACKOFF_MULTIPLIER || '1.5');
  const maxRetryDelay = parseInt(process.env.NODE_MAX_RETRY_DELAY || '300000');

  // Validation with safe defaults
  const validatedConfig = {
    INITIAL_RETRY_DELAY: (initialRetryDelay > 0 && initialRetryDelay <= 3600000) ? initialRetryDelay : 30000, // 1ms to 1 hour max
    MAX_RETRY_ATTEMPTS: (maxRetryAttempts > 0 && maxRetryAttempts <= 100) ? maxRetryAttempts : 5, // 1 to 100 attempts max
    BACKOFF_MULTIPLIER: (backoffMultiplier >= 1.0 && backoffMultiplier <= 10) ? backoffMultiplier : 1.5, // 1.0 to 10x multiplier
    MAX_RETRY_DELAY: (maxRetryDelay > 0 && maxRetryDelay <= 7200000) ? maxRetryDelay : 300000, // 1ms to 2 hours max
  };

  // Log validation warnings if defaults were used
  if (initialRetryDelay !== validatedConfig.INITIAL_RETRY_DELAY) {
    console.warn(`Invalid NODE_RESTART_DELAY: ${initialRetryDelay}. Using default: ${validatedConfig.INITIAL_RETRY_DELAY}ms`);
  }
  if (maxRetryAttempts !== validatedConfig.MAX_RETRY_ATTEMPTS) {
    console.warn(`Invalid NODE_MAX_RETRIES: ${maxRetryAttempts}. Using default: ${validatedConfig.MAX_RETRY_ATTEMPTS}`);
  }
  if (backoffMultiplier !== validatedConfig.BACKOFF_MULTIPLIER) {
    console.warn(`Invalid NODE_BACKOFF_MULTIPLIER: ${backoffMultiplier}. Using default: ${validatedConfig.BACKOFF_MULTIPLIER}`);
  }
  if (maxRetryDelay !== validatedConfig.MAX_RETRY_DELAY) {
    console.warn(`Invalid NODE_MAX_RETRY_DELAY: ${maxRetryDelay}. Using default: ${validatedConfig.MAX_RETRY_DELAY}ms`);
  }

  return validatedConfig;
};

const RESTART_CONFIG = parseRestartConfig();

// WebSocket data type for event streams
type EventStreamData = { isEventStream: true };

// Event streaming for frontend - WebSocket connections
const eventStreams = new Set<ServerWebSocket<EventStreamData>>();

// Peer status tracking
let peerStatuses = new Map<string, PeerStatus>();



// Create event management functions
const broadcastEvent = createBroadcastEvent(eventStreams);
const addServerLog = createAddServerLog(broadcastEvent);

// Initialize database if not in headless mode
if (!CONST.HEADLESS) {
  console.log('🗄️  Database mode enabled - using SQLite for user management');
  if (!CONST.ADMIN_SECRET) {
    console.warn('⚠️  ADMIN_SECRET not set - onboarding will require configuration');
  }
} else {
  console.log('📁 Headless mode enabled - using environment variables');
}

// Create the Nostr relay
const relay = new NostrRelay();

// Create and connect the Bifrost node using igloo-core only if credentials are available
let node: ServerBifrostNode | null = null;

// Node restart state management
let isRestartInProgress = false;
let currentRetryCount = 0;
let restartTimeout: ReturnType<typeof setTimeout> | null = null;

// Node restart logic with concurrency control and exponential backoff
async function restartNode(reason: string = 'health check failure', forceRestart: boolean = false) {
  // Prevent concurrent restarts unless forced
  if (isRestartInProgress && !forceRestart) {
    addServerLog('warn', `Restart already in progress, skipping restart request: ${reason}`);
    return;
  }
  
  // Clear any pending restart timeout
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  
  isRestartInProgress = true;
  addServerLog('system', `Restarting node due to: ${reason} (attempt ${currentRetryCount + 1}/${RESTART_CONFIG.MAX_RETRY_ATTEMPTS})`);
  
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
    cleanupMonitoring();
    
    // Reset health monitoring state for fresh start
    resetHealthMonitoring();
    
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
          // Controlled restart callback to prevent infinite recursion
          scheduleRestartWithBackoff('watchdog timeout');
        }, CONST.GROUP_CRED, CONST.SHARE_CRED);
        addServerLog('system', 'Node successfully restarted');
        
        // Reset retry count on successful restart
        currentRetryCount = 0;
        isRestartInProgress = false;
        return;
      } else {
        throw new Error('Failed to create new node - createNodeWithCredentials returned null');
      }
    } else {
      throw new Error('Cannot restart node - no credentials available');
    }
  } catch (error) {
    addServerLog('error', 'Error during node restart', error);
    
    // Schedule retry with exponential backoff if we haven't exceeded max attempts
    scheduleRestartWithBackoff(reason);
  } finally {
    isRestartInProgress = false;
  }
}

// Schedule restart with exponential backoff and retry limit
function scheduleRestartWithBackoff(reason: string) {
  if (currentRetryCount >= RESTART_CONFIG.MAX_RETRY_ATTEMPTS) {
    addServerLog('error', `Max restart attempts (${RESTART_CONFIG.MAX_RETRY_ATTEMPTS}) exceeded. Node restart abandoned.`);
    currentRetryCount = 0;
    return;
  }
  
  // Prevent duplicate scheduled restarts
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  
  // Calculate delay with exponential backoff
  const baseDelay = RESTART_CONFIG.INITIAL_RETRY_DELAY;
  const backoffDelay = Math.min(
    baseDelay * Math.pow(RESTART_CONFIG.BACKOFF_MULTIPLIER, currentRetryCount),
    RESTART_CONFIG.MAX_RETRY_DELAY
  );
  
  addServerLog('system', `Scheduling restart in ${Math.round(backoffDelay / 1000)}s (attempt ${currentRetryCount + 1}/${RESTART_CONFIG.MAX_RETRY_ATTEMPTS})`);
  
  currentRetryCount++;
  
  restartTimeout = setTimeout(() => {
    restartNode(`retry: ${reason}`, false);
  }, backoffDelay);
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
          scheduleRestartWithBackoff('watchdog timeout');
        }, CONST.GROUP_CRED, CONST.SHARE_CRED);
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
  cleanupMonitoring();
  
  // Reset health monitoring state for fresh start
  resetHealthMonitoring();
  
  node = newNode;
  if (newNode) {
    setupNodeEventListeners(newNode, addServerLog, broadcastEvent, peerStatuses, () => {
      // Node unhealthy callback for dynamically created nodes
      scheduleRestartWithBackoff('dynamic node watchdog timeout');
    }, CONST.GROUP_CRED, CONST.SHARE_CRED);
  }
};

// WebSocket handler for event streaming and Nostr relay
const websocketHandler = {
  message(ws: ServerWebSocket<any>, message: string | Buffer) {
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
  open(ws: ServerWebSocket<any>) {
    // Check if this is an event stream WebSocket
    if (ws.data?.isEventStream) {
      // Add to event streams (with type assertion for compatibility)
      eventStreams.add(ws as ServerWebSocket<EventStreamData>);
      
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
  close(ws: ServerWebSocket<any>, code: number, reason: string) {
    // Check if this is an event stream WebSocket
    if (ws.data?.isEventStream) {
      // Remove from event streams (with type assertion for compatibility)
      eventStreams.delete(ws as ServerWebSocket<EventStreamData>);
    } else {
      // Delegate to NostrRelay handler
      return relay.handler().close?.(ws, code, reason);
    }
  },
  error(ws: ServerWebSocket<any>, error: Error) {
    // Check if this is an event stream WebSocket
    if (ws.data?.isEventStream) {
      console.error('Event stream WebSocket error:', error);
      // Remove from event streams to prevent further errors (with type assertion)
      eventStreams.delete(ws as ServerWebSocket<EventStreamData>);
    } else {
      // Delegate to NostrRelay handler if it has an error method
      const relayHandler = relay.handler();
      if ('error' in relayHandler && typeof relayHandler.error === 'function') {
        return relayHandler.error(ws, error);
      } else {
        console.error('Relay WebSocket error:', error);
      }
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
            headers: headers
            // Note: WebSocket upgrade requests should not have bodies
          });
        } else if (sessionId) {
          const headers = new Headers(req.headers);
          headers.set('X-Session-ID', sessionId);
          authReq = new Request(req.url, {
            method: req.method,
            headers: headers
            // Note: WebSocket upgrade requests should not have bodies
          });
        }
        
        const authResult = authenticate(authReq);
        if (!authResult.authenticated) {
          return new Response('Unauthorized', { 
            status: 401,
            headers: {
              'Content-Type': 'text/plain',
              'WWW-Authenticate': 'Bearer realm="WebSocket"'
            }
          });
        }
      }
      
      const upgraded = server.upgrade(req, {
        data: { isEventStream: true }
      });
      
      if (upgraded) {
        return undefined; // WebSocket upgrade successful
      } else {
        // WebSocket upgrade failed
        return new Response('WebSocket upgrade failed', { 
          status: 400,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
      }
    }
    
    // Handle WebSocket upgrade for Nostr relay
    if (url.pathname === '/' && req.headers.get('upgrade') === 'websocket') {
      const upgraded = server.upgrade(req, {
        data: { isEventStream: false }
      });
      
      if (upgraded) {
        return undefined; // WebSocket upgrade successful
      } else {
        // WebSocket upgrade failed
        return new Response('WebSocket upgrade failed', { 
          status: 400,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
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

// Graceful shutdown handling
process.on('SIGTERM', () => {
  addServerLog('system', 'Received SIGTERM, shutting down gracefully');
  
  // Clear any pending restart timeout
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  
  cleanupMonitoring();
  
  // Close database connection if not in headless mode
  if (!CONST.HEADLESS) {
    closeDatabase();
  }
  
  process.exit(0);
});

process.on('SIGINT', () => {
  addServerLog('system', 'Received SIGINT, shutting down gracefully');
  
  // Clear any pending restart timeout
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  
  cleanupMonitoring();
  
  // Close database connection if not in headless mode
  if (!CONST.HEADLESS) {
    closeDatabase();
  }
  
  process.exit(0);
});
