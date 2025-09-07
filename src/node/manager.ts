import { 
  createAndConnectNode, 
  createConnectedNode,
  normalizePubkey,
  extractSelfPubkeyFromCredentials
} from '@frostr/igloo-core';
import { ServerBifrostNode, PeerStatus } from '../routes/types.js';
import { getValidRelays, safeStringify } from '../routes/utils.js';
import type { ServerWebSocket } from 'bun';

// WebSocket ready state constants
const READY_STATE_OPEN = 1;

// WebSocket data type for event streams
type EventStreamData = { isEventStream: true };

// Event mapping for cleaner message handling - matching Igloo Desktop
const EVENT_MAPPINGS = {
  '/sign/req': { type: 'sign', message: 'Signature request received' },
  '/sign/res': { type: 'sign', message: 'Signature response sent' },
  '/sign/rej': { type: 'sign', message: 'Signature request rejected' },
  '/sign/ret': { type: 'sign', message: 'Signature shares aggregated' },
  '/sign/err': { type: 'sign', message: 'Signature share aggregation failed' },
  '/ecdh/req': { type: 'ecdh', message: 'ECDH request received' },
  '/ecdh/res': { type: 'ecdh', message: 'ECDH response sent' },
  '/ecdh/rej': { type: 'ecdh', message: 'ECDH request rejected' },
  '/ecdh/ret': { type: 'ecdh', message: 'ECDH shares aggregated' },
  '/ecdh/err': { type: 'ecdh', message: 'ECDH share aggregation failed' },
  '/ping/req': { type: 'bifrost', message: 'Ping request' },
  '/ping/res': { type: 'bifrost', message: 'Ping response' },
} as const;

// Simplified monitoring constants
const CONNECTIVITY_CHECK_INTERVAL = 60000; // Check connectivity every minute
const IDLE_THRESHOLD = 45000; // Consider idle after 45 seconds
const CONNECTIVITY_PING_TIMEOUT = 10000; // 10 second timeout for connectivity pings

/**
 * Race a promise against a timeout and ensure the timeout is cleared once settled.
 * Prevents stray timer callbacks from rejecting after the race is over.
 *
 * @param promise The promise to race against the timeout
 * @param timeoutMs The timeout in milliseconds
 * @returns The original promise's resolved value, or rejects on timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new Error('Ping timeout');

  const wrapped = new Promise<T>((resolve, reject) => {
    timeoutId = setTimeout(() => reject(timeoutError), timeoutMs);
    promise.then(
      value => resolve(value),
      error => reject(error)
    );
  });

  return wrapped.finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

// Simplified monitoring state
interface NodeHealth {
  lastActivity: Date;
  lastConnectivityCheck: Date;
  isConnected: boolean;
  consecutiveConnectivityFailures: number;
}

let nodeHealth: NodeHealth = {
  lastActivity: new Date(),
  lastConnectivityCheck: new Date(),
  isConnected: true,
  consecutiveConnectivityFailures: 0
};

let connectivityCheckInterval: ReturnType<typeof setInterval> | null = null;
let connectivityCheckInFlight = false;
let nodeRecreateCallback: (() => Promise<void>) | null = null;

// Helper function to update node activity
function updateNodeActivity(addServerLog: ReturnType<typeof createAddServerLog>, isKeepalive: boolean = false) {
  const now = new Date();
  nodeHealth.lastActivity = now;
  
  // Reset connectivity failures on real activity (not keepalive)
  if (!isKeepalive && nodeHealth.consecutiveConnectivityFailures > 0) {
    nodeHealth.consecutiveConnectivityFailures = 0;
    nodeHealth.isConnected = true;
    addServerLog('info', 'Node activity detected - connectivity restored');
  } else if (!isKeepalive && !nodeHealth.isConnected) {
    // Only log if we were previously disconnected
    nodeHealth.isConnected = true;
    addServerLog('info', 'Node activity detected - connection active');
  }
}

// Helper function to check and maintain relay connectivity
async function checkRelayConnectivity(
  node: ServerBifrostNode | null,
  addServerLog: ReturnType<typeof createAddServerLog>
): Promise<boolean> {
  const now = new Date();
  nodeHealth.lastConnectivityCheck = now;
  
  try {
    // Validate node before accessing its properties
    if (node === null || typeof node !== 'object') {
      addServerLog('warning', 'Node is null or invalid, marking as failure', { nodeType: node === null ? 'null' : typeof node });
      nodeHealth.isConnected = false;
      nodeHealth.consecutiveConnectivityFailures++;
      if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
        addServerLog('info', 'Recreating node after 3 failed checks due to null/invalid node');
        await nodeRecreateCallback();
      }
      return false;
    }
    // First check if the node client itself exists
    const client = (node as any)._client || (node as any).client;
    if (!client) {
      addServerLog('warning', 'Node client not available, will recreate on next check');
      nodeHealth.isConnected = false; // Explicitly mark as disconnected
      nodeHealth.consecutiveConnectivityFailures++;
      
      // Trigger node recreation if client is missing for too long
      if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
        addServerLog('info', 'Recreating node after 3 failed checks');
        await nodeRecreateCallback();
      }
      return false;
    }
    
    // CRITICAL: Check if SimplePool connections are actually alive
    // SimplePool doesn't auto-reconnect, so we need to manually check and reconnect
    const pool = client._pool || client.pool;
    if (pool && typeof pool.listConnectionStatus === 'function') {
      const connectionStatuses = pool.listConnectionStatus();
      let disconnectedRelays = [];
      
      for (const [url, isConnected] of connectionStatuses) {
        if (!isConnected) {
          disconnectedRelays.push(url);
        }
      }
      
      // If we have disconnected relays, try to reconnect them
      if (disconnectedRelays.length > 0) {
        addServerLog('warning', `Found ${disconnectedRelays.length} disconnected relay(s), attempting reconnection`);
        
        // Check if it's been too long since real activity (not just keepalive)
        const timeSinceRealActivity = now.getTime() - nodeHealth.lastActivity.getTime();
        const tooLongWithoutActivity = timeSinceRealActivity > 300000; // 5 minutes
        
        if (tooLongWithoutActivity) {
          // If no real activity for 5+ minutes AND relays are disconnecting, recreate node
          addServerLog('warning', `No real activity for ${Math.round(timeSinceRealActivity / 60000)} minutes and relays disconnected`);
          nodeHealth.consecutiveConnectivityFailures++;
          
          if (nodeRecreateCallback) {
            addServerLog('info', 'Recreating node due to prolonged inactivity with relay issues');
            await nodeRecreateCallback();
            return false;
          }
        }
        
        for (const url of disconnectedRelays) {
          try {
            // Use ensureRelay to reconnect
            if (typeof pool.ensureRelay === 'function') {
              await pool.ensureRelay(url, { connectionTimeout: 10000 });
              addServerLog('info', `Reconnected to relay: ${url}`);
            }
          } catch (reconnectError) {
            addServerLog('error', `Failed to reconnect to ${url}`, reconnectError);
          }
        }
        
        // Check again after reconnection attempts
        const newStatuses = pool.listConnectionStatus();
        let stillDisconnected = 0;
        for (const [_, connected] of newStatuses) {
          if (!connected) stillDisconnected++;
        }
        
        if (stillDisconnected > 0) {
          nodeHealth.consecutiveConnectivityFailures++;
          
          if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
            addServerLog('error', 'Unable to reconnect to relays after 3 attempts, recreating node');
            await nodeRecreateCallback();
            return false;
          }
          
          return false;
        } else {
          // Successfully reconnected but don't update activity here
          // Only real events should update activity
          nodeHealth.consecutiveConnectivityFailures = 0;
        }
      }
    }
    
    // Check if we've been idle too long
    const timeSinceLastActivity = now.getTime() - nodeHealth.lastActivity.getTime();
    const isIdle = timeSinceLastActivity > IDLE_THRESHOLD;
    
    // If no real activity for 10 minutes, recreate node regardless of connection status
    // This handles cases where subscriptions are lost but connections appear OK
    if (timeSinceLastActivity > 600000) { // 10 minutes
      addServerLog('warning', `No real activity for ${Math.round(timeSinceLastActivity / 60000)} minutes, recreating node`);
      if (nodeRecreateCallback) {
        await nodeRecreateCallback();
        return false;
      }
    }
    
    // If we're idle AND connected, send a keepalive ping (if available)
    if (isIdle) {
      // Check if ping function exists
      if (typeof (node as any).ping !== 'function') {
        // No ping capability - this is not a critical failure
        // The relay reconnection logic above is sufficient for maintaining connectivity
        // Check if we have any connected relays from the pool check above
        if (pool && typeof pool.listConnectionStatus === 'function') {
          const connectionStatuses = pool.listConnectionStatus();
          const hasConnectedRelays = Array.from(connectionStatuses.values()).some(connected => connected);
          if (hasConnectedRelays) {
            // Don't update activity here - only real events should update it
            nodeHealth.isConnected = true;
            nodeHealth.consecutiveConnectivityFailures = 0;
            return true;
          }
        }
        // No connected relays and no ping capability
        nodeHealth.isConnected = false;
        nodeHealth.consecutiveConnectivityFailures++;
        
        if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
          addServerLog('info', 'No connected relays and no ping capability, recreating node');
          await nodeRecreateCallback();
        }
        return false;
      }
      
      try {
        // Get list of peer pubkeys from the node
        const peers = (node as any)._peers || (node as any).peers || [];
        
        if (peers.length === 0) {
          // No peers available - not critical if relays are connected
          addServerLog('debug', 'No peers available for keepalive ping, relying on relay connections');
          // Check relay connections again
          if (pool && typeof pool.listConnectionStatus === 'function') {
            const connectionStatuses = pool.listConnectionStatus();
            const hasConnectedRelays = Array.from(connectionStatuses.values()).some(connected => connected);
            if (hasConnectedRelays) {
              // Don't update activity here - only real events should update it
              nodeHealth.isConnected = true;
              nodeHealth.consecutiveConnectivityFailures = 0;
              return true;
            }
          }
          nodeHealth.isConnected = false;
          nodeHealth.consecutiveConnectivityFailures++;
          
          if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
            addServerLog('info', 'No peers and no connected relays, recreating node');
            await nodeRecreateCallback();
          }
          return false;
        }
        
        // Send a ping to the first available peer
        const targetPeer = peers[0];
        const peerPubkey = targetPeer.pubkey || targetPeer;
        
        // Race ping with timeout using helper to avoid stray rejections
        const pingResult = await withTimeout((node as any).ping(peerPubkey), CONNECTIVITY_PING_TIMEOUT)
          .then((res: any) => res as any)
          .catch((err: any) => ({ ok: false, err: err?.message || 'ping failed' })) as { ok?: boolean; err?: unknown };
        
        if (pingResult && pingResult.ok) {
          // Ping succeeded - connection is good!
          updateNodeActivity(addServerLog, true);
          nodeHealth.isConnected = true;
          nodeHealth.consecutiveConnectivityFailures = 0;
          return true;
        } else {
          // Ping failed - always mark as disconnected and increment failures
          nodeHealth.isConnected = false;
          nodeHealth.consecutiveConnectivityFailures++;
          
          // Safely convert error to string for checking
          const errorStr = String(pingResult?.err || 'unknown').toLowerCase();
          
          // Log appropriate message based on error type
          if (errorStr.includes('timeout')) {
            addServerLog('warning', `Keepalive ping timed out after ${CONNECTIVITY_PING_TIMEOUT}ms`);
          } else if (errorStr.includes('closed') || errorStr.includes('disconnect')) {
            addServerLog('warning', `Ping failed with connection error: ${errorStr}`);
          } else {
            addServerLog('warning', `Ping failed: ${errorStr}`);
          }
          
          // Recreate after 3 failures
          if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
            addServerLog('info', 'Persistent ping failures, recreating node');
            await nodeRecreateCallback();
          }
          return false;
        }
      } catch (pingError: any) {
        // Any exception is a failure - mark as disconnected
        nodeHealth.isConnected = false;
        nodeHealth.consecutiveConnectivityFailures++;
        
        // Safely convert error to string
        const errorStr = String(pingError?.message || pingError || 'unknown error').toLowerCase();
        addServerLog('warning', `Keepalive ping error: ${errorStr}`);
        
        if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
          addServerLog('info', 'Ping errors exceeded threshold, recreating node');
          await nodeRecreateCallback();
        }
        return false;
      }
    }
    
    // Everything looks good
    nodeHealth.isConnected = true;
    nodeHealth.consecutiveConnectivityFailures = 0;
    return true;
    
  } catch (error) {
    addServerLog('error', 'Connectivity check error', error);
    nodeHealth.consecutiveConnectivityFailures++;
    
    // Simple recreation after repeated failures
    if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
      addServerLog('info', 'Connectivity errors exceeded threshold, recreating node');
      await nodeRecreateCallback();
    }
    return false;
  }
}


// Start simplified connectivity monitoring
function startConnectivityMonitoring(
  node: ServerBifrostNode | null,
  addServerLog: ReturnType<typeof createAddServerLog>,
  recreateNodeFn: () => Promise<void>
) {
  stopConnectivityMonitoring();
  
  // Store recreation callback even if node is null - we may need it for recovery
  nodeRecreateCallback = recreateNodeFn;
  
  if (!node) {
    addServerLog('warning', 'Starting connectivity monitoring with null node - will attempt recovery');
    // Mark as unhealthy to trigger recovery
    nodeHealth.isConnected = false;
    nodeHealth.consecutiveConnectivityFailures = 1;
  } else {
    addServerLog('system', 'Starting simplified connectivity monitoring with keepalive pings');
  }

  // Active connectivity monitoring - test relay connections periodically
  // This runs every 60 seconds to maintain relay connections
  connectivityCheckInterval = setInterval(async () => {
    // Prevent overlapping checks
    if (connectivityCheckInFlight) {
      return;
    }
    connectivityCheckInFlight = true;
    
    try {
      const isConnected = await checkRelayConnectivity(node, addServerLog);
      
      // Reduced logging for better signal-to-noise ratio
      if (!isConnected && nodeHealth.consecutiveConnectivityFailures === 1) {
        // Only log first failure if it's not just missing ping capability
        if (node) {
          const client = (node as any)._client || (node as any).client;
          if (client) {
            addServerLog('info', 'Connectivity check failed, will retry');
          }
        } else {
          addServerLog('info', 'Connectivity check failed (node is null), will retry');
        }
      } else if (isConnected && nodeHealth.consecutiveConnectivityFailures === 0) {
        // Log every 10 successful checks (10 minutes)
        const timeSinceStart = Date.now() - nodeHealth.lastConnectivityCheck.getTime();
        const checkCount = Math.floor(timeSinceStart / CONNECTIVITY_CHECK_INTERVAL);
        if (checkCount % 10 === 0 && checkCount > 0) {
          addServerLog('debug', `Connectivity maintained for ${Math.round(timeSinceStart / 60000)} minutes`);
        }
      }
    } catch (error) {
      addServerLog('error', 'Connectivity check error', error);
      nodeHealth.consecutiveConnectivityFailures++;
      
      // Simple recreation after 3 failures
      if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
        addServerLog('info', 'Too many connectivity failures, recreating node');
        await nodeRecreateCallback();
      }
    } finally {
      connectivityCheckInFlight = false;
    }
  }, CONNECTIVITY_CHECK_INTERVAL);

  // Reset health state for new node (only if node is valid)
  if (node) {
    nodeHealth = {
      lastActivity: new Date(),
      lastConnectivityCheck: new Date(),
      isConnected: true,
      consecutiveConnectivityFailures: 0
    };
  }
}

// Stop connectivity monitoring
function stopConnectivityMonitoring() {
  if (connectivityCheckInterval) {
    clearInterval(connectivityCheckInterval);
    connectivityCheckInterval = null;
  }
  connectivityCheckInFlight = false;
  nodeRecreateCallback = null;
}

// Enhanced connection monitoring
function setupConnectionMonitoring(
  node: any,
  addServerLog: ReturnType<typeof createAddServerLog>
) {
  // Guard against null node
  if (!node) {
    addServerLog('debug', 'Skipping connection monitoring setup - node is null');
    return;
  }
  
  // Monitor relay connections if available
  if (node.relays && Array.isArray(node.relays)) {
    node.relays.forEach((relay: any, index: number) => {
      if (relay.on) {
        relay.on('connect', () => {
          addServerLog('bifrost', `Relay ${index + 1} connected`);
          updateNodeActivity(addServerLog);
        });
        
        relay.on('disconnect', () => {
          addServerLog('warning', `Relay ${index + 1} disconnected`);
        });
        
        relay.on('error', (error: any) => {
          addServerLog('error', `Relay ${index + 1} error`, error);
        });
      }
    });
  }

  // Monitor WebSocket connections if available
  if (node.connections && Array.isArray(node.connections)) {
    node.connections.forEach((connection: any, index: number) => {
      if (connection.on) {
        connection.on('open', () => {
          addServerLog('bifrost', `WebSocket connection ${index + 1} opened`);
          updateNodeActivity(addServerLog);
        });
        
        connection.on('close', () => {
          addServerLog('warning', `WebSocket connection ${index + 1} closed`);
        });
        
        connection.on('error', (error: any) => {
          addServerLog('error', `WebSocket connection ${index + 1} error`, error);
        });
      }
    });
  }
}

// Create broadcast event function for WebSocket streaming
export function createBroadcastEvent(eventStreams: Set<ServerWebSocket<EventStreamData>>) {
  return function broadcastEvent(event: { type: string; message: string; data?: any; timestamp: string; id: string }) {
    if (eventStreams.size === 0) {
      return; // No connected clients
    }
    
    try {
      // Safely serialize the event data
      const safeEvent = {
        ...event,
        data: event.data ? JSON.parse(safeStringify(event.data)) : undefined
      };
      
      const eventData = JSON.stringify(safeEvent);
      
      // Send to all connected WebSocket clients, removing failed ones
      const failedStreams = new Set<ServerWebSocket<EventStreamData>>();
      
      for (const ws of eventStreams) {
        try {
          // Use named constant instead of magic number
          if (ws.readyState === READY_STATE_OPEN) {
            ws.send(eventData);
          } else {
            // Mark for removal if connection is not open
            failedStreams.add(ws);
          }
        } catch (error) {
          // Mark for removal - don't modify set while iterating
          failedStreams.add(ws);
        }
      }
      
      // Remove failed streams
      for (const failedWs of failedStreams) {
        eventStreams.delete(failedWs);
      }
    } catch (error) {
      console.error('Broadcast event error:', error);
    }
  };
}

// Helper function to create a server log broadcaster
export function createAddServerLog(broadcastEvent: ReturnType<typeof createBroadcastEvent>) {
  return function addServerLog(type: string, message: string, data?: any) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      type,
      message,
      data,
      timestamp,
      id: Math.random().toString(36).substring(2, 11)
    };
    
    // Log to console for server logs
    if (data !== undefined && data !== null && data !== '') {
      console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`, data);
    } else {
      console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`);
    }
    
    // Broadcast to connected clients
    broadcastEvent(logEntry);
  };
}

/**
 * Determine if a ping message is a self-ping based on credentials and message content.
 * Safely extracts our pubkey from credentials, normalizes it, and compares it against
 * the pubkey found in the message data (env.pubkey or data.from). Returns false on any error.
 */
function isSelfPing(messageData: any, groupCred?: string, shareCred?: string): boolean {
  try {
    if (!groupCred || !shareCred) return false;
    const result = extractSelfPubkeyFromCredentials(groupCred, shareCred);
    const selfPubkey = result?.pubkey;
    if (!selfPubkey) return false;
    const normalizedSelf = normalizePubkey(selfPubkey);

    let fromPubkey: string | undefined;

    if (
      messageData &&
      typeof messageData === 'object' &&
      'env' in messageData &&
      messageData.env !== null &&
      typeof (messageData as any).env === 'object'
    ) {
      const env = (messageData as any).env as any;
      if ('pubkey' in env && typeof env.pubkey === 'string') {
        fromPubkey = env.pubkey;
      }
    }

    if (
      !fromPubkey &&
      messageData &&
      typeof messageData === 'object' &&
      'data' in messageData &&
      (messageData as any).data !== null &&
      typeof (messageData as any).data === 'object'
    ) {
      const data = (messageData as any).data as any;
      if ('from' in data && typeof data.from === 'string') {
        fromPubkey = data.from;
      }
    }

    if (!fromPubkey) return false;
    const normalizedFrom = normalizePubkey(fromPubkey);
    return normalizedFrom === normalizedSelf;
  } catch {
    return false;
  }
}

// Setup comprehensive event listeners for the Bifrost node
export function setupNodeEventListeners(
  node: any, 
  addServerLog: ReturnType<typeof createAddServerLog>,
  broadcastEvent: ReturnType<typeof createBroadcastEvent>,
  peerStatuses: Map<string, PeerStatus>,
  onNodeUnhealthy?: () => Promise<void> | void,
  groupCred?: string,
  shareCred?: string
) {
  // Start simplified connectivity monitoring
  const recreateNodeFn = async () => {
    if (onNodeUnhealthy) {
      const result = onNodeUnhealthy();
      if (result instanceof Promise) {
        await result;
      }
    }
  };
  startConnectivityMonitoring(node, addServerLog, recreateNodeFn);

  // Setup connection monitoring
  setupConnectionMonitoring(node, addServerLog);

  // Basic node events - matching Igloo Desktop
  node.on('closed', () => {
    addServerLog('bifrost', 'Bifrost node is closed');
    stopConnectivityMonitoring();
  });

  node.on('error', (error: unknown) => {
    addServerLog('error', 'Node error', error);
    updateNodeActivity(addServerLog);
  });

  node.on('ready', (data: unknown) => {
    // Log basic info about the ready event without the potentially problematic data object
    const logData = data && typeof data === 'object' ?
      { message: 'Node ready event received', hasData: true, dataType: typeof data } :
      data;
    addServerLog('ready', 'Node is ready', logData);
    updateNodeActivity(addServerLog);
  });

  node.on('bounced', (reason: string, msg: unknown) => {
    addServerLog('bifrost', `Message bounced: ${reason}`, msg);
    updateNodeActivity(addServerLog);
  });

  // Enhanced connection events
  node.on('connect', () => {
    addServerLog('bifrost', 'Node connected');
    updateNodeActivity(addServerLog);
  });

  node.on('disconnect', () => {
    addServerLog('warning', 'Node disconnected');
  });

  node.on('reconnect', () => {
    addServerLog('bifrost', 'Node reconnected');
    updateNodeActivity(addServerLog);
  });

  node.on('reconnecting', () => {
    addServerLog('bifrost', 'Node reconnecting...');
  });

  // Message events
  node.on('message', (msg: unknown) => {
    updateNodeActivity(addServerLog); // Update activity on every message
    
    try {
      if (msg && typeof msg === 'object' && 'tag' in msg) {
        const messageData = msg as { tag: unknown; [key: string]: unknown };
        const tag = messageData.tag;

        if (typeof tag === 'string') {
          // Handle peer status updates for ping messages
          if (tag === '/ping/req' || tag === '/ping/res') {
            // Extract pubkey from env.pubkey (Nostr event structure)
            let fromPubkey: string | undefined = undefined;
            
            if ('env' in messageData && typeof messageData.env === 'object' && messageData.env !== null) {
              const env = messageData.env as any;
              if ('pubkey' in env && typeof env.pubkey === 'string') {
                fromPubkey = env.pubkey;
              }
            }
            
            // Fallback: check for direct 'from' field
            if (!fromPubkey && 'from' in messageData && typeof messageData.from === 'string') {
              fromPubkey = messageData.from;
            }
            
            if (fromPubkey) {
              const normalizedPubkey = normalizePubkey(fromPubkey);
              
              // Calculate latency for responses
              let latency: number | undefined = undefined;
              if (tag === '/ping/res') {
                if ('latency' in messageData && typeof messageData.latency === 'number') {
                  latency = messageData.latency;
                } else if ('timestamp' in messageData && typeof messageData.timestamp === 'number') {
                  latency = Date.now() - messageData.timestamp;
                }
              }
              
              // Update peer status - use normalized key but preserve original pubkey format
              const existingStatus = peerStatuses.get(normalizedPubkey);
              const updatedStatus: PeerStatus = {
                pubkey: existingStatus?.pubkey || fromPubkey, // Preserve the original format if we have it
                online: true,
                lastSeen: new Date(),
                latency: latency || existingStatus?.latency,
                lastPingAttempt: existingStatus?.lastPingAttempt
              };
              
              peerStatuses.set(normalizedPubkey, updatedStatus);
              
              // Broadcast peer status update for peer list (not logged to event stream)
              broadcastEvent({
                type: 'peer-status-internal',
                message: '', // Internal use only - not logged
                data: {
                  pubkey: fromPubkey,
                  status: updatedStatus,
                  eventType: tag
                },
                timestamp: new Date().toLocaleTimeString(),
                id: Math.random().toString(36).substring(2, 11)
              });
              
            }
          }

          const eventInfo = EVENT_MAPPINGS[tag as keyof typeof EVENT_MAPPINGS];
          if (eventInfo) {
            addServerLog(eventInfo.type, eventInfo.message, msg);
          } else if (tag.startsWith('/sign/')) {
            addServerLog('sign', `Signature event: ${tag}`, msg);
          } else if (tag.startsWith('/ecdh/')) {
            addServerLog('ecdh', `ECDH event: ${tag}`, msg);
          } else if (tag.startsWith('/ping/')) {
            const selfPing = isSelfPing(messageData, groupCred, shareCred);
            if (!selfPing) {
              addServerLog('bifrost', `Ping event: ${tag}`, msg);
            }
          } else {
            addServerLog('bifrost', `Message received: ${tag}`, msg);
          }
        } else {
          addServerLog('bifrost', 'Message received (invalid tag type)', {
            tagType: typeof tag,
            tag,
            originalMessage: msg
          });
        }
      } else {
        addServerLog('bifrost', 'Message received (no tag)', msg);
      }
    } catch (error) {
      addServerLog('bifrost', 'Error parsing message event', { error, originalMessage: msg });
    }
  });

  // Special handlers for events with different signatures - matching Igloo Desktop
  try {
    const ecdhSenderRejHandler = (reason: string, pkg: any) => {
      updateNodeActivity(addServerLog);
      addServerLog('ecdh', `ECDH request rejected: ${reason}`, pkg);
    };
    const ecdhSenderRetHandler = (reason: string, pkgs: string) => {
      updateNodeActivity(addServerLog);
      addServerLog('ecdh', `ECDH shares aggregated: ${reason}`, pkgs);
    };
    const ecdhSenderErrHandler = (reason: string, msgs: unknown[]) => {
      updateNodeActivity(addServerLog);
      addServerLog('ecdh', `ECDH share aggregation failed: ${reason}`, msgs);
    };
    const ecdhHandlerRejHandler = (reason: string, msg: unknown) => {
      updateNodeActivity(addServerLog);
      addServerLog('ecdh', `ECDH rejection sent: ${reason}`, msg);
    };

    node.on('/ecdh/sender/rej', ecdhSenderRejHandler);
    node.on('/ecdh/sender/ret', ecdhSenderRetHandler);
    node.on('/ecdh/sender/err', ecdhSenderErrHandler);
    node.on('/ecdh/handler/rej', ecdhHandlerRejHandler);

    const signSenderRejHandler = (reason: string, pkg: any) => {
      updateNodeActivity(addServerLog);
      // Filter out common websocket connection errors to reduce noise
      if (reason === 'websocket closed' || reason === 'connection timeout') {
        addServerLog('sign', `Signature request rejected due to network issue: ${reason}`, null);
      } else {
        addServerLog('sign', `Signature request rejected: ${reason}`, pkg);
      }
    };
    const signSenderRetHandler = (reason: string, msgs: any[]) => {
      updateNodeActivity(addServerLog);
      addServerLog('sign', `Signature shares aggregated: ${reason}`, msgs);
    };
    const signSenderErrHandler = (reason: string, msgs: unknown[]) => {
      updateNodeActivity(addServerLog);
      addServerLog('sign', `Signature share aggregation failed: ${reason}`, msgs);
    };
    const signHandlerRejHandler = (reason: string, msg: unknown) => {
      updateNodeActivity(addServerLog);
      // Filter out common websocket connection errors to reduce noise
      if (reason === 'websocket closed' || reason === 'connection timeout') {
        addServerLog('sign', `Signature rejection sent due to network issue: ${reason}`, null);
      } else {
        addServerLog('sign', `Signature rejection sent: ${reason}`, msg);
      }
    };

    node.on('/sign/sender/rej', signSenderRejHandler);
    node.on('/sign/sender/ret', signSenderRetHandler);
    node.on('/sign/sender/err', signSenderErrHandler);
    node.on('/sign/handler/rej', signHandlerRejHandler);

    // Legacy direct event listeners for backward compatibility - only for events NOT handled by message handler
    const legacyEvents = [
      // Only include events that aren't already handled by EVENT_MAPPINGS via message handler
      { event: '/ecdh/sender/req', type: 'ecdh', message: 'ECDH request sent' },
      { event: '/ecdh/sender/res', type: 'ecdh', message: 'ECDH responses received' },
      { event: '/sign/sender/req', type: 'sign', message: 'Signature request sent' },
      { event: '/sign/sender/res', type: 'sign', message: 'Signature responses received' },
      // Note: Removed /ecdh/handler/req, /ecdh/handler/res, /sign/handler/req, /sign/handler/res 
      // because they're already handled by the message handler via EVENT_MAPPINGS
    ];

    legacyEvents.forEach(({ event, type, message }) => {
      try {
        const handler = (msg: unknown) => {
          updateNodeActivity(addServerLog);
          addServerLog(type, message, msg);
        };
        (node as any).on(event, handler);
      } catch (e) {
        // Silently ignore if event doesn't exist
      }
    });
  } catch (e) {
    addServerLog('bifrost', 'Error setting up some legacy event listeners', e);
  }

  // Catch-all for any other events - but exclude ping events since they're handled by message handler
  node.on('*', (event: any) => {
    // Only log events that aren't already handled above, and exclude ping events to avoid duplicates
    if (event !== 'message' && 
        event !== 'closed' && 
        event !== 'error' && 
        event !== 'ready' && 
        event !== 'bounced' &&
        event !== 'connect' &&
        event !== 'disconnect' &&
        event !== 'reconnect' &&
        event !== 'reconnecting' &&
        !event.startsWith('/ping/') &&
        !event.startsWith('/sign/') &&
        !event.startsWith('/ecdh/')) {
      updateNodeActivity(addServerLog);
      addServerLog('bifrost', `Bifrost event: ${event}`);
    }
  });

  // Log health monitoring status
  addServerLog('system', 'Health monitoring and enhanced event listeners configured');
}

// Enhanced node creation with better error handling and retry logic
export async function createNodeWithCredentials(
  groupCred: string,
  shareCred: string,
  relaysEnv?: string,
  addServerLog?: ReturnType<typeof createAddServerLog>
): Promise<ServerBifrostNode | null> {
  const relays = getValidRelays(relaysEnv);
  
  if (addServerLog) {
    addServerLog('info', 'Creating and connecting node...');
  }
  
  try {
    // Use enhanced node creation with better connection management
    let connectionAttempts = 0;
    const maxAttempts = 5; // Increased from 3
    
    while (connectionAttempts < maxAttempts) {
      connectionAttempts++;
      
      try {
        if (addServerLog) {
          addServerLog('info', `Connection attempt ${connectionAttempts}/${maxAttempts} using ${relays.length} relays`);
        }
        
        const result = await createConnectedNode({
          group: groupCred,
          share: shareCred,
          relays,
          connectionTimeout: 30000,  // Increased to 30 seconds
          autoReconnect: true        // Enable auto-reconnection
        }, {
          enableLogging: false,      // Disable internal logging to avoid duplication
          logLevel: 'error'          // Only log errors from igloo-core
        });
        
        if (result.node) {
          const node = result.node as unknown as ServerBifrostNode;
          
          if (addServerLog) {
            addServerLog('info', 'Node connected and ready');
            
            // Log connection state info
            if (result.state) {
              addServerLog('info', `Connected to ${result.state.connectedRelays.length}/${relays.length} relays`);
              
              // Log which relays are connected
              if (result.state.connectedRelays.length > 0) {
                addServerLog('info', `Active relays: ${result.state.connectedRelays.join(', ')}`);
              }
              
              // Log detailed node state for diagnostics
              addServerLog('debug', 'Node state details', {
                isReady: result.state.isReady,
                isConnected: result.state.isConnected,
                isConnecting: result.state.isConnecting,
                relayCount: result.state.connectedRelays.length
              });
            }
            
            // Log internal client details for debugging keepalive
            const client = (node as any)._client || (node as any).client;
            if (client) {
              addServerLog('debug', 'Node client capabilities', {
                hasConnect: typeof client.connect === 'function',
                hasPing: typeof client.ping === 'function',
                hasClose: typeof client.close === 'function',
                hasUpdate: typeof client.update === 'function',
                isReady: client._is_ready || client.is_ready || false
              });
            }
            
            // Check if node has ping capability
            if (typeof (node as any).ping === 'function') {
              addServerLog('debug', 'Node has ping capability for keepalive');
            } else {
              addServerLog('debug', 'Node lacks ping capability - will rely on relay reconnection for connectivity');
            }
          }
          
          // Perform initial connectivity check and await completion to avoid startup races
          if (addServerLog) {
            try {
              const initialDelay = parseInt(process.env.INITIAL_CONNECTIVITY_DELAY || '5000', 10);
              await new Promise(resolve => setTimeout(resolve, initialDelay));
              const isConnected = await checkRelayConnectivity(node, addServerLog);
              addServerLog('info', `Initial connectivity check: ${isConnected ? 'PASSED' : 'FAILED'}`);
    
              // If initial check fails, log a warning but don't fail node creation
              // The monitoring loop will handle recovery
              if (!isConnected) {
                addServerLog('warning', 'Initial connectivity check failed - monitoring will attempt recovery');
              }
            } catch (e) {
              addServerLog('error', 'Initial connectivity check threw an error', e);
              // Don't fail node creation - let monitoring handle it
            }
          }
          
          return node;
        } else {
          throw new Error('Enhanced node creation returned no node');
        }
      } catch (enhancedError) {
        if (addServerLog) {
          addServerLog('warn', `Enhanced connection attempt ${connectionAttempts} failed: ${enhancedError instanceof Error ? enhancedError.message : 'Unknown error'}`);
        }
        
        // If this was the last attempt, try basic connection
        if (connectionAttempts === maxAttempts) {
          if (addServerLog) {
            addServerLog('info', 'All enhanced attempts failed, trying basic connection...');
          }
          
          try {
            const basicNode = await createAndConnectNode({
              group: groupCred,
              share: shareCred,
              relays
            });
            if (basicNode) {
              const node = basicNode as unknown as ServerBifrostNode;
              if (addServerLog) {
                addServerLog('info', 'Node connected and ready (basic mode)');
              }
              return node;
            }
          } catch (basicError) {
            if (addServerLog) {
              addServerLog('error', `Basic connection also failed: ${basicError instanceof Error ? basicError.message : 'Unknown error'}`);
            }
          }
        } else {
          // Progressive backoff - wait longer between retries
          const waitTime = Math.min(2000 * connectionAttempts, 10000);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
  } catch (error) {
    if (addServerLog) {
      addServerLog('error', 'Failed to create initial Bifrost node', error);
    }
  }
  
  return null;
}

// Export health information
export function getNodeHealth() {
  return { 
    ...nodeHealth,
    timeSinceLastActivity: Date.now() - nodeHealth.lastActivity.getTime(),
    timeSinceLastConnectivityCheck: Date.now() - nodeHealth.lastConnectivityCheck.getTime()
  };
}

// Export cleanup function
export function cleanupMonitoring() {
  stopConnectivityMonitoring();
}

// Reset monitoring state completely (for manual restarts)
export function resetHealthMonitoring() {
  nodeHealth = {
    lastActivity: new Date(),
    lastConnectivityCheck: new Date(),
    isConnected: true,
    consecutiveConnectivityFailures: 0
  };
} 