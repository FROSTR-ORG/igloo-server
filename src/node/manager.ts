import { 
  createAndConnectNode, 
  createConnectedNode,
  normalizePubkey
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

// Health monitoring constants with validation
const parseHealthConstants = () => {
  const maxHealthRestarts = parseInt(process.env.NODE_HEALTH_MAX_RESTARTS || '3');
  const restartBackoffBase = parseInt(process.env.NODE_HEALTH_RESTART_DELAY || '60000');
  const restartBackoffMultiplier = parseFloat(process.env.NODE_HEALTH_BACKOFF_MULTIPLIER || '2');

  // Validation with safe defaults
  const validatedConstants = {
    HEALTH_CHECK_INTERVAL: 30000, // Fixed at 30 seconds
    NODE_ACTIVITY_TIMEOUT: 120000, // Fixed at 2 minutes
    WATCHDOG_TIMEOUT: 300000, // Fixed at 5 minutes
    MAX_HEALTH_RESTARTS: (maxHealthRestarts > 0 && maxHealthRestarts <= 50) ? maxHealthRestarts : 3, // 1 to 50 restarts max
    RESTART_BACKOFF_BASE: (restartBackoffBase > 0 && restartBackoffBase <= 3600000) ? restartBackoffBase : 60000, // 1ms to 1 hour max
    RESTART_BACKOFF_MULTIPLIER: (restartBackoffMultiplier >= 1.0 && restartBackoffMultiplier <= 10) ? restartBackoffMultiplier : 2, // 1.0 to 10x multiplier
    RESTART_COUNT_RESET_TIMEOUT: 600000, // Fixed at 10 minutes
  };

  // Log validation warnings if defaults were used
  if (maxHealthRestarts !== validatedConstants.MAX_HEALTH_RESTARTS) {
    console.warn(`Invalid NODE_HEALTH_MAX_RESTARTS: ${maxHealthRestarts}. Using default: ${validatedConstants.MAX_HEALTH_RESTARTS}`);
  }
  if (restartBackoffBase !== validatedConstants.RESTART_BACKOFF_BASE) {
    console.warn(`Invalid NODE_HEALTH_RESTART_DELAY: ${restartBackoffBase}. Using default: ${validatedConstants.RESTART_BACKOFF_BASE}ms`);
  }
  if (restartBackoffMultiplier !== validatedConstants.RESTART_BACKOFF_MULTIPLIER) {
    console.warn(`Invalid NODE_HEALTH_BACKOFF_MULTIPLIER: ${restartBackoffMultiplier}. Using default: ${validatedConstants.RESTART_BACKOFF_MULTIPLIER}`);
  }

  return validatedConstants;
};

const {
  HEALTH_CHECK_INTERVAL,
  NODE_ACTIVITY_TIMEOUT,
  WATCHDOG_TIMEOUT,
  MAX_HEALTH_RESTARTS,
  RESTART_BACKOFF_BASE,
  RESTART_BACKOFF_MULTIPLIER,
  RESTART_COUNT_RESET_TIMEOUT
} = parseHealthConstants();

// Health monitoring state
interface NodeHealth {
  lastActivity: Date;
  lastHealthCheck: Date;
  isHealthy: boolean;
  consecutiveFailures: number;
  restartCount: number;
  lastHealthyPeriodStart: Date | null;
}

let nodeHealth: NodeHealth = {
  lastActivity: new Date(),
  lastHealthCheck: new Date(),
  isHealthy: true,
  consecutiveFailures: 0,
  restartCount: 0,
  lastHealthyPeriodStart: new Date()
};

let healthCheckInterval: NodeJS.Timeout | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;

// Helper function to update node activity
function updateNodeActivity(addServerLog: ReturnType<typeof createAddServerLog>) {
  const now = new Date();
  nodeHealth.lastActivity = now;
  if (!nodeHealth.isHealthy) {
    nodeHealth.isHealthy = true;
    nodeHealth.consecutiveFailures = 0;
    nodeHealth.lastHealthyPeriodStart = now;
    addServerLog('system', 'Node health restored - activity detected');
  }
}

// Helper function to check node health
function checkNodeHealth(
  node: ServerBifrostNode | null,
  addServerLog: ReturnType<typeof createAddServerLog>,
  onNodeUnhealthy: () => void
) {
  if (!node) return;

  const now = new Date();
  const timeSinceLastActivity = now.getTime() - nodeHealth.lastActivity.getTime();
  
  nodeHealth.lastHealthCheck = now;

  // Check if we should reset restart count after sustained healthy period
  if (nodeHealth.isHealthy && nodeHealth.lastHealthyPeriodStart && nodeHealth.restartCount > 0) {
    const healthyPeriod = now.getTime() - nodeHealth.lastHealthyPeriodStart.getTime();
    if (healthyPeriod > RESTART_COUNT_RESET_TIMEOUT) {
      const previousRestartCount = nodeHealth.restartCount;
      nodeHealth.restartCount = 0;
      addServerLog('system', `Restart count reset from ${previousRestartCount} to 0 after ${Math.round(healthyPeriod / 60000)} minutes of healthy operation`);
    }
  }

  if (timeSinceLastActivity > NODE_ACTIVITY_TIMEOUT) {
    nodeHealth.consecutiveFailures++;
    
    if (nodeHealth.isHealthy) {
      nodeHealth.isHealthy = false;
      addServerLog('warning', `Node appears unhealthy - no activity for ${timeSinceLastActivity}ms`);
    }

    // If node has been unhealthy for too long, trigger restart
    if (timeSinceLastActivity > WATCHDOG_TIMEOUT) {
      // Check if we've exceeded the maximum number of health-based restarts
      if (nodeHealth.restartCount >= MAX_HEALTH_RESTARTS) {
        addServerLog('error', `Maximum health-based restarts (${MAX_HEALTH_RESTARTS}) exceeded. Stopping health monitoring to prevent infinite loops.`);
        stopHealthMonitoring();
        return;
      }
      
      // Calculate exponential backoff delay
      const backoffDelay = RESTART_BACKOFF_BASE * Math.pow(RESTART_BACKOFF_MULTIPLIER, nodeHealth.restartCount);
      
      addServerLog('error', `Node watchdog timeout - scheduling restart ${nodeHealth.restartCount + 1}/${MAX_HEALTH_RESTARTS} with ${Math.round(backoffDelay / 1000)}s delay`);
      
      // Increment restart count
      nodeHealth.restartCount++;
      
      // Schedule restart with exponential backoff
      setTimeout(() => {
        addServerLog('system', `Executing delayed restart (attempt ${nodeHealth.restartCount})`);
        onNodeUnhealthy();
      }, backoffDelay);
    }
  }
}

// Start health monitoring
function startHealthMonitoring(
  node: ServerBifrostNode | null,
  addServerLog: ReturnType<typeof createAddServerLog>,
  onNodeUnhealthy: () => void
) {
  stopHealthMonitoring();
  
  if (!node) return;

  addServerLog('system', 'Starting node health monitoring');
  
  healthCheckInterval = setInterval(() => {
    checkNodeHealth(node, addServerLog, onNodeUnhealthy);
  }, HEALTH_CHECK_INTERVAL);

  // Reset health state for new node
  nodeHealth = {
    lastActivity: new Date(),
    lastHealthCheck: new Date(),
    isHealthy: true,
    consecutiveFailures: 0,
    restartCount: nodeHealth.restartCount, // Preserve restart count
    lastHealthyPeriodStart: new Date()
  };
}

// Stop health monitoring
function stopHealthMonitoring() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
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
  onNodeUnhealthy?: () => void
) {
  // Start health monitoring
  startHealthMonitoring(node, addServerLog, onNodeUnhealthy || (() => {}));

  // Setup connection monitoring
  setupConnectionMonitoring(node, addServerLog);

  // Basic node events - matching Igloo Desktop
  node.on('closed', () => {
    addServerLog('bifrost', 'Bifrost node is closed');
    stopHealthMonitoring();
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
                id: Math.random().toString(36).substr(2, 9)
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
            addServerLog('bifrost', `Ping event: ${tag}`, msg);
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
  return { ...nodeHealth };
}

// Export cleanup function
export function cleanupHealthMonitoring() {
  stopHealthMonitoring();
}

// Reset health monitoring state completely (for manual restarts)
export function resetHealthMonitoring() {
  nodeHealth = {
    lastActivity: new Date(),
    lastHealthCheck: new Date(),
    isHealthy: true,
    consecutiveFailures: 0,
    restartCount: 0,
    lastHealthyPeriodStart: new Date()
  };
} 