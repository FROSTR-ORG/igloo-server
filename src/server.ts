import { serve }                from 'bun'
import { createAndConnectNode, createConnectedNode, decodeGroup, decodeShare } from '@frostr/igloo-core'
import { NostrRelay }           from './class/relay.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

import * as CONST   from './const.js'

// Constants
const PING_TIMEOUT_MS = 5000;

// Load static files into memory
const index_page  = Bun.file('static/index.html')
const style_file  = Bun.file('static/styles.css')
const script_file = Bun.file('static/app.js')

// Utility functions for peer management
const normalizePubkey = (pubkey: string): string => {
  const trimmed = pubkey.trim().toLowerCase();
  // Remove 02/03 prefix for igloo-core compatibility
  if (trimmed.startsWith('02') || trimmed.startsWith('03')) {
    return trimmed.slice(2);
  }
  return trimmed;
};

const comparePubkeys = (pubkey1: string, pubkey2: string): boolean => {
  // Normalize both pubkeys by removing prefixes for comparison
  const normalized1 = normalizePubkey(pubkey1);
  const normalized2 = normalizePubkey(pubkey2);
  return normalized1 === normalized2;
};

const extractSelfPubkeyFromCredentials = (
  groupCredential: string,
  shareCredential: string
) => {
  try {
    const decodedGroup = decodeGroup(groupCredential);
    const decodedShare = decodeShare(shareCredential);
    
    // Find the corresponding commit in the group
    const commit = decodedGroup.commits.find(c => c.idx === decodedShare.idx);
    
    if (commit) {
      return {
        pubkey: commit.pubkey,
        warnings: [] as string[]
      };
    }
    
    return {
      pubkey: null,
      warnings: ['Could not find matching commit for share index']
    };
  } catch (error) {
    return {
      pubkey: null,
      warnings: [error instanceof Error ? error.message : 'Unknown error extracting pubkey']
    };
  }
};

// Helper function to get valid relay URLs
function getValidRelays(envRelays?: string): string[] {
  // Use single default relay as requested
  const defaultRelays = ['wss://relay.primal.net'];
  
  if (!envRelays) {
    return defaultRelays;
  }
  
  try {
    let relayList: string[] = [];
    
    // Try to parse as JSON first
    if (envRelays.startsWith('[')) {
      relayList = JSON.parse(envRelays);
    } else {
      // Handle comma-separated or space-separated strings
      relayList = envRelays
        .split(/[,\s]+/)
        .map(relay => relay.trim())
        .filter(relay => relay.length > 0);
    }
    
    // Validate each relay URL and exclude localhost to avoid conflicts
    const validRelays = relayList.filter(relay => {
      try {
        const url = new URL(relay);
        // Exclude localhost relays to avoid conflicts with our server
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          console.warn(`Excluding localhost relay to avoid conflicts: ${relay}`);
          return false;
        }
        return url.protocol === 'ws:' || url.protocol === 'wss:';
      } catch {
        return false;
      }
    });
    
    // If no valid relays, use default
    if (validRelays.length === 0) {
      console.warn('No valid relays found, using default relay');
      return defaultRelays;
    }
    
    // Respect user's relay configuration exactly as they set it
    return validRelays;
  } catch (error) {
    console.warn('Error parsing relay URLs, using default:', error);
    return defaultRelays;
  }
}

const relays = getValidRelays(process.env.RELAYS);
const relay  = new NostrRelay()

// Event streaming for frontend
const eventStreams = new Set<ReadableStreamDefaultController>();

// Peer status tracking
interface PeerStatus {
  pubkey: string;
  online: boolean;
  lastSeen?: Date;
  latency?: number;
  lastPingAttempt?: Date;
}

let peerStatuses = new Map<string, PeerStatus>();

// Helper function to safely serialize data with circular reference handling
function safeStringify(obj: any, maxDepth = 3): string {
  const seen = new WeakSet();
  
  const replacer = (key: string, value: any, depth = 0): any => {
    if (depth > maxDepth) {
      return '[Max Depth Reached]';
    }
    
    if (value === null || typeof value !== 'object') {
      return value;
    }
    
    if (seen.has(value)) {
      return '[Circular Reference]';
    }
    
    seen.add(value);
    
    if (Array.isArray(value)) {
      return value.map((item, index) => replacer(String(index), item, depth + 1));
    }
    
    const result: any = {};
    for (const [k, v] of Object.entries(value)) {
      // Skip functions and undefined values
      if (typeof v === 'function' || v === undefined) {
        continue;
      }
      result[k] = replacer(k, v, depth + 1);
    }
    
    return result;
  };
  
  try {
    return JSON.stringify(replacer('', obj));
  } catch (error) {
    return JSON.stringify({
      error: 'Failed to serialize object',
      type: typeof obj,
      constructor: obj?.constructor?.name || 'Unknown'
    });
  }
}

// Helper function to broadcast events to all connected clients
function broadcastEvent(event: { type: string; message: string; data?: any; timestamp: string; id: string }) {
  if (eventStreams.size === 0) {
    return; // No connected clients
  }
  
  try {
    // Safely serialize the event data
    const safeEvent = {
      ...event,
      data: event.data ? JSON.parse(safeStringify(event.data)) : undefined
    };
    
    const eventData = `data: ${JSON.stringify(safeEvent)}\n\n`;
    const encodedData = new TextEncoder().encode(eventData);
    
    // Send to all connected streams, removing failed ones
    const failedStreams = new Set<ReadableStreamDefaultController>();
    
    for (const controller of eventStreams) {
      try {
        controller.enqueue(encodedData);
      } catch (error) {
        // Mark for removal - don't modify set while iterating
        failedStreams.add(controller);
      }
    }
    
    // Remove failed streams
    for (const failedController of failedStreams) {
      eventStreams.delete(failedController);
    }
  } catch (error) {
    console.error('Broadcast event error:', error);
  }
}

// Helper function to add log entries
function addServerLog(type: string, message: string, data?: any) {
  const event = {
    type,
    message,
    data,
    timestamp: new Date().toLocaleTimeString(),
    id: Math.random().toString(36).substr(2, 9)
  };
  
  console.log(`[${type.toUpperCase()}] ${message}`);
  broadcastEvent(event);
}

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

// Setup comprehensive event listeners for the Bifrost node
function setupNodeEventListeners(node: any) {
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

// Create and connect the Bifrost node using igloo-core only if credentials are available
let node: any = null
if (CONST.hasCredentials()) {
  addServerLog('info', 'Creating and connecting node...');
  try {
    // Use enhanced node creation with better connection management
    let connectionAttempts = 0;
    const maxAttempts = 3;
    
    while (connectionAttempts < maxAttempts && !node) {
      connectionAttempts++;
      
      try {
        addServerLog('info', `Connection attempt ${connectionAttempts}/${maxAttempts} using ${relays.length} relays`);
        
        const result = await createConnectedNode({
          group: CONST.GROUP_CRED!,
          share: CONST.SHARE_CRED!,
          relays,
          connectionTimeout: 20000,  // 20 second timeout (increased)
          autoReconnect: true        // Enable auto-reconnection
        }, {
          enableLogging: false,      // Disable internal logging to avoid duplication
          logLevel: 'error'          // Only log errors from igloo-core
        });
        
        if (result.node) {
          node = result.node;
          setupNodeEventListeners(node);
          addServerLog('info', 'Node connected and ready');
          
          // Log connection state info
          if (result.state) {
            addServerLog('info', `Connected to ${result.state.connectedRelays.length}/${relays.length} relays`);
            
            // Log which relays are connected
            if (result.state.connectedRelays.length > 0) {
              addServerLog('info', `Active relays: ${result.state.connectedRelays.join(', ')}`);
            }
          }
          break; // Success, exit retry loop
        } else {
          throw new Error('Enhanced node creation returned no node');
        }
      } catch (enhancedError) {
        addServerLog('warn', `Enhanced connection attempt ${connectionAttempts} failed: ${enhancedError instanceof Error ? enhancedError.message : 'Unknown error'}`);
        
        // If this was the last attempt, try basic connection
        if (connectionAttempts === maxAttempts) {
          addServerLog('info', 'All enhanced attempts failed, trying basic connection...');
          
          try {
            node = await createAndConnectNode({
              group: CONST.GROUP_CRED!,
              share: CONST.SHARE_CRED!,
              relays
            });
            
            if (node) {
              setupNodeEventListeners(node);
              addServerLog('info', 'Node connected and ready (basic mode)');
            }
          } catch (basicError) {
            addServerLog('error', `Basic connection also failed: ${basicError instanceof Error ? basicError.message : 'Unknown error'}`);
          }
        } else {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  } catch (error) {
    addServerLog('error', 'Failed to create initial Bifrost node', error);
  }
} else {
  addServerLog('info', 'No credentials found, starting server without Bifrost node. Use the Configure page to set up credentials.');
}

// Helper functions for .env file management
const ENV_FILE_PATH = '.env'

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  const lines = content.split('\n')
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const equalIndex = trimmed.indexOf('=')
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim()
        const value = trimmed.substring(equalIndex + 1).trim()
        env[key] = value
      }
    }
  }
  
  return env
}

function stringifyEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n'
}

function readEnvFile(): Record<string, string> {
  try {
    if (existsSync(ENV_FILE_PATH)) {
      const content = readFileSync(ENV_FILE_PATH, 'utf-8')
      return parseEnvFile(content)
    }
    return {}
  } catch (error) {
    console.error('Error reading .env file:', error)
    return {}
  }
}

function writeEnvFile(env: Record<string, string>): boolean {
  try {
    const content = stringifyEnvFile(env)
    writeFileSync(ENV_FILE_PATH, content, 'utf-8')
    return true
  } catch (error) {
    console.error('Error writing .env file:', error)
    return false
  }
}

function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'svg': return 'image/svg+xml'
    case 'webp': return 'image/webp'
    case 'ico': return 'image/x-icon'
    case 'css': return 'text/css'
    case 'js': return 'text/javascript'
    case 'html': return 'text/html'
    case 'json': return 'application/json'
    default: return 'application/octet-stream'
  }
}

// HTTP Server
serve({
  port      : 8002,
  websocket : relay.handler(),
  fetch     : async (req, server) => {
    if (server.upgrade(req)) return
    const url = new URL(req.url)

    // Set CORS headers for all API endpoints
      const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }

    // Handle preflight OPTIONS request for all API endpoints
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
        return new Response(null, { status: 200, headers })
      }

    // API endpoints for server status
    if (url.pathname === '/api/status') {
      if (req.method === 'GET') {
        try {
          // Get current relay count from environment or use default
          const env = readEnvFile();
          const currentRelays = getValidRelays(env.RELAYS);
          
          const status = {
            serverRunning: true,
            nodeActive: node !== null,
            hasCredentials: env.SHARE_CRED && env.GROUP_CRED ? true : false,
            relayCount: currentRelays.length,
            timestamp: new Date().toISOString()
          }
          return Response.json(status, { headers })
        } catch (error) {
          console.error('Status API Error:', error)
          return Response.json({ error: 'Failed to get status' }, { status: 500, headers })
        }
      }
    }

    // Server-Sent Events endpoint for streaming node events
    if (url.pathname === '/api/events') {
      if (req.method === 'GET') {
        let streamController: ReadableStreamDefaultController | null = null;
        
        const stream = new ReadableStream({
          start(controller) {
            try {
              // Store reference to controller
              streamController = controller;
              // Add this controller to the set of active streams
              eventStreams.add(controller);
              
              // Send initial connection event
              const connectEvent = {
                type: 'system',
                message: 'Connected to event stream',
                timestamp: new Date().toLocaleTimeString(),
                id: Math.random().toString(36).substr(2, 9)
              };
              
              const eventData = `data: ${JSON.stringify(connectEvent)}\n\n`;
              controller.enqueue(new TextEncoder().encode(eventData));
            } catch (error) {
              console.error('EventSource start error:', error);
              try {
                controller.error(error);
              } catch (e) {
                // Ignore if controller is already closed
              }
            }
          },
          
          cancel(reason) {
            try {
              // Remove this controller when the connection is closed
              if (streamController) {
                eventStreams.delete(streamController);
                streamController = null;
              }
            } catch (error) {
              console.error('EventSource cancel error:', error);
            }
          }
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
            'Access-Control-Allow-Methods': 'GET',
          }
        });
      }
    }

    // API endpoints for peer management
    if (url.pathname.startsWith('/api/peers')) {
      try {
        switch (url.pathname) {
          case '/api/peers':
            if (req.method === 'GET') {
              // Get all peers from group credential
              const env = readEnvFile();
              if (!env.GROUP_CRED) {
                return Response.json({ error: 'No group credential available' }, { status: 400, headers });
              }
              
              try {
                const decodedGroup = decodeGroup(env.GROUP_CRED);
                const allPeers = decodedGroup.commits.map(commit => commit.pubkey);
                
                // Filter out self if we have share credential
                let filteredPeers = allPeers;
                if (env.SHARE_CRED) {
                  const selfPubkeyResult = extractSelfPubkeyFromCredentials(env.GROUP_CRED, env.SHARE_CRED);
                  if (selfPubkeyResult.pubkey) {
                    filteredPeers = allPeers.filter(pubkey => !comparePubkeys(pubkey, selfPubkeyResult.pubkey!));
                  }
                }
                
                // Get current status for each peer
                const peersWithStatus = filteredPeers.map(pubkey => {
                  const normalizedPubkey = normalizePubkey(pubkey);
                  const status = peerStatuses.get(normalizedPubkey);
                  return {
                    pubkey,
                    online: status?.online || false,
                    lastSeen: status?.lastSeen?.toISOString(),
                    latency: status?.latency,
                    lastPingAttempt: status?.lastPingAttempt?.toISOString()
                  };
                });
                
                return Response.json({ 
                  peers: peersWithStatus,
                  total: peersWithStatus.length,
                  online: peersWithStatus.filter(p => p.online).length
                }, { headers });
              } catch (error) {
                return Response.json({ error: 'Failed to decode group credential' }, { status: 400, headers });
              }
            }
            break;

          case '/api/peers/self':
            if (req.method === 'GET') {
              const env = readEnvFile();
              if (!env.GROUP_CRED || !env.SHARE_CRED) {
                return Response.json({ error: 'Missing credentials' }, { status: 400, headers });
              }
              
              const selfPubkeyResult = extractSelfPubkeyFromCredentials(env.GROUP_CRED, env.SHARE_CRED);
              if (selfPubkeyResult.pubkey) {
                return Response.json({ 
                  pubkey: selfPubkeyResult.pubkey,
                  warnings: selfPubkeyResult.warnings 
                }, { headers });
              } else {
                return Response.json({ 
                  error: 'Could not extract self pubkey',
                  warnings: selfPubkeyResult.warnings 
                }, { status: 400, headers });
              }
            }
            break;

          case '/api/peers/ping':
            if (req.method === 'POST') {
              if (!node) {
                return Response.json({ error: 'Node not available' }, { status: 503, headers });
              }
              
              const { target } = await req.json();
              
              if (target === 'all') {
                // Ping all peers
                const env = readEnvFile();
                if (!env.GROUP_CRED) {
                  return Response.json({ error: 'No group credential available' }, { status: 400, headers });
                }
                
                try {
                  const decodedGroup = decodeGroup(env.GROUP_CRED);
                  let allPeers = decodedGroup.commits.map(commit => commit.pubkey);
                  
                  // Filter out self if we have share credential
                  if (env.SHARE_CRED) {
                    const selfPubkeyResult = extractSelfPubkeyFromCredentials(env.GROUP_CRED, env.SHARE_CRED);
                    if (selfPubkeyResult.pubkey) {
                      allPeers = allPeers.filter(pubkey => !comparePubkeys(pubkey, selfPubkeyResult.pubkey!));
                    }
                  }
                  
                  const pingPromises = allPeers.map(async (pubkey) => {
                     const normalizedPubkey = normalizePubkey(pubkey);
                     try {
                       const startTime = Date.now();
                       const result = await Promise.race([
                         node.req.ping(normalizedPubkey),
                         new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), PING_TIMEOUT_MS))
                       ]);
                       
                       const latency = Date.now() - startTime;
                      
                       if ((result as any).ok) {
                         const updatedStatus: PeerStatus = {
                           pubkey,
                           online: true,
                           lastSeen: new Date(),
                           latency
                         };
                         peerStatuses.set(normalizedPubkey, updatedStatus);
                         
                         // Broadcast peer status for peer list (not logged to event stream)
                         broadcastEvent({
                           type: 'peer-ping-internal',
                           message: '', // Internal use only - not logged
                           data: { pubkey, status: updatedStatus, success: true },
                           timestamp: new Date().toLocaleTimeString(),
                           id: Math.random().toString(36).substr(2, 9)
                         });
                         
                         return { pubkey, success: true, latency };
                       } else {
                         const updatedStatus: PeerStatus = {
                           pubkey,
                           online: false,
                           lastPingAttempt: new Date()
                         };
                         peerStatuses.set(normalizedPubkey, updatedStatus);
                         return { pubkey, success: false, error: 'Timeout' };
                       }
                       } catch (error) {
                       const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                       const updatedStatus: PeerStatus = {
                         pubkey,
                         online: false,
                         lastPingAttempt: new Date()
                       };
                       peerStatuses.set(normalizedPubkey, updatedStatus);
                       return { pubkey, success: false, error: errorMessage };
                     }
                  });
                  
                  const results = await Promise.all(pingPromises);
                  return Response.json({ results }, { headers });
                } catch (error) {
                  return Response.json({ error: 'Failed to ping peers' }, { status: 500, headers });
                }
              } else if (typeof target === 'string') {
                // Ping specific peer
                const normalizedPubkey = normalizePubkey(target);
                
                try {
                  const startTime = Date.now();
                  const result = await Promise.race([
                    node.req.ping(normalizedPubkey),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), PING_TIMEOUT_MS))
                  ]);
                  
                  const latency = Date.now() - startTime;
                  
                  if ((result as any).ok) {
                    const updatedStatus: PeerStatus = {
                      pubkey: target,
                      online: true,
                      lastSeen: new Date(),
                      latency
                    };
                    peerStatuses.set(normalizedPubkey, updatedStatus);
                    
                    // Broadcast peer status for peer list (not logged to event stream)
                    broadcastEvent({
                      type: 'peer-ping-internal',
                      message: '', // Internal use only - not logged
                      data: { pubkey: target, status: updatedStatus, success: true },
                      timestamp: new Date().toLocaleTimeString(),
                      id: Math.random().toString(36).substr(2, 9)
                    });
                    
                    return Response.json({ 
                      pubkey: target, 
                      success: true, 
                      latency,
                      status: updatedStatus 
                    }, { headers });
                  } else {
                    const updatedStatus: PeerStatus = {
                      pubkey: target,
                      online: false,
                      lastPingAttempt: new Date()
                    };
                    peerStatuses.set(normalizedPubkey, updatedStatus);
                    
                    return Response.json({ 
                      pubkey: target, 
                      success: false, 
                      error: 'Timeout',
                      status: updatedStatus 
                    }, { headers });
                  }
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                  const updatedStatus: PeerStatus = {
                    pubkey: target,
                    online: false,
                    lastPingAttempt: new Date()
                  };
                  peerStatuses.set(normalizedPubkey, updatedStatus);
                  
                  return Response.json({ 
                    pubkey: target, 
                    success: false, 
                    error: errorMessage,
                    status: updatedStatus 
                  }, { headers });
                }
              } else {
                return Response.json({ error: 'Invalid target parameter' }, { status: 400, headers });
              }
            }
            break;
        }
        
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
      } catch (error) {
        console.error('Peer API Error:', error);
        return Response.json({ error: 'Internal server error' }, { status: 500, headers });
      }
    }

    // API endpoints for .env management
    if (url.pathname.startsWith('/api/env')) {
      try {
        switch (url.pathname) {
          case '/api/env':
            if (req.method === 'GET') {
              const env = readEnvFile()
              return Response.json(env, { headers })
            }
            
            if (req.method === 'POST') {
              const body = await req.json()
              const env = readEnvFile()
              
              // Check if we're updating credentials
              const updatingCredentials = 'SHARE_CRED' in body || 'GROUP_CRED' in body
              
              // Update environment variables
              Object.assign(env, body)
              
              if (writeEnvFile(env)) {
                // If credentials were updated, recreate the node
                if (updatingCredentials) {
                  try {
                    // Clean up existing node if it exists
                    if (node) {
                      addServerLog('info', 'Cleaning up existing Bifrost node...');
                      // Note: igloo-core handles cleanup internally
                      node = null
                    }
                    
                    // Check if we now have both credentials
                    if (env.SHARE_CRED && env.GROUP_CRED) {
                      addServerLog('info', 'Creating and connecting node...');
                      // Use relays from the updated environment
                      const nodeRelays = getValidRelays(env.RELAYS);
                      
                      // Try enhanced node creation with retry logic
                      let apiConnectionAttempts = 0;
                      const apiMaxAttempts = 2; // Fewer attempts for API calls to avoid long delays
                      
                      while (apiConnectionAttempts < apiMaxAttempts && !node) {
                        apiConnectionAttempts++;
                        
                        try {
                          const result = await createConnectedNode({
                            group: env.GROUP_CRED,
                            share: env.SHARE_CRED,
                            relays: nodeRelays,
                            connectionTimeout: 20000,
                            autoReconnect: true
                          }, {
                            enableLogging: false,
                            logLevel: 'error'
                          });
                          
                          if (result.node) {
                            node = result.node;
                            setupNodeEventListeners(node);
                            addServerLog('info', 'Node connected and ready');
                            
                            if (result.state) {
                              addServerLog('info', `Connected to ${result.state.connectedRelays.length}/${nodeRelays.length} relays`);
                            }
                            break; // Success
                          } else {
                            throw new Error('Enhanced node creation returned no node');
                          }
                        } catch (enhancedError) {
                          if (apiConnectionAttempts === apiMaxAttempts) {
                            addServerLog('info', 'Enhanced node creation failed, using basic connection...');
                            
                            node = await createAndConnectNode({
                              group: env.GROUP_CRED,
                              share: env.SHARE_CRED,
                              relays: nodeRelays
                            });
                            
                            if (node) {
                              setupNodeEventListeners(node);
                              addServerLog('info', 'Node connected and ready (basic mode)');
                            }
                          } else {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                          }
                        }
                      }
                    } else {
                      addServerLog('info', 'Incomplete credentials, node not created');
                      addServerLog('info', `Share credential: ${env.SHARE_CRED ? 'Present' : 'Missing'}, Group credential: ${env.GROUP_CRED ? 'Present' : 'Missing'}`);
                    }
                  } catch (error) {
                    addServerLog('error', 'Error recreating Bifrost node', error);
                    // Continue anyway - the env vars were saved
                  }
                }
                
                return Response.json({ success: true, message: 'Environment variables updated' }, { headers })
              } else {
                return Response.json({ success: false, message: 'Failed to update .env file' }, { status: 500, headers })
              }
            }
            break

          case '/api/env/delete':
            if (req.method === 'POST') {
              const { keys } = await req.json()
              const env = readEnvFile()
              
              // Check if we're deleting credentials
              const deletingCredentials = keys.includes('SHARE_CRED') || keys.includes('GROUP_CRED')
              
              // Delete specified keys
              for (const key of keys) {
                delete env[key]
              }
              
              if (writeEnvFile(env)) {
                // If credentials were deleted, clean up the node
                if (deletingCredentials && node) {
                  try {
                    addServerLog('info', 'Credentials deleted, cleaning up Bifrost node...');
                    // Note: igloo-core handles cleanup internally
                    node = null
                    addServerLog('info', 'Bifrost node cleaned up successfully');
                  } catch (error) {
                    addServerLog('error', 'Error cleaning up Bifrost node', error);
                    // Continue anyway - the env vars were deleted
                  }
                }
                
                return Response.json({ success: true, message: 'Environment variables deleted' }, { headers })
              } else {
                return Response.json({ success: false, message: 'Failed to update .env file' }, { status: 500, headers })
              }
            }
            break
        }
        
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers })
      } catch (error) {
        console.error('API Error:', error)
        return Response.json({ error: 'Internal server error' }, { status: 500, headers })
      }
    }

    // Serve static files
    if (url.pathname.startsWith('/assets/')) {
      // Serve files from assets directory
      const assetPath = url.pathname.substring(1) // Remove leading slash
      const file = Bun.file(`static/${assetPath}`)
      
      if (await file.exists()) {
        const contentType = getContentType(assetPath)
        return new Response(file, {
          headers: { 'Content-Type': contentType }
        })
      }
      
      return new Response('Asset not found', { status: 404 })
    }

    switch (url.pathname) {
      case '/styles.css':
        return new Response(style_file, {
          headers: { 'Content-Type': 'text/css' }
        })

      case '/app.js':
        return new Response(script_file, {
          headers: { 'Content-Type': 'text/javascript' }
        })
        
      default:
        return new Response(index_page, {
          headers: { 'Content-Type': 'text/html' }
        })
    }
  }
})

console.log(`Server running at ${CONST.HOST_NAME}:${CONST.HOST_PORT}`)
addServerLog('info', `Server running at ${CONST.HOST_NAME}:${CONST.HOST_PORT}`);

// Note: Node event listeners are already set up in setupNodeEventListeners() if node exists
if (!node) {
  addServerLog('info', 'Node not initialized - credentials not available. Server is ready for configuration.');
}
