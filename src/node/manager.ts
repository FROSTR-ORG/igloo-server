import { 
  createAndConnectNode, 
  createConnectedNode,
  normalizePubkey
} from '@frostr/igloo-core';
import { ServerBifrostNode, PeerStatus } from '../routes/types.js';
import { getValidRelays, safeStringify } from '../routes/utils.js';

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

import type { ServerWebSocket } from 'bun';

// Helper function to broadcast events to all connected WebSocket clients
export function createBroadcastEvent(eventStreams: Set<ServerWebSocket<any>>) {
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
      const failedStreams = new Set<ServerWebSocket<any>>();
      
      for (const ws of eventStreams) {
        try {
          // Use Bun's WebSocket readyState constants
          if (ws.readyState === 1) { // OPEN state
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

// Helper function to add log entries
export function createAddServerLog(broadcastEvent: ReturnType<typeof createBroadcastEvent>) {
  return function addServerLog(type: string, message: string, data?: any) {
    const event = {
      type,
      message,
      data,
      timestamp: new Date().toLocaleTimeString(),
      id: Math.random().toString(36).substr(2, 9)
    };
    
    console.log(`[${type.toUpperCase()}] ${message}`);
    broadcastEvent(event);
  };
}

// Setup comprehensive event listeners for the Bifrost node
export function setupNodeEventListeners(
  node: any, 
  addServerLog: ReturnType<typeof createAddServerLog>,
  broadcastEvent: ReturnType<typeof createBroadcastEvent>,
  peerStatuses: Map<string, PeerStatus>
) {
  // Basic node events - matching Igloo Desktop
  node.on('closed', () => {
    addServerLog('bifrost', 'Bifrost node is closed');
  });

  node.on('error', (error: unknown) => {
    addServerLog('error', 'Node error', error);
  });

  node.on('ready', (data: unknown) => {
    // Log basic info about the ready event without the potentially problematic data object
    const logData = data && typeof data === 'object' ?
      { message: 'Node ready event received', hasData: true, dataType: typeof data } :
      data;
    addServerLog('ready', 'Node is ready', logData);
  });

  node.on('bounced', (reason: string, msg: unknown) => {
    addServerLog('bifrost', `Message bounced: ${reason}`, msg);
  });

  // Message events
  node.on('message', (msg: unknown) => {
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
    const ecdhSenderRejHandler = (reason: string, pkg: any) =>
      addServerLog('ecdh', `ECDH request rejected: ${reason}`, pkg);
    const ecdhSenderRetHandler = (reason: string, pkgs: string) =>
      addServerLog('ecdh', `ECDH shares aggregated: ${reason}`, pkgs);
    const ecdhSenderErrHandler = (reason: string, msgs: unknown[]) =>
      addServerLog('ecdh', `ECDH share aggregation failed: ${reason}`, msgs);
    const ecdhHandlerRejHandler = (reason: string, msg: unknown) =>
      addServerLog('ecdh', `ECDH rejection sent: ${reason}`, msg);

    node.on('/ecdh/sender/rej', ecdhSenderRejHandler);
    node.on('/ecdh/sender/ret', ecdhSenderRetHandler);
    node.on('/ecdh/sender/err', ecdhSenderErrHandler);
    node.on('/ecdh/handler/rej', ecdhHandlerRejHandler);

    const signSenderRejHandler = (reason: string, pkg: any) => {
      // Filter out common websocket connection errors to reduce noise
      if (reason === 'websocket closed' || reason === 'connection timeout') {
        addServerLog('sign', `Signature request rejected due to network issue: ${reason}`, null);
      } else {
        addServerLog('sign', `Signature request rejected: ${reason}`, pkg);
      }
    };
    const signSenderRetHandler = (reason: string, msgs: any[]) =>
      addServerLog('sign', `Signature shares aggregated: ${reason}`, msgs);
    const signSenderErrHandler = (reason: string, msgs: unknown[]) =>
      addServerLog('sign', `Signature share aggregation failed: ${reason}`, msgs);
    const signHandlerRejHandler = (reason: string, msg: unknown) => {
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
        const handler = (msg: unknown) => addServerLog(type, message, msg);
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
        !event.startsWith('/ping/') &&
        !event.startsWith('/sign/') &&
        !event.startsWith('/ecdh/')) {
      addServerLog('bifrost', `Bifrost event: ${event}`);
    }
  });
}

// Create and connect the Bifrost node using igloo-core
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
    const maxAttempts = 3;
    
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
          connectionTimeout: 20000,  // 20 second timeout (increased)
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
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 2000));
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