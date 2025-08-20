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

let connectivityCheckInterval: NodeJS.Timeout | null = null;
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
  if (!node) return false;
  
  const now = new Date();
  nodeHealth.lastConnectivityCheck = now;
  
  try {
    // First check if the node client itself exists
    const client = (node as any)._client || (node as any).client;
    if (!client) {
      addServerLog('warning', 'Node client not available, will recreate on next check');
      nodeHealth.consecutiveConnectivityFailures++;
      
      // Trigger node recreation if client is missing for too long
      if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
        addServerLog('info', 'Recreating node after 3 failed checks');
        await nodeRecreateCallback();
      }
      return false;
    }
    
    // Check if we've been idle too long
    const timeSinceLastActivity = now.getTime() - nodeHealth.lastActivity.getTime();
    const isIdle = timeSinceLastActivity > IDLE_THRESHOLD;
    
    // If we're idle, send a keepalive ping to maintain relay connections
    if (isIdle) {
      try {
        // Get list of peer pubkeys from the node
        const peers = (node as any)._peers || (node as any).peers || [];
        
        if (peers.length > 0) {
          // Send a ping to the first available peer
          const targetPeer = peers[0];
          const peerPubkey = targetPeer.pubkey || targetPeer;
          
          // The Bifrost node exposes ping via node.ping (from API.ping_request_api)
          if (typeof (node as any).ping === 'function') {
            const pingResult = await (node as any).ping(peerPubkey);
            
            if (pingResult && pingResult.ok) {
              // Ping succeeded - connection is good!
              updateNodeActivity(addServerLog, true);
              nodeHealth.isConnected = true;
              nodeHealth.consecutiveConnectivityFailures = 0;
              // Don't log success every time to reduce noise
              return true;
            } else {
              // Ping failed - this is a real connectivity issue
              const error = pingResult?.err || 'unknown';
              
              // Only log and increment failures for real network errors
              if (error.includes('timeout') || error.includes('closed') || error.includes('disconnect')) {
                addServerLog('warning', `Connectivity lost: ${error}`);
                nodeHealth.consecutiveConnectivityFailures++;
                
                // If we've had too many failures, trigger recreation
                if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
                  addServerLog('info', 'Connection lost, recreating node');
                  await nodeRecreateCallback();
                }
                return false;
              }
              // For other errors (like peer offline), connection is still OK
              return true;
            }
          }
        }
      } catch (pingError: any) {
        // Only treat network errors as connectivity failures
        if (pingError?.message?.includes('timeout') || pingError?.message?.includes('closed')) {
          addServerLog('warning', 'Network error during ping', pingError);
          nodeHealth.consecutiveConnectivityFailures++;
          
          if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
            addServerLog('info', 'Network errors exceeded threshold, recreating node');
            await nodeRecreateCallback();
          }
          return false;
        }
        // For other errors, assume connection is OK
        return true;
      }
    }
    
    // Not idle, assume everything is fine
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
  
  if (!node) return;

  // Store recreation callback
  nodeRecreateCallback = recreateNodeFn;

  addServerLog('system', 'Starting simplified connectivity monitoring with keepalive pings');

  // Active connectivity monitoring - test relay connections periodically
  // This runs every 60 seconds to maintain relay connections
  connectivityCheckInterval = setInterval(async () => {
    try {
      const isConnected = await checkRelayConnectivity(node, addServerLog);
      
      // Simple logging without complex tracking
      if (!isConnected && nodeHealth.consecutiveConnectivityFailures === 1) {
        addServerLog('info', 'Connectivity check failed, will retry');
      } else if (isConnected && nodeHealth.consecutiveConnectivityFailures === 0) {
        // Log every 10 successful checks (10 minutes)
        const timeSinceStart = Date.now() - nodeHealth.lastConnectivityCheck.getTime();
        const checkCount = Math.floor(timeSinceStart / CONNECTIVITY_CHECK_INTERVAL);
        if (checkCount % 10 === 0 && checkCount > 0) {
          addServerLog('info', `Connectivity maintained for ${Math.round(timeSinceStart / 60000)} minutes`);
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
    }
  }, CONNECTIVITY_CHECK_INTERVAL);

  // Reset health state for new node
  nodeHealth = {
    lastActivity: new Date(),
    lastConnectivityCheck: new Date(),
    isConnected: true,
    consecutiveConnectivityFailures: 0
  };
}

// Stop connectivity monitoring
function stopConnectivityMonitoring() {
  if (connectivityCheckInterval) {
    clearInterval(connectivityCheckInterval);
    connectivityCheckInterval = null;
  }
  nodeRecreateCallback = null;
}

// Enhanced connection monitoring
function setupConnectionMonitoring(
  node: any,
  addServerLog: ReturnType<typeof createAddServerLog>
) {
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
    console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`, data ? data : '');
    
    // Broadcast to connected clients
    broadcastEvent(logEntry);
  };
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
            // Check if this is a self-ping (keepalive) by comparing pubkeys
            let isSelfPing = false;
            try {
              // Extract self pubkey if we have credentials
              let selfPubkey: string | undefined;
              if (groupCred && shareCred) {
                const selfPubkeyResult = extractSelfPubkeyFromCredentials(groupCred, shareCred);
                selfPubkey = selfPubkeyResult.pubkey || undefined;
              }
              
              // If we have self pubkey, check if this ping involves ourself
              if (selfPubkey) {
                const normalizedSelf = normalizePubkey(selfPubkey);
                
                // Check various message structures for the from/to pubkey
                let fromPubkey: string | undefined;
                
                // Try to extract from env.pubkey (standard Nostr event structure)
                if ('env' in messageData && typeof messageData.env === 'object' && messageData.env !== null) {
                  const env = messageData.env as any;
                  if ('pubkey' in env && typeof env.pubkey === 'string') {
                    fromPubkey = env.pubkey;
                  }
                }
                
                // Fallback to data.from if available
                if (!fromPubkey && 'data' in messageData && typeof messageData.data === 'object' && messageData.data !== null) {
                  const data = messageData.data as any;
                  if ('from' in data && typeof data.from === 'string') {
                    fromPubkey = data.from;
                  }
                }
                
                // Check if this is a self-ping
                if (fromPubkey) {
                  const normalizedFrom = normalizePubkey(fromPubkey);
                  isSelfPing = normalizedFrom === normalizedSelf;
                }
              }
            } catch (error) {
              // If we can't determine, log it anyway (safer to log than miss real pings)
            }
            
            // Only log non-keepalive pings
            if (!isSelfPing) {
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
              addServerLog('debug', 'Node has ping capability');
            }
          }
          
          // Perform initial connectivity check
          if (addServerLog) {
            setTimeout(async () => {
              const isConnected = await checkRelayConnectivity(node, addServerLog);
              addServerLog('info', `Initial connectivity check: ${isConnected ? 'PASSED' : 'FAILED'}`);
            }, 5000);
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